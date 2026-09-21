/**
 * photo-tags 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * `src/lib/photo-tags.ts` 是**服务端与客户端共用**的标签工具。抽它的直接原因是一个真实缺陷：
 * `gallery/upload.astro` 原先自己抄了一份规范化逻辑，且那份**额外做了去重 + 限 10 个**，
 * 而 `batchUpdateTags` 里的 `clean` 只折叠空白与截断长度 —— 于是「移除」一次提交超过 10 个
 * 标签时，界面只减掉前 10 个，与服务端实际存下的内容不符（要刷新才对上）。
 *
 * 这里锁住三件事：
 * 1. 客户端展示用的 `normalizeTags(x)` 与「服务端写库后再读回」`JSON.parse(serializeTags(x))`
 *    恒等（同一份净化语义，不许再各抄一份）；
 * 2. `combineTags` 的 set / add / remove 语义；
 * 3. 上面那个回归：remove 传 >10 个标签必须全部减掉。
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_TAGS,
  MAX_TAG_LEN,
  cleanTags,
  combineTags,
  normalizeTags,
  parseTagsInput,
} from '../src/lib/photo-tags';
import { serializeTags } from '../src/lib/photos';

/** 服务端路径：写库 → 读回 */
const serverRoundTrip = (next: string[]): string[] => JSON.parse(serializeTags(next)) as string[];
/** 客户端路径：写进输入框前做的净化 */
const clientDisplay = (next: string[]): string[] => normalizeTags(next);

describe('normalizeTags 与服务端 serializeTags 等价', () => {
  it('常见输入：两条路径结果一致', () => {
    const cases: string[][] = [
      [],
      ['风景'],
      ['风景', '旅行', '2024'],
      ['  风景  ', '旅行'],
      ['风景', '风景', '风景'],
      ['a  b', 'a b'],
      [''],
      ['   '],
      ['x'.repeat(50)],
    ];
    for (const c of cases) {
      expect(clientDisplay(c), JSON.stringify(c)).toEqual(serverRoundTrip(c));
    }
  });

  it('超过 MAX_TAGS 个时，两条路径都只保留前 10 个（顺序一致）', () => {
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toEqual(many.slice(0, MAX_TAGS));
    expect(serverRoundTrip(many)).toEqual(many.slice(0, MAX_TAGS));
  });

  it('单标签超长时截断到 MAX_TAG_LEN，两条路径一致', () => {
    const long = 'x'.repeat(MAX_TAG_LEN + 30);
    expect(normalizeTags([long])[0]).toHaveLength(MAX_TAG_LEN);
    expect(serverRoundTrip([long])[0]).toHaveLength(MAX_TAG_LEN);
  });

  it('空白折叠：内部连续空白压成单个空格', () => {
    expect(normalizeTags(['a\t\tb   c'])).toEqual(['a b c']);
    expect(serverRoundTrip(['a\t\tb   c'])).toEqual(['a b c']);
  });

  it('空串 / 纯空白项被丢弃', () => {
    expect(normalizeTags(['', '   ', 'ok'])).toEqual(['ok']);
    expect(serverRoundTrip(['', '   ', 'ok'])).toEqual(['ok']);
  });
});

describe('cleanTags vs normalizeTags（这是当初出 bug 的分界）', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `t${i}`);

  it('cleanTags 保留全部（不去重、不限个数）', () => {
    expect(cleanTags(twelve)).toHaveLength(12);
  });

  it('normalizeTags 会截到 MAX_TAGS 个 —— 所以它不能用来做 remove 的差集', () => {
    expect(normalizeTags(twelve)).toHaveLength(MAX_TAGS);
    expect(normalizeTags(twelve)).not.toHaveLength(12);
  });
});

describe('combineTags', () => {
  const current = ['风景', '旅行'];

  it('set：覆盖为给定标签', () => {
    expect(combineTags(current, 'set', ['新', '标签'])).toEqual(['新', '标签']);
  });

  it('set 传空数组 = 清空', () => {
    expect(combineTags(current, 'set', [])).toEqual([]);
  });

  it('add：合并追加并去重（已存在的标签不重复）', () => {
    expect(combineTags(current, 'add', ['旅行', '美食'])).toEqual(['风景', '旅行', '美食']);
  });

  it('remove：减去给定标签，其余保持原顺序', () => {
    expect(combineTags(current, 'remove', ['旅行'])).toEqual(['风景']);
  });

  it('remove 不存在的标签 = 无变化', () => {
    expect(combineTags(current, 'remove', ['不存在'])).toEqual(['风景', '旅行']);
  });

  it('输入会被净化（折叠空白 / 截断长度），故匹配得上已有标签', () => {
    expect(combineTags(['a b'], 'remove', ['  a   b  '])).toEqual([]);
  });
});

describe('回归：remove 一次提交 >10 个标签必须全部减掉', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `t${i}`);
  const current = [...twelve, '保留'];

  it('12 个目标标签全部被减掉（旧实现只减前 10 个，留下 2 个）', () => {
    const next = combineTags(current, 'remove', twelve);
    expect(next).toEqual(['保留']);
    // 客户端展示与服务端写库结果一致
    expect(clientDisplay(next)).toEqual(serverRoundTrip(next));
  });

  it('反证：若用 normalizeTags 当差集（旧写法），会漏掉 2 个', () => {
    const buggyClean = normalizeTags(twelve); // 旧实现：被截到 10 个
    const buggyNext = current.filter((t) => !buggyClean.includes(t));
    expect(buggyNext).toEqual(['t10', 't11', '保留']); // 漏减 2 个 —— 正是当初的缺陷
    expect(buggyNext).not.toEqual(combineTags(current, 'remove', twelve));
  });
});

describe('parseTagsInput', () => {
  it('中英文逗号都能分隔，并去掉空项', () => {
    expect(parseTagsInput('风景,旅行，2024,,  ,美食')).toEqual(['风景', '旅行', '2024', '美食']);
  });

  it('去重', () => {
    expect(parseTagsInput('a,b,a')).toEqual(['a', 'b']);
  });

  it('空串 → 空数组', () => {
    expect(parseTagsInput('')).toEqual([]);
  });

  it('单项两侧空白被去掉', () => {
    expect(parseTagsInput('  风景  ,旅行 ')).toEqual(['风景', '旅行']);
  });
});

describe('往返一致性：卡片输入框 ↔ 服务端', () => {
  it('SSR 写进输入框的 join(",") 能被 parseTagsInput 原样读回（标签不含逗号时）', () => {
    const stored = ['风景', '旅行', '2024'];
    const inputValue = stored.join(',');
    expect(parseTagsInput(inputValue)).toEqual(stored);
  });

  it('批量操作后再往返仍然一致', () => {
    const current = ['风景'];
    const next = normalizeTags(combineTags(current, 'add', ['旅行', '美食']));
    expect(parseTagsInput(next.join(','))).toEqual(next);
  });
});
