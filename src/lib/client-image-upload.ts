/**
 * 客户端图片压缩上传工具（仅浏览器环境）
 *
 * 背景：Vercel Serverless 函数请求体上限 4.5MB，base64 膨胀约 33%，
 * 大图直传必然 413。上传前必须压缩：缩放 + JPEG 降质循环，
 * 确保 base64 体积低于上限（默认 3.5MB，给 JSON 包裹留余量）。
 */

export interface CompressedImage {
  base64: string;
  mime: string;
}

const DEFAULT_MAX_DIMENSION = 2048;
/** base64 上限（解码约 2.6MB），加 JSON 开销后仍小于平台 4.5MB 限制 */
const DEFAULT_MAX_BASE64 = 3.5 * 1024 * 1024;

/** 读取文件为 dataURL */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 解码为 HTMLImageElement */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = src;
  });
}

/** canvas 缩放渲染并转 JPEG base64（白底避免透明变黑） */
function renderToJpeg(img: HTMLImageElement, maxDimension: number, quality: number): string {
  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
}

/**
 * 压缩图片至可上传体积（base64 不超过 maxBase64Bytes）
 *
 * - GIF / SVG：不压缩直接上传（动图/矢量），超过上限报错
 * - 其余：转 JPEG，先缩尺寸（2048→1600→1200→900）再降质量（0.85→0.7→0.5→0.35）
 *
 * @param file 用户选择的图片文件
 * @param opts 可选：maxDimension 最大边长；maxBase64Bytes base64 体积上限
 */
export async function compressImageForUpload(
  file: File,
  opts?: { maxDimension?: number; maxBase64Bytes?: number },
): Promise<CompressedImage> {
  const maxDim = opts?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxB64 = opts?.maxBase64Bytes ?? DEFAULT_MAX_BASE64;

  // GIF（动图）与 SVG（矢量）不压缩，仅做体积校验
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    const dataUrl = await readAsDataURL(file);
    const b64 = dataUrl.split(',')[1] ?? '';
    if (b64.length > maxB64) throw new Error('图片过大，请压缩后上传');
    return { base64: b64, mime: file.type === 'image/gif' ? 'image/gif' : 'image/svg+xml' };
  }

  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);
  const dimensions = [maxDim, 1600, 1200, 900];
  const qualities = [0.85, 0.7, 0.5, 0.35];
  for (const d of dimensions) {
    for (const q of qualities) {
      const b64 = renderToJpeg(img, d, q);
      if (b64.length <= maxB64) return { base64: b64, mime: 'image/jpeg' };
    }
  }
  throw new Error('图片过大，压缩后仍超过上传限制');
}
