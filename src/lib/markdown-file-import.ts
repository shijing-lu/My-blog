import { DOC_IMPORT_MAX_BYTES, DOC_IMPORT_MAX_CHARS, markdownFilename } from './doc-import-limits';

export class MarkdownImportError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Bounded streaming read shared by document nodes and homepage articles. */
export async function readMarkdownFile(request: Request, url: URL): Promise<{ id: string; title: string; content: string }> {
  const filename = url.searchParams.get('filename') ?? '';
  const id = url.searchParams.get('operationId') ?? '';
  if (!markdownFilename(filename) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new MarkdownImportError('导入参数无效，仅支持 .md / .markdown 文件');
  if (Number(request.headers.get('content-length')) > DOC_IMPORT_MAX_BYTES) throw new MarkdownImportError('Markdown 文件不能超过 2 MiB', 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > DOC_IMPORT_MAX_BYTES) { await reader.cancel(); throw new MarkdownImportError('Markdown 文件不能超过 2 MiB', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new MarkdownImportError('文件不是有效的 UTF-8 文本，请转换为 UTF-8 后导入'); }
  if (content.length > DOC_IMPORT_MAX_CHARS) throw new MarkdownImportError('正文不能超过 500000 字符，未导入任何内容', 413);
  if (content.includes('\u0000')) throw new MarkdownImportError('文件含无效文本字符，请确认保存为 UTF-8 Markdown');
  return { id, title: filename.replace(/\.(?:md|markdown)$/i, '').trim().slice(0, 200) || '未命名文章', content };
}
