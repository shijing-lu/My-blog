import { describe, expect, it } from 'vitest';
import { diaryContentFromAi, isValidDiaryDate, readCompleteDiaryText, shanghaiDateKey } from '../src/lib/diary-log';

function sse(...frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      controller.close();
    },
  });
}

describe('日志按上海时区归属日期', () => {
  it('跨上海午夜时正确切换日期', () => {
    expect(shanghaiDateKey(new Date('2026-09-27T15:59:59Z'))).toBe('2026-09-27');
    expect(shanghaiDateKey(new Date('2026-09-27T16:00:00Z'))).toBe('2026-09-28');
  });

  it('拒绝无效日期，保留合法闰日', () => {
    expect(isValidDiaryDate('2024-02-29')).toBe(true);
    expect(isValidDiaryDate('2025-02-29')).toBe(false);
    expect(isValidDiaryDate('2026-13-01')).toBe(false);
  });
});

describe('AI 日记来源链接', () => {
  const sources = [
    { ref: 'M1', id: 'moment-id', kind: '动态' as const },
    { ref: 'N1', id: 'note-id', kind: '随心录' as const },
  ];

  it('每条归纳只使用当天已验证来源的地址', () => {
    const markdown = diaryContentFromAi(JSON.stringify({ items: [
      { text: '记录了一条动态', sources: ['M1'] },
      { text: '写下一段想法', sources: ['N1'] },
    ] }), sources);
    expect(markdown).toContain('- 记录了一条动态 [动态原文](/moments/moment-id)');
    expect(markdown).toContain('- 写下一段想法 [随心录原文](/quick-notes?note=note-id)');
  });

  it('拒绝不存在的引用和模型自行提供的地址', () => {
    expect(() => diaryContentFromAi('{"items":[{"text":"记录","sources":["M2"]}]}', sources)).toThrow('来源关联');
    expect(() => diaryContentFromAi('{"items":[{"text":"[伪造](https://example.com)","sources":["M1"]}]}', sources)).toThrow('未经验证');
  });
});

describe('日志 AI 流完成保护', () => {
  it('接受明确完成的输出', async () => {
    const text = await readCompleteDiaryText(sse(
      JSON.stringify({ choices: [{ delta: { content: '今天记录了想法。' } }] }),
      '[DONE]',
    ));
    expect(text).toBe('今天记录了想法。');
  });

  it('连接提前结束时拒绝半篇日志', async () => {
    await expect(readCompleteDiaryText(sse(
      JSON.stringify({ choices: [{ delta: { content: '尚未完成' } }] }),
    ))).rejects.toThrow('提前中断');
  });

  it('输出长度截断时拒绝保存', async () => {
    await expect(readCompleteDiaryText(sse(
      JSON.stringify({ choices: [{ delta: { content: '半篇' }, finish_reason: 'length' }] }),
      '[DONE]',
    ))).rejects.toThrow('长度上限');
  });
});
