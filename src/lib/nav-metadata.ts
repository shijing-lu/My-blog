/**
 * 网址导航·网站元数据抓取（简介）
 *
 * - fetch 目标网站首页，解析 <meta name="description"> / og:description；
 * - SSRF 防护：仅 http/https、拒绝内网/本地地址、8s 超时、限制响应大小；
 * - 抓取失败返回 null（不阻塞添加网站，简介留空即可）。
 */

/** 内网/保留地址前缀（IPv4 简判） */
const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|172\.(1[6-9]|2\d|3[01])\.)/;

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  return PRIVATE_IP_RE.test(h);
}

/** 从 HTML 中提取 description（兼容 name/content 顺序 + og:description） */
function extractDescription(html: string): string | undefined {
  const patterns = [
    /<\s*meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']*)["']/i,
    /<\s*meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']description["']/i,
    /<\s*meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']*)["']/i,
    /<\s*meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:description["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

/** 从 HTML 提取网站图标 URL（<link rel="icon"> / shortcut icon / apple-touch-icon），相对路径绝对化 */
function extractIcon(html: string, base: URL): string | undefined {
  const patterns = [
    /<\s*link[^>]+rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]+href\s*=\s*["']([^"']+)["']/i,
    /<\s*link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'](?:shortcut\s+)?icon["']/i,
    /<\s*link[^>]+rel\s*=\s*["']apple-touch-icon["'][^>]+href\s*=\s*["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const href = m[1].trim();
      try {
        return new URL(href, base).toString();
      } catch {
        return href.startsWith('http') ? href : undefined;
      }
    }
  }
  return undefined;
}

const MAX_BODY = 512 * 1024; // 只取前 512KB 解析
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/**
 * 抓取网站元数据（简介 + 图标）
 *
 * @param url 目标网址
 * @returns { desc?, icon? } 抓到的元数据（失败返回 null）
 */
export async function fetchSiteMeta(url: string): Promise<{ desc?: string; icon?: string } | null> {
  let u: URL;
  try {
    u = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (isPrivateHost(u.hostname)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const text = await res.text();
    const slice = text.slice(0, MAX_BODY);
    const desc = extractDescription(slice);
    const icon = extractIcon(slice, u);
    if (!desc && !icon) return null;
    return {
      ...(desc ? { desc: desc.slice(0, 200) } : {}),
      ...(icon ? { icon: icon.slice(0, 500) } : {}),
    };
  } catch {
    return null;
  }
}
