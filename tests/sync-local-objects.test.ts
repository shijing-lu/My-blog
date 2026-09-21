/**
 * 本地对象缓存单测（W6 按需下载的落盘层）
 *
 * 验证：写入/读取/命中判断/列目录/删除，以及 key 中的 `..` 不会越界到缓存目录之外。
 * 用临时目录做根，不触碰真实用户数据。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  hasLocalObject,
  listLocalObjects,
  objectCacheDir,
  readLocalObject,
  removeLocalObject,
  writeLocalObject,
} from '../src/sync/adapters/local-objects';

let base: string;

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'byqx-obj-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('本地对象缓存', () => {
  it('写入后可读取，内容一致', () => {
    const data = Buffer.from('fake-image-bytes');
    writeLocalObject('images/a1.png', data, base);
    expect(hasLocalObject('images/a1.png', base)).toBe(true);
    expect(readLocalObject('images/a1.png', base)?.toString()).toBe('fake-image-bytes');
  });

  it('未命中返回 null（调用方据此走云端下载）', () => {
    expect(hasLocalObject('images/missing.png', base)).toBe(false);
    expect(readLocalObject('images/missing.png', base)).toBeNull();
  });

  it('自动建多级目录（images/thumbs/… 这种嵌套 key）', () => {
    writeLocalObject('images/thumbs/b2.webp', Buffer.from('x'), base);
    expect(existsSync(path.join(objectCacheDir(base), 'images', 'thumbs', 'b2.webp'))).toBe(true);
  });

  it('列目录返回全部已缓存对象（与云端清单比对用）', () => {
    writeLocalObject('images/a.png', Buffer.from('aaa'), base);
    writeLocalObject('images/b.png', Buffer.from('bb'), base);
    writeLocalObject('fonts/c.woff2', Buffer.from('c'), base);
    const list = listLocalObjects(base).map((o) => o.key).sort();
    expect(list).toEqual(['fonts/c.woff2', 'images/a.png', 'images/b.png']);
    const a = listLocalObjects(base).find((o) => o.key === 'images/a.png');
    expect(a?.size).toBe(3);
  });

  it('key 中的 .. 被中和，不会写到缓存目录之外', () => {
    writeLocalObject('../../evil.txt', Buffer.from('x'), base);
    // 关键不变量：缓存目录之外绝不出现文件
    expect(existsSync(path.join(base, '..', '..', 'evil.txt'))).toBe(false);
    expect(existsSync(path.join(base, '..', 'evil.txt'))).toBe(false);
    // 文件确实落在缓存目录内（净化后的相对路径，具体形态不锁定）
    const cached = listLocalObjects(base);
    expect(cached).toHaveLength(1);
    expect(cached[0]?.key.endsWith('evil.txt')).toBe(true);
    expect(cached[0]?.key.startsWith('..')).toBe(false);
  });

  it('删除后不再命中', () => {
    writeLocalObject('images/gone.png', Buffer.from('x'), base);
    removeLocalObject('images/gone.png', base);
    expect(hasLocalObject('images/gone.png', base)).toBe(false);
  });

  it('删除不存在的对象不报错（幂等）', () => {
    expect(() => removeLocalObject('images/never.png', base)).not.toThrow();
  });
});
