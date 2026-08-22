/**
 * 服务端环境变量统一读取入口
 *
 * 约定：
 * - 仅服务端（middleware / API / 页面 frontmatter）通过本模块读取敏感变量，
 *   客户端岛只能读 `import.meta.env.PUBLIC_*`（Vite 静态替换）。
 * - 提供默认值兜底，避免环境缺失时抛错；需要严格必填的场景请用 `requireEnv`。
 */

/**
 * 读取服务端环境变量，缺失或为空时返回 fallback
 *
 * 同时检查 `import.meta.env`（Astro/Vite 从 .env 加载，含非 PUBLIC 变量）与
 * `process.env`（Vercel 等平台注入），保证开发与生产行为一致。
 */
export function serverEnv(key: string, fallback = ''): string {
  const metaValue = (import.meta.env as Record<string, unknown>)[key];
  const fromMeta = typeof metaValue === 'string' ? metaValue : undefined;
  const fromProcess = process.env[key];
  const value = fromMeta && fromMeta !== '' ? fromMeta : fromProcess;
  return value !== undefined && value !== '' ? value : fallback;
}

/** 判断某服务端环境变量是否已配置（非空） */
export function hasServerEnv(key: string): boolean {
  return serverEnv(key) !== '';
}

/** 读取必填环境变量，缺失时抛出带说明的错误（用于启动期硬校验） */
export function requireEnv(key: string): string {
  const value = serverEnv(key);
  if (!value) {
    throw new Error(`缺少必需的环境变量 ${key}，请检查 .env / Vercel 环境变量配置`);
  }
  return value;
}

/** 是否为生产构建（构建期由 Vite 注入） */
export const isProd: boolean = import.meta.env.PROD;
