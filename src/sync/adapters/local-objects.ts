/**
 * 本地对象缓存（R2 对象的桌面端副本）
 *
 * 设计：对象体按 key 原样落在 `<用户数据目录>/files/<key>`，
 * 与云端 R2 的 key 一一对应 —— 比对时只需比较 key 集合，无需元数据表。
 *
 * 用途：桌面端按需下载（页面首次请求某张云端图片时落盘缓存），
 * 之后即使离线也能显示已缓存过的图片（配合 Electron 的请求拦截）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** 缓存根目录（默认 %APPDATA%/byqx-blog-desktop/files，可通过参数覆盖便于测试） */
export function objectCacheDir(base?: string): string {
  const root =
    base ??
    path.join(
      process.env.APPDATA || process.env.HOME || '.',
      process.env.APPDATA ? 'byqx-blog-desktop' : '.byqx-blog-desktop',
    );
  return path.join(root, 'files');
}

/** key → 本地路径（把 key 的 '/' 交给系统路径处理，并防止越界） */
function objectPath(dir: string, key: string): string {
  const safe = key.replace(/^\/+/, '').replace(/\.\./g, '_');
  return path.join(dir, safe);
}

export interface LocalObjectInfo {
  key: string;
  size: number;
}

/** 是否已缓存 */
export function hasLocalObject(key: string, base?: string): boolean {
  return existsSync(objectPath(objectCacheDir(base), key));
}

/** 读取缓存（未命中返回 null） */
export function readLocalObject(key: string, base?: string): Buffer | null {
  const p = objectPath(objectCacheDir(base), key);
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

/** 写入缓存（自动建目录） */
export function writeLocalObject(key: string, data: Buffer, base?: string): string {
  const p = objectPath(objectCacheDir(base), key);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

/** 列出本地已缓存对象（key 集合，用于与云端清单比对） */
export function listLocalObjects(base?: string): LocalObjectInfo[] {
  const dir = objectCacheDir(base);
  if (!existsSync(dir)) return [];
  const out: LocalObjectInfo[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(dir, rel);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(nextRel);
      else out.push({ key: nextRel, size: statSync(path.join(abs, entry.name)).size });
    }
  };
  walk('');
  return out;
}

/** 删除缓存对象 */
export function removeLocalObject(key: string, base?: string): void {
  const p = objectPath(objectCacheDir(base), key);
  if (existsSync(p)) rmSync(p, { force: true });
}
