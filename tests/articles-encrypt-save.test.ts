/**
 * 文章加密 · 保存语义回归测试
 *
 * 背景（2026-09-10 线上事故）：
 * 1. 服务端 `resolveEncryption` 把 `input.encryptPassword ?? ''` 写在
 *    「沿用旧密文」分支**之前**，导致 `undefined` 被提前折叠为空串并命中
 *    「请设置访问密码」→ 已加密文章只要改个标题就 400。
 * 2. 编辑器勾选「加密文章」即触发保存，但此时密码框为空 → 同样 400。
 *
 * 这两个 bug 的共同根因是 **`undefined`（字段缺省）与 `''`（用户留空）语义被混淆**。
 * 本文件锁死正确语义，防止回退。
 */
import { describe, it, expect } from 'vitest';
import { resolveEncryption as rawResolve } from '../src/lib/articles';
import {
  ArticleCryptoError,
  decryptContent,
  parseEncryptMeta,
  encryptContent,
} from '../src/lib/article-crypto';
import type { Article, ArticleUpsertInput } from '../db/types';

const PASSWORD = 'save-semantics-2026';

/** 构造一个已加密文章的既有行 */
function encryptedRow(plain: string): Article {
  const meta = encryptContent(plain, PASSWORD);
  return {
    id: 'a1',
    title: '旧标题',
    slug: 'old',
    type: 'tech',
    summary: '',
    content: '',
    cover: '',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    encrypted: true,
    encryptHint: '旧提示',
    encryptMeta: JSON.stringify(meta),
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

/** 兼容两种导出形态（直接函数 / 带类型守卫） */
const resolve = rawResolve as unknown as (
  i: ArticleUpsertInput,
  e: Article | null,
) => { content: string; encrypted: boolean; encryptHint: string; encryptMeta: string };

/** 解析密文（测试辅助：断言非空，便于调用 decryptContent） */
function metaOf(raw: string) {
  const m = parseEncryptMeta(raw);
  if (!m) throw new Error('测试数据异常：encryptMeta 解析为空');
  return m;
}

describe('resolveEncryption · 密码字段的 undefined 与空串必须区分', () => {
  it('【回归1】已加密文章未提供 encryptPassword（改标题/自动保存）→ 沿用旧密文，不报错', () => {
    const existing = encryptedRow('# 原文\n\n原始段落。');
    const out = resolve(input({ encrypt: true, encryptHint: '旧提示' }), existing);

    expect(out.encrypted).toBe(true);
    expect(out.content).toBe('');
    // 密文必须原封不动（不能因改标题而丢失/重加密）
    expect(out.encryptMeta).toBe(existing.encryptMeta);
    // 旧密文仍可用原密码解出
    expect(decryptContent(metaOf(out.encryptMeta), PASSWORD)).toBe('# 原文\n\n原始段落。');
  });

  it('【回归1】已加密文章完全不带 encrypt 字段 → 同样保留原密文', () => {
    const existing = encryptedRow('保留内容');
    const out = resolve(input(), existing);
    expect(out.encrypted).toBe(true);
    expect(out.content).toBe('');
    expect(out.encryptMeta).toBe(existing.encryptMeta);
  });

  it('【回归2】首次加密但密码为空串 → 必须抛「请设置访问密码」', () => {
    expect(() => resolve(input({ encrypt: true, encryptPassword: '' }), null)).toThrow(ArticleCryptoError);
    expect(() => resolve(input({ encrypt: true, encryptPassword: '' }), null)).toThrow('请设置访问密码');
  });

  it('首次加密且提供密码 → 密文写入且 content 置空', () => {
    const out = resolve(input({ encrypt: true, encryptPassword: PASSWORD, encryptHint: 'h' }), null);
    expect(out.encrypted).toBe(true);
    expect(out.content).toBe('');
    expect(decryptContent(metaOf(out.encryptMeta), PASSWORD)).toBe('新正文');
    expect(out.encryptHint).toBe('h');
  });

  it('已加密文章提供新密码 → 用新密码重加密（改密码路径）', () => {
    const existing = encryptedRow('老正文');
    const out = resolve(input({ encrypt: true, encryptPassword: 'brand-new-pass' }), existing);
    expect(decryptContent(metaOf(out.encryptMeta), 'brand-new-pass')).toBe('新正文');
  });

  it('encrypt=disable → 关闭加密并回填明文', () => {
    const existing = encryptedRow('要回填的正文');
    const out = resolve(input({ encrypt: 'disable', content: '明文回填' }), existing);
    expect(out.encrypted).toBe(false);
    expect(out.content).toBe('明文回填');
    expect(out.encryptMeta).toBe('');
    expect(out.encryptHint).toBe('');
  });

  it('新建文章、未指定 encrypt → 明文落库', () => {
    const out = resolve(input(), null);
    expect(out.encrypted).toBe(false);
    expect(out.content).toBe('新正文');
  });

  it('encrypted=true 但 encryptMeta 为空（脏数据）→ 视为未加密，不误判为已加密', () => {
    const dirty = { ...encryptedRow('x'), encryptMeta: '' } as Article;
    expect(() => resolve(input({ encrypt: true, encryptPassword: '' }), dirty)).toThrow('请设置访问密码');
  });
});
