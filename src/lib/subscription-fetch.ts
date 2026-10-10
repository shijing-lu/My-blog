/** Subscription-only transport. Keep API gateways and local callbacks untouched. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EnvHttpProxyAgent } from 'undici';

const run = promisify(execFile);
type ProxyConfig = { httpProxy?: string; httpsProxy?: string; noProxy: string };
const localBypass = 'localhost,127.0.0.1,::1';
let systemCache: { until: number; config: ProxyConfig } | undefined;
let agentCache: { key: string; agent: EnvHttpProxyAgent } | undefined;

function proxyUrl(value?: string) {
  if (!value) return undefined;
  const url = new URL(value.includes('://') ? value : `http://${value}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('订阅代理需要 HTTP 或 HTTPS 地址');
  return url.toString();
}

/** WinINet supports either a single proxy or semicolon-separated protocol entries. */
export function windowsProxyConfig(registry: string): ProxyConfig {
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(registry);
  const server = registry.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
  const bypass = registry.match(/ProxyOverride\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
  const noProxy = [localBypass, ...(bypass?.split(';').filter(v => v !== '<local>') || [])].join(',');
  if (!enabled || !server) return { noProxy };
  if (!server.includes('=')) return { httpProxy: proxyUrl(server), httpsProxy: proxyUrl(server), noProxy };
  const entries = Object.fromEntries(server.split(';').map(entry => entry.trim().split('=')));
  return { httpProxy: proxyUrl(entries.http), httpsProxy: proxyUrl(entries.https || entries.http), noProxy };
}

async function proxyConfig(): Promise<ProxyConfig> {
  const http = process.env.http_proxy || process.env.HTTP_PROXY;
  const https = process.env.https_proxy || process.env.HTTPS_PROXY;
  const all = process.env.all_proxy || process.env.ALL_PROXY;
  if (http || https || all) return {
    httpProxy: proxyUrl(http || all), httpsProxy: proxyUrl(https || http || all),
    noProxy: [localBypass, process.env.no_proxy || process.env.NO_PROXY || ''].join(','),
  };
  if (process.platform !== 'win32' || (process.env.DESKTOP_MODE !== '1' && process.env.ANDROID_MODE !== '1')) return { noProxy: localBypass };
  if (systemCache && systemCache.until > Date.now()) return systemCache.config;
  let config: ProxyConfig;
  try {
    const { stdout } = await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { windowsHide: true, timeout: 2000, maxBuffer: 64 * 1024 });
    config = windowsProxyConfig(stdout);
  } catch {
    throw Error('无法读取 Windows 系统代理，请配置 HTTPS_PROXY 后重试');
  }
  systemCache = { config, until: Date.now() + 15_000 };
  return config;
}

export const subscriptionFetch: typeof fetch = async (input, init) => {
  const config = await proxyConfig();
  if (!config.httpProxy && !config.httpsProxy) return fetch(input, init);
  const key = JSON.stringify(config);
  if (!agentCache || agentCache.key !== key) {
    const old = agentCache?.agent;
    agentCache = { key, agent: new EnvHttpProxyAgent({ ...config, httpProxy: config.httpProxy || '', httpsProxy: config.httpsProxy || '' }) };
    // Drain existing streams when the user changes the system proxy.
    void old?.close().catch(() => {});
  }
  return fetch(input, { ...init, dispatcher: agentCache.agent } as RequestInit);
};
