/**
 * AList REST 客户端（网站 ↔ 自建 AList 中转层）
 *
 * 设计要点：
 * - **只依赖 AList 的统一 API**，不感知具体厂商网盘（蓝奏云/百度/123云盘…都是 AList 的驱动）。
 * - 统一返回 `AlistResult<T>`：调用方无需 try/catch，直接判 `ok` 后取 `data` 或 `message`。
 * - 所有请求带超时（`AbortSignal.timeout`）：AList 常部署在家庭网络，跨网慢或被中断时
 *   必须给出可读错误而非挂死（Vercel 函数有执行时长上限）。
 * - 登录 token 做**模块级内存缓存**（带 TTL），避免每次请求都打一次 `/api/auth/login`。
 *
 * AList 响应约定：HTTP 200 + body `{ code, message, data }`，`code === 200` 表示业务成功。
 */
import type { NetdiskConfig } from './netdisk-config';

/** 成功结果 */
export interface AlistOk<T> {
  ok: true;
  data: T;
}

/** 失败结果（message 保证是可直接展示的中文文案） */
export interface AlistErr {
  ok: false;
  message: string;
  /** AList 返回的业务 code 或 HTTP 状态码（用于上层细分处理） */
  code?: number;
}

/** 统一返回类型 */
export type AlistResult<T> = AlistOk<T> | AlistErr;

/** AList 列表项 */
export interface AlistFileItem {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  created?: string;
  sign?: string;
  type?: number;
  thumb?: string;
}

/** AList 列目录返回 */
export interface AlistListData {
  content: AlistFileItem[];
  total: number;
  readme?: string;
  header?: string;
  write?: boolean;
}

/** AList 单文件详情（含下载直链） */
export interface AlistFileDetail extends AlistFileItem {
  raw_url: string;
  provider?: string;
}

/** 默认超时：常规 API 15s（跨网 + 家庭网络留余量） */
const DEFAULT_TIMEOUT_MS = 15_000;
/** 上传类请求超时：60s（小文件经本站函数转发，受函数时长约束） */
const UPLOAD_TIMEOUT_MS = 60_000;

/** 登录 token 缓存：key = baseUrl|username */
interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, TokenCacheEntry>();
/** token 缓存时长：10 分钟（AList token 默认有效期更长，这里保守取值） */
const TOKEN_TTL_MS = 10 * 60 * 1000;

/** 归一化 baseUrl（去尾部斜杠） */
function base(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 网络错误 → 可读文案
 *
 * 区分两类：超时（AbortError/TimeoutError）与连接失败（DNS/拒绝连接），
 * 这两类是「本机 AList 没开 / 隧道断了」环境问题，与凭据错误完全不同，
 * 分开提示能大幅减少排查成本。
 */
function networkErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError') return '中转服务响应超时（地址可达但无响应，请检查 AList 状态）';
  return '无法连接中转服务（请检查 AList 是否运行、地址与隧道是否正常）';
}

/**
 * 通用请求
 *
 * @param path AList 端点路径（以 / 开头）
 * @param init fetch 参数
 * @param timeoutMs 超时毫秒
 */
async function alistFetch<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<AlistResult<T>> {
  try {
    const res = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => null)) as
      | { code?: number; message?: string; data?: T }
      | null;
    if (!res.ok) {
      // HTTP 层错误（401 未授权 / 404 端点不存在 / 502 隧道错误…）
      if (res.status === 401 || res.status === 403) return { ok: false, message: '中转服务拒绝了请求：账号或密码错误，或权限不足', code: res.status };
      if (res.status === 404) return { ok: false, message: '中转服务地址不正确（AList 接口 404）', code: 404 };
      if (res.status === 502 || res.status === 503 || res.status === 504) return { ok: false, message: '中转服务暂不可用（网关错误，隧道可能已断开）', code: res.status };
      return { ok: false, message: body?.message || `中转服务返回 HTTP ${res.status}`, code: res.status };
    }
    if (!body || typeof body.code !== 'number') {
      return { ok: false, message: '中转服务返回了非 AList 格式的响应（请确认地址填的是 AList 而非其他服务）' };
    }
    if (body.code !== 200) {
      return { ok: false, message: body.message || `AList 返回错误码 ${body.code}`, code: body.code };
    }
    return { ok: true, data: (body.data ?? (undefined as unknown as T)) };
  } catch (err) {
    return { ok: false, message: networkErrorMessage(err) };
  }
}

/** 构造带 token 的请求头 */
function authHeaders(token: string): Record<string, string> {
  return { authorization: token, 'content-type': 'application/json' };
}

/**
 * 登录换取 token
 *
 * @param url AList 地址
 * @param username 账号
 * @param password 密码
 */
