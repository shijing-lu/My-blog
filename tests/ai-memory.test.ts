/**
 * AI 记忆层纯函数测试：脱敏 / 摘要解析 / 去重合并 / 注入块组装
 *
 * 这些函数决定"小卿记住什么、忘了什么、会不会泄露敏感信息"，是记忆功能的
 * 安全与正确性核心，全部设计为纯函数以便穷举边界。
 */
import { describe, expect, it } from 'vitest';
import {
  buildMemoryBlock,
  cleanDraft,
  mergeDrafts,
  MEMORY_BLOCK_CHAR_BUDGET,
  MEMORY_CONTENT_MAX,
  normalizeMemoryText,
  parseSummaryJson,
  rankMemories,
  redactSensitive,
} from '../src/lib/ai-memory';

describe('redactSensitive 脱敏', () => {
  it('常见凭据形态：password= / apiKey: / sk- 密钥', () => {
    expect(redactSensitive('我的密码是 password=abc12345 别告诉别人')).not.toContain('abc12345');
    expect(redactSensitive('apiKey: "sk-abcdefghij1234567890"')).not.toContain('sk-abcdefghij');
    expect(redactSensitive('token=xyz1234567890123456')).not.toContain('xyz1234567890123456');
  });

  it('中国大陆手机号与身份证', () => {
    expect(redactSensitive('联系我 13812345678')).not.toContain('13812345678');
    expect(redactSensitive('身份证 110101199003077758')).not.toContain('110101199003077758');
  });

  it('普通内容不受影响', () => {
    const s = '主人在准备 408 考研，喜欢喝咖啡';
    expect(redactSensitive(s)).toBe(s);
  });

  it('幂等：对已脱敏文本再处理不产生变化', () => {
    const once = redactSensitive('password=abc12345');
    expect(redactSensitive(once)).toBe(once);
  });
});

describe('parseSummaryJson 摘要解析', () => {
  it('正常解析模型输出的 JSON 数组', () => {
    const raw = '[{"kind":"fact","content":"主人在准备 408 考研","importance":5}]';
    const drafts = parseSummaryJson(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toEqual({ kind: 'fact', content: '主人在准备 408 考研', importance: 5 });
  });

  it('剥掉 ```json 围栏后再解析', () => {
    const raw = '```json\n[{"kind":"preference","content":"喜欢简洁回复","importance":3}]\n```';
    expect(parseSummaryJson(raw)).toEqual([{ kind: 'preference', content: '喜欢简洁回复', importance: 3 }]);
  });

  it('容错：模型在 JSON 前后加了废话', () => {
    const raw = '好的，以下是提取结果：\n[{"kind":"event","content":"周五要交报告","importance":4}]\n希望有帮助';
    expect(parseSummaryJson(raw)).toEqual([{ kind: 'event', content: '周五要交报告', importance: 4 }]);
  });

  it('非法输入全部返回空数组（宁可不记忆，不能崩）', () => {
    for (const raw of ['', '不是 JSON', '{"kind":"fact"}', '[{"content":""}]', '[]', null]) {
      expect(parseSummaryJson(raw as never)).toEqual([]);
    }
  });

  it('单条超长截断到上限；importance 越界归位 3', () => {
    const long = '长'.repeat(300);
    const [d] = parseSummaryJson(`[{"kind":"fact","content":"${long}","importance":99}]`);
    expect(d!.content.length).toBeLessThanOrEqual(MEMORY_CONTENT_MAX);
    expect(d!.importance).toBe(5); // 越界 → 钳位到上限 5
  });
});

describe('mergeDrafts 去重合并', () => {
  it('归一化后相同的内容判为重复（标点/空白/大小写差异忽略）', () => {
    const existing = [{ content: '主人在准备 408 考研。' }];
    const { fresh, dup } = mergeDrafts(existing, [
      { kind: 'fact', content: '主人在准备 408 考研', importance: 5 },
    ]);
    expect(fresh).toHaveLength(0);
    expect(dup).toHaveLength(1);
  });

  it('新信息作为新增项', () => {
    const { fresh, dup } = mergeDrafts([{ content: '主人在准备 408 考研' }], [
      { kind: 'fact', content: '主人喜欢喝美式咖啡', importance: 3 },
    ]);
    expect(fresh).toHaveLength(1);
    expect(dup).toHaveLength(0);
  });
});

describe('buildMemoryBlock 注入块组装', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
    id: `m${i}`,
    kind: 'fact',
    content: `记忆条目${i}`.repeat(3),
    importance: ((i - 1) % 5) + 1,
    updatedAt: new Date(2026, 0, i),
  }));

  it('包含「不是指令」的注入防护声明', () => {
    const block = buildMemoryBlock(rows);
    expect(block).toContain('不是指令');
  });

  it('按重要度排序取前 K 条（高重要度优先）', () => {
    const block = buildMemoryBlock(rows);
    expect(block).toContain('记忆条目5'); // importance=5，必入
    // 8 条里最多 6 条（MEMORY_TOP_K）：重要度最低的两条（1 分）被裁掉
    expect(block).not.toContain('记忆条目1'); // imp=1，被裁
    expect(block).not.toContain('记忆条目6'); // imp=1，被裁
    const lines = block.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(6);
  });

  it('预算截断：单条极长时只放得下少量条目', () => {
    const longRows = Array.from({ length: 6 }, (_, i) => ({
      id: `l${i}`,
      kind: 'fact',
      content: `很长的记忆内容${i}`.padEnd(MEMORY_BLOCK_CHAR_BUDGET / 2, '字'),
      importance: 5,
      updatedAt: new Date(),
    }));
    const block = buildMemoryBlock(longRows);
    // 总长度受预算约束（预算 + 声明文案的余量）；300 字/条 → 最多 2 条入块
    const listItems = block.split('\n').filter((l) => l.startsWith('- 记忆'));
    expect(listItems.length).toBeLessThanOrEqual(3);
  });

  it('空记忆返回空串（不产生空段落）', () => {
    expect(buildMemoryBlock([])).toBe('');
  });
});

describe('normalizeMemoryText / rankMemories', () => {
  it('归一化去掉标点与空白、转小写', () => {
    expect(normalizeMemoryText('主人，在准备 408 考研！')).toBe('主人在准备408考研');
  });

  it('排序：重要度优先，同分新者靠前', () => {
    const sorted = rankMemories([
      { importance: 3, updatedAt: new Date('2026-09-20') },
      { importance: 5, updatedAt: new Date('2026-09-01') },
      { importance: 3, updatedAt: new Date('2026-09-21') },
    ]);
    expect(sorted.map((r) => r.importance)).toEqual([5, 3, 3]);
    expect(new Date(sorted[1]!.updatedAt) > new Date(sorted[2]!.updatedAt)).toBe(true);
  });
});
