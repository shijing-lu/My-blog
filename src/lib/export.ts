/**
 * 文章导出（Markdown 附件）纯函数层
 *
 * 只负责「元数据 + 源文 → 可下载文档」的纯计算，不做任何 IO/数据库/框架调用：
 * - front-matter 组装（YAML 双引号标量，转义交给 JSON.stringify）
 * - 文件名清洗与 Content-Disposition（中文走 RFC 5987 `filename*`）
 * - 站内相对路径绝对化（跳过围栏代码块，导出件在本地打开图片/链接仍可用）
 * 供 /api/export/* 端点与未来其他导出入口复用。
 */

export interface ExportMeta {
  title: string;
  tags?: string[];
  summary?: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  /** 追加的 front-matter 标量字段（slug/type/nodeId/bundleId 等） */
  extra?: Record<string, string | number | undefined>;
}

export interface MarkdownExportResult {
  body: string;
  filename: string;
  headers: Record<string, string>;
}

/** YAML 双引号标量（JSON 字符串是其合法子集） */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** 组装 front-matter + 正文的完整 Markdown 文档 */
export function buildMarkdownDocument(meta: ExportMeta, source: string): string {
  const lines: string[] = ['---', `title: ${yamlString(meta.title)}`];
  for (const [key, value] of Object.entries(meta.extra ?? {})) {
    if (value !== undefined) lines.push(`${key}: ${yamlString(String(value))}`);
  }
  if (meta.tags && meta.tags.length > 0) lines.push(`tags: ${JSON.stringify(meta.tags)}`);
  if (meta.summary) lines.push(`summary: ${yamlString(meta.summary)}`);
  if (meta.createdAt) lines.push(`date: ${yamlString(meta.createdAt.toISOString())}`);
  if (meta.updatedAt) lines.push(`updated: ${yamlString(meta.updatedAt.toISOString())}`);
  lines.push('---', '', source);
  return lines.join('\n');
}

/** 清洗为跨平台安全的文件名主体（不含扩展名）：去非法字符、折叠空白、限长 */
export function sanitizeFilename(name: string, fallback = 'article'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[_. ]+|[_. ]+$/g, '')
    .slice(0, 100)
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

/**
 * 附件下载响应头值。ASCII 名直接引用；含非 ASCII（如中文标题）时追加
 * RFC 5987 的 `filename*=UTF-8''<pct-encoded>`，并保留 ASCII 兜底名。
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '').replace(/^\.+(?=\.)/, '');
  const fallback = /^[.]/.test(ascii) || ascii === '' ? `export${ascii.replace(/.*(\.[^.]+$)/, '$1')}` : ascii;
  if (fallback === filename) return `attachment; filename="${filename}"`;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** 把正文里的站内绝对路径（/xxx）补全为 origin 前缀；围栏代码块内不改写 */
export function absolutizeRelativeUrls(markdown: string, origin: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line
        .replace(/\]\(\/(?!\/)/g, `](${origin}/`)
        .replace(/src="\//g, `src="${origin}/`)
        .replace(/url\(\//g, `url(${origin}/`);
    })
    .join('\n');
}

/** 一步到位：元数据 + 源文 + 站点 origin → 下载体、文件名与响应头 */
export function buildMarkdownExport(input: {
  meta: ExportMeta;
  source: string;
  origin: string;
}): MarkdownExportResult {
  const body = buildMarkdownDocument(
    input.meta,
    absolutizeRelativeUrls(input.source, input.origin),
  );
  const filename = `${sanitizeFilename(input.meta.title)}.md`;
  return {
    body,
    filename,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': contentDisposition(filename),
    },
  };
}