export async function alistLogin(
  url: string,
  username: string,
  password: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AlistResult<{ token: string }>> {
  return alistFetch<{ token: string }>(
    `${base(url)}/api/auth/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
    timeoutMs,
  );
}

/**
 * 取（并缓存）管理员 token
 *
 * @param cfg 网盘配置
 * @param kind 账号类型：admin（服务端调用）/ uploader（浏览器直传）
 */
export async function getAlistToken(
  cfg: NetdiskConfig,
  kind: 'admin' | 'uploader' = 'admin',
): Promise<AlistResult<{ token: string }>> {
  const username = kind === 'admin' ? cfg.adminUsername : cfg.uploaderUsername;
  const password = kind === 'admin' ? cfg.adminPassword : cfg.uploaderPassword;
  if (!cfg.baseUrl || !username || !password) {
    return { ok: false, message: kind === 'admin' ? '未配置中转服务地址或管理员账号' : '未配置用于直传的受限子账号' };
  }
  const cacheKey = `${base(cfg.baseUrl)}|${username}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return { ok: true, data: { token: hit.token } };

  const res = await alistLogin(cfg.baseUrl, username, password);
  if (!res.ok) return res;
  const token = res.data?.token;
  if (!token) return { ok: false, message: '登录成功但未返回 token（AList 版本可能不兼容）' };
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return { ok: true, data: { token } };
}

/** 清除某个地址的 token 缓存（401 后重试用） */
export function clearAlistTokenCache(url?: string): void {
  if (!url) {
    tokenCache.clear();
    return;
  }
  const prefix = base(url);
  for (const k of [...tokenCache.keys()]) if (k.startsWith(`${prefix}|`)) tokenCache.delete(k);
}

/** 当前用户信息（探活用） */
export async function alistMe(url: string, token: string): Promise<AlistResult<{ username?: string; id?: number; role?: number }>> {
  return alistFetch(`${base(url)}/api/me`, { method: 'GET', headers: { authorization: token } }, DEFAULT_TIMEOUT_MS);
}

/**
 * 列出目录
 *
 * @param path AList 虚拟路径
 * @param page 页码（1 起）
 * @param perPage 每页条数
 */
export async function alistList(
  url: string,
  token: string,
  path: string,
  page = 1,
  perPage = 100,
  refresh = false,
): Promise<AlistResult<AlistListData>> {
  return alistFetch<AlistListData>(
    `${base(url)}/api/fs/list`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ path, password: '', page, per_page: perPage, refresh, order_by: 'name', order_direction: 'asc' }),
    },
    DEFAULT_TIMEOUT_MS,
  );
}

/** 取单文件详情（含 raw_url 下载直链） */
export async function alistGet(url: string, token: string, path: string): Promise<AlistResult<AlistFileDetail>> {
  return alistFetch<AlistFileDetail>(
    `${base(url)}/api/fs/get`,
    { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ path, password: '' }) },
    DEFAULT_TIMEOUT_MS,
  );
}

/** 新建目录 */
export async function alistMkdir(url: string, token: string, path: string): Promise<AlistResult<null>> {
  return alistFetch<null>(
    `${base(url)}/api/fs/mkdir`,
    { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ path }) },
    DEFAULT_TIMEOUT_MS,
  );
}

/** 删除（同目录下多个名字） */
export async function alistRemove(
  url: string,
  token: string,
  dir: string,
  names: string[],
): Promise<AlistResult<null>> {
  return alistFetch<null>(
    `${base(url)}/api/fs/remove`,
    { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ dir, names }) },
    DEFAULT_TIMEOUT_MS,
  );
}

/**
 * 跨存储复制（大文件转存的关键一步）
 *
 * 由 AList 内部执行复制，**不受浏览器请求超时约束**，因此绕开了
 * 「浏览器直传蓝奏云 120s 超时」的限制：先落本地暂存区，再复制到厂商网盘。
 *
 * ⚠️ AList 的复制对大文件是**异步任务**（返回 `tasks`），任务进行中时源文件被占用
 * 无法删除 —— 调用方应先 `waitForCopyTasks()` 等任务结束，再清理暂存。
 */
export async function alistCopy(
  url: string,
  token: string,
  srcDir: string,
  dstDir: string,
  names: string[],
): Promise<AlistResult<{ tasks?: Array<{ id?: string }> }>> {
  return alistFetch<{ tasks?: Array<{ id?: string }> }>(
    `${base(url)}/api/fs/copy`,
    { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ src_dir: srcDir, dst_dir: dstDir, names }) },
    30_000,
  );
}

/**
 * 等待复制任务结束（轮询未完成列表）
 *
 * AList 的 `GET /api/task/copy/undone` 返回当前未完成的复制任务 id 数组；
 * 目标 id 全部消失即视为结束。轮询间隔 800ms，超时返回 false（调用方决定是否仍尝试清理）。
 *
 * @param ids 待等待的任务 id（copy 响应里的 `tasks[].id`）
 * @param timeoutMs 最长等待
 * @returns 任务是否全部结束（含超时返回 false）
 */
