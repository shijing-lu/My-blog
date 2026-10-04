/** 增量读取 SSE，兼容跨包 UTF-8、CRLF、多行 data 和缺少末尾空行的响应。 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let ended = false;
  const lineData = (input: string): string | undefined => {
    const line = input.endsWith('\r') ? input.slice(0, -1) : input;
    if (line === '') {
      if (data.length === 0) return undefined;
      const event = data.join('\n');
      data = [];
      return event;
    }
    if (line === 'data') data.push('');
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    return undefined;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      ended = chunk.done;
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const event = lineData(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (event !== undefined) yield event;
      }
      if (chunk.done) break;
    }
    if (buffer) {
      const event = lineData(buffer);
      if (event !== undefined) yield event;
    }
    if (data.length > 0) yield data.join('\n');
  } finally {
    // 调用方收到 done/error 后提前结束迭代时，停止继续下载并释放连接。
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** 上游完成标记是终点，不能继续等待 keep-alive 连接超时。 */
export async function* readOpenAiDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const event of readSseData(body)) {
    if (event.trim() === '[DONE]') return;
    let data: { error?: unknown; choices?: Array<{ delta?: { content?: unknown } }> } | null;
    try {
      data = JSON.parse(event);
    } catch {
      continue;
    }
    if (data?.error) throw new Error('AI 服务生成失败，请稍后重试');
    const content = data?.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content) yield content;
  }
}