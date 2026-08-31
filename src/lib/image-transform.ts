/**
 * 图片按需转换（基于 sharp）
 *
 * 用途：DB base64 图片（`/api/images/[id]`）在请求时按 `?w=&f=` 缩放/转格式，
 * 首页卡片只需 ~600px WebP 而非 2MB 原图 → 显著降 LCP 与页面字节。
 *
 * 设计：
 * - 仅处理光栅图（png/jpeg/gif/webp/avif）；SVG 为矢量，原样输出不走 sharp。
 * - sharp 采用**惰性动态 import**（`import('sharp')`）：
 *   · 不在模块顶层加载 → 路由注册不因 sharp native binary 缺失而失败，
 *     无参数（原图）路径始终可用；
 *   · 与 Astro 自带图片服务的加载方式一致，真实 Vercel（Linux）可用。
 * - 转换失败（损坏/不支持/native 加载失败）由调用方回落原图，绝不返回 500。
 * - 缩放默认不放大（withoutEnlargement），quality 78 在体积/质量间均衡。
 * - 图片 id 为 uuid，内容永不变 → 响应可 `public, max-age=31536000, immutable`，
 *   首次请求转换，后续 CDN/边缘命中。
 */

/** 可转换的输入 MIME（光栅；SVG 除外） */
const TRANSFORMABLE_INPUT = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

/** 允许的输出格式 */
const OUTPUT_FORMATS = new Set(['webp', 'avif', 'jpeg', 'png']);

/** 输出格式 → MIME */
const FORMAT_MIME: Record<string, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** 转换参数 */
export interface TransformOpts {
  /** 最大宽度（像素），不放大 */
  width?: number;
  /** 输出格式，默认 webp */
  format?: string;
  /** 质量 1-100，默认 78 */
  quality?: number;
}

/** 转换结果 */
export interface TransformResult {
  buffer: Buffer;
  mime: string;
}

/** 该 MIME 是否可走 sharp 转换（SVG 等矢量/未知类型返回 false） */
export function isTransformableInput(mime: string): boolean {
  return TRANSFORMABLE_INPUT.has(mime.toLowerCase());
}

/** 规范化输出格式：非法值回落 webp */
export function normalizeFormat(format: string | undefined): 'webp' | 'avif' | 'jpeg' | 'png' {
  return (format && OUTPUT_FORMATS.has(format.toLowerCase()) ? format.toLowerCase() : 'webp') as
    | 'webp'
    | 'avif'
    | 'jpeg'
    | 'png';
}

/** 规范化宽度：整数，限制在 [1, 2400]，非法返回 undefined（不缩放） */
export function normalizeWidth(width: string | null): number | undefined {
  if (!width) return undefined;
  const n = Number.parseInt(width, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, 2400);
}

/**
 * 按需转换图片：缩放 + 转格式
 *
 * @param input 原始图片二进制
 * @param opts 转换参数
 * @returns 转换后的二进制与 MIME
 * @throws 转换失败时抛错（调用方回落原图）
 */
export async function transformImage(
  input: Buffer,
  opts: TransformOpts,
): Promise<TransformResult> {
  const sharp = (await import('sharp')).default;
  const format = normalizeFormat(opts.format);
  const quality = clampQuality(opts.quality ?? 78);
  let pipeline = sharp(input);

  if (opts.width) {
    pipeline = pipeline.resize({
      width: opts.width,
      withoutEnlargement: true,
      fit: 'inside',
    });
  }

  switch (format) {
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png({ quality, compressionLevel: 9 });
      break;
  }

  const buffer = await pipeline.toBuffer();
  return { buffer, mime: FORMAT_MIME[format] ?? 'image/webp' };
}

/** 质量值收敛到 1-100 */
function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return 78;
  return Math.max(1, Math.min(100, Math.round(q)));
}