export async function waitForCopyTasks(
  url: string,
  token: string,
  ids: string[],
  timeoutMs = 25_000,
): Promise<boolean> {
  if (ids.length === 0) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await alistFetch<string[]>(`${base(url)}/api/task/copy/undone`, { method: 'GET', headers: { authorization: token } }, 10_000);
    if (!r.ok) return false;
    const undone = Array.isArray(r.data) ? r.data : [];
    if (!ids.some((id) => undone.includes(id))) return true;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

/**
 * 上传（服务端转发小文件用）
 *
 * AList 的 `PUT /api/fs/put` 语义：body 即文件原始字节，
 * 目标路径通过 `File-Path` 请求头传递（需 URL 编码）。
 *
 * @param dir 目标目录
 * @param filename 目标文件名
 * @param body 文件字节（ReadableStream / ArrayBuffer）
 */
export async function alistPut(
  url: string,
  token: string,
  dir: string,
  filename: string,
  body: BodyInit,
): Promise<AlistResult<null>> {
  const fullPath = `${dir.replace(/\/+$/, '')}/${filename}`;
  return alistFetch<null>(
    `${base(url)}/api/fs/put`,
    {
      method: 'PUT',
      headers: {
        authorization: token,
        // AList 要求文件路径经 URL 编码放在请求头里
        'file-path': encodeURIComponent(fullPath),
        'as-task': 'false',
        'content-type': 'application/octet-stream',
      },
      body,
    },
    UPLOAD_TIMEOUT_MS,
  );
}

/** 探活结果 */
export interface AlistTestResult {
  ok: boolean;
  message: string;
  /** 分步结果（供 UI 展示详细诊断） */
  steps: Array<{ name: string; ok: boolean; message: string }>;
}

/**
 * 连通性探活（「测试连接」按钮）
 *
 * 依次验证：管理员登录 → 身份确认 → 管理目录可列（**会真正触发存储驱动，
 * 因此能顺带暴露蓝奏云登录态失效**）→ 暂存目录可访问 → 子账号可用（可选）。
 * 每一步独立记录结果，便于精确定位是哪一环出问题。
 */
export async function testAlistConnection(
  cfg: NetdiskConfig,
  overrides?: Partial<Pick<NetdiskConfig, 'baseUrl' | 'adminUsername' | 'adminPassword' | 'uploaderUsername' | 'uploaderPassword' | 'managePath' | 'stagingDir'>>,
): Promise<AlistTestResult> {
  const c: NetdiskConfig = { ...cfg, ...overrides };
  const steps: AlistTestResult['steps'] = [];
  const push = (name: string, ok: boolean, message: string): void => {
    steps.push({ name, ok, message });
  };

  if (!c.baseUrl) return { ok: false, message: '请先填写中转服务地址', steps };
  if (!c.adminUsername || !c.adminPassword) return { ok: false, message: '请先填写管理员账号与密码', steps };

  // 1. 登录
  clearAlistTokenCache(c.baseUrl);
  const login = await alistLogin(c.baseUrl, c.adminUsername, c.adminPassword);
  if (!login.ok) {
    push('登录', false, login.message);
    return { ok: false, message: login.message, steps };
  }
  const token = login.data.token;
  push('登录', true, '管理员登录成功');

  // 2. 身份
  const me = await alistMe(c.baseUrl, token);
  push('身份', me.ok, me.ok ? `当前账号：${me.data?.username ?? c.adminUsername}` : me.message);

  // 3. 管理目录可列（触发存储驱动 → 可暴露厂商网盘登录态问题）
  const list = await alistList(c.baseUrl, token, c.managePath, 1, 1, true);
  push(
    '管理目录',
    list.ok,
    list.ok ? `目录「${c.managePath}」可访问（${list.data.total} 项）` : `目录「${c.managePath}」不可访问：${list.message}`,
  );

  // 4. 暂存目录（大文件直传需要）
  if (c.stagingDir) {
    const staging = await alistList(c.baseUrl, token, c.stagingDir, 1, 1);
    push('暂存目录', staging.ok, staging.ok ? `暂存目录「${c.stagingDir}」可用` : `暂存目录不可用：${staging.message}`);
  }

  // 5. 受限子账号（浏览器直传需要）
  if (c.uploaderUsername && c.uploaderPassword) {
    const up = await alistLogin(c.baseUrl, c.uploaderUsername, c.uploaderPassword);
    push('直传子账号', up.ok, up.ok ? `子账号 ${c.uploaderUsername} 登录成功` : `子账号登录失败：${up.message}`);
  } else {
    push('直传子账号', false, '未配置受限子账号（大文件直传不可用，小文件仍可经服务器上传）');
  }

  const failed = steps.filter((s) => !s.ok);
  const criticalFailed = steps.slice(0, 1).some((s) => !s.ok);
  if (criticalFailed) return { ok: false, message: '连接失败：无法登录中转服务', steps };
  if (failed.length > 0) {
    return { ok: true, message: `基本连通（${failed.length} 项待处理：${failed.map((f) => f.name).join('、')}）`, steps };
  }
  return { ok: true, message: '全部检查通过：中转服务、管理目录、暂存目录、直传子账号均正常', steps };
}
