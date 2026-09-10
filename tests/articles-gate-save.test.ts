/**
 * 文章访问密码 · 保存语义回归测试
 *
 * 背景：本文件的前身 tests/articles-encrypt-save.test.ts 覆盖的是「全文加密」
 * 时代的语义（密文入库、content 置空）。2026-09-10 改造为**服务端拦截**后：
 * - 正文**始终明文入库**（不再置空）—— 这是本次改造的核心不变式；
 * - `encryptMeta` 改存**密码哈希**而非密文；
 * - `encryptPassword` 的 `undefined`（沿用旧哈希）与 `''`（未给密码）语义区分**保留**。
 *
 * 其中「改标题不该要求重输密码」是曾引发线上事故的点，必须锁死。
 */
import { describe, it, expect } from 'vitest';
import { resolveEncryption as rawResolve } from '../src/lib/articles';
import { hashPassword, verifyPassword, parsePasswordHash } from '../src/lib/article-password';
import { ArticlePasswordError } from '../src/lib/article-password';
import type { Article, ArticleUpsertInput } from '../db/types';

const PASSWORD = 'gate-semantics-2026';

/** 构造一个已设访问密码的既有行（正文明文入库） */
function gatedRow(plain: string): Article {
  return {
    id: 'a1',
    title: '旧标题',
    slug: 'old',
    type: 'tech',
    summary: '',
    content: plain,
    cover: '',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    encrypted: true,
    encryptHint: '旧提示',
    encryptMeta: JSON.stringify(hashPassword(PASSWORD)),
  } as unknown as Article;
}

function input(over: Partial<ArticleUpsertInput> = {}): ArticleUpsertInput {
  return {
    id: 'a1',
    title: '新标题',
    type: 'tech',
    summary: '',
    tags: [],
    content: '新正文',
    ...over,
  } as ArticleUpsertInput;
}

const resolve = rawResolve as unknown as (
  i: ArticleUpsertInput,
  e: Article | null,
) => { content: string; encrypted: boolean; encryptHint: string; encryptMeta: string };

describe('resolveEncryption · 服务端拦截语义', () => {
  it('【核心不变式】任何分支都不清空正文', () => {
    const existing = gatedRow('原有正文');
    const cases: Array<[string, Partial<ArticleUpsertInput>]> = [
      ['首次开启+给密码', { encrypt: true, encryptPassword: PASSWORD }],
      ['已开启+改标题（密码缺省）', { encrypt: true, encryptHint: '旧提示' }],
      ['完全不带 encrypt 字段', {}],
      ['显式关闭', { encrypt: 'disable' }],
      ['新建文章', {}],
    ];
    for (const [label, over] of cases) {
      const out = resolve(input(over), existing);
      expect(out.content, `分支「${label}」不得清空正文`).toBe('新正文');
    }
  });

  it('【回归】已设密码文章改标题（密码缺省）→ 沿用旧哈希，不报错', () => {
    const existing = gatedRow('原有正文');
    const out = resolve(input({ encrypt: true, encryptHint: '旧提示' }), existing);

    expect(out.encrypted).toBe(true);
    expect(out.encryptMeta).toBe(existing.encryptMeta);
    expect(out.content).toBe('新正文');
    // 旧密码仍然有效
    expect(verifyPassword(PASSWORD, parsePasswordHash(out.encryptMeta)!)).toBe(true);
  });

  it('【回归】完全不带 encrypt 字段 → 保留原拦截状态与哈希', () => {
    const existing = gatedRow('原有正文');
    const out = resolve(input(), existing);
    expect(out.encrypted).toBe(true);
    expect(out.encryptMeta).toBe(existing.encryptMeta);
  });

  it('首次开启但密码为空 → 抛「请设置访问密码」', () => {
    expect(() => resolve(input({ encrypt: true, encryptPassword: '' }), null)).toThrow(
      ArticlePasswordError,
    );
    expect(() => resolve(input({ encrypt: true, encryptPassword: '' }), null)).toThrow(
      '请设置访问密码',
    );
  });

  it('首次开启且给密码 → 存哈希，正文保持明文', () => {
    const out = resolve(input({ encrypt: true, encryptPassword: PASSWORD, encryptHint: 'h' }), null);
    expect(out.encrypted).toBe(true);
    expect(out.content).toBe('新正文');
    expect(out.encryptHint).toBe('h');
    // encryptMeta 是哈希而非密文：不含明文，且能用密码校验
    expect(out.encryptMeta).not.toContain(PASSWORD);
    expect(verifyPassword(PASSWORD, parsePasswordHash(out.encryptMeta)!)).toBe(true);
  });

  it('已开启+提供新密码 → 更换密码（旧密码失效）', () => {
    const existing = gatedRow('原有正文');
    const out = resolve(input({ encrypt: true, encryptPassword: 'brand-new-pass' }), existing);
    const meta = parsePasswordHash(out.encryptMeta)!;
    expect(verifyPassword('brand-new-pass', meta)).toBe(true);
    expect(verifyPassword(PASSWORD, meta)).toBe(false);
  });

  it('短密码（1 位）可用于开启拦截', () => {
    const out = resolve(input({ encrypt: true, encryptPassword: '7' }), null);
    expect(verifyPassword('7', parsePasswordHash(out.encryptMeta)!)).toBe(true);
  });

  it('encrypt=disable → 关闭拦截，清空哈希与提示', () => {
    const existing = gatedRow('原有正文');
    const out = resolve(input({ encrypt: 'disable' }), existing);
    expect(out.encrypted).toBe(false);
    expect(out.content).toBe('新正文');
    expect(out.encryptMeta).toBe('');
    expect(out.encryptHint).toBe('');
  });

  it('新建文章、未指定 encrypt → 公开且无哈希', () => {
    const out = resolve(input(), null);
    expect(out.encrypted).toBe(false);
    expect(out.content).toBe('新正文');
    expect(out.encryptMeta).toBe('');
  });

  it('encrypted=true 但 encryptMeta 为空（脏数据）→ 视为未开启，不误判', () => {
    const dirty = { ...gatedRow('x'), encryptMeta: '' } as Article;
    expect(() => resolve(input({ encrypt: true, encryptPassword: '' }), dirty)).toThrow(
      '请设置访问密码',
    );
  });
});
