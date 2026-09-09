/**
 * POST /api/images —— 上传图片（管理员）
 *
 * 请求体：{ filename?, mime, data }，data 为 base64 编码的图片二进制。
 * 返回：{ ok, url: '/api/images/<id>' }（markdown 引用为 ![](url)）。
 *
 * 双通道（设置开关分流）：
 * - GitHub 图床开启且配置齐全 → 上传 GitHub 仓库，失败回落 R2 原流程（不阻断）；
 * - 开关关闭/配置不完整/GitHub 失败 → 原 R2 流程，行为与改造前完全一致。
 */
import type { APIRoute } from 'astro';
import { json } from '@/lib/api';
import { storeImage, storeImageViaGitHub, validateImageUpload } from '@/lib/images';
import { getImageBedConfig, isImageBedReady } from '@/lib/image-bed';
import { uploadToGitHub } from '@/lib/gh-image-bed';

export const prerender = false;

/** 上传处理 */
export const POST: APIRoute = async ({ request }) => {
  let body: { filename?: unknown; mime?: unknown; data?: unknown };
  try {
    body = (await request.json()) as { filename?: unknown; mime?: unknown; data?: unknown };
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const base64 = typeof body.data === 'string' ? body.data : '';
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return json({ error: '图片数据无法解码' }, 400);
  }

  const error = validateImageUpload(body.mime, base64, buffer.length);
  if (error) return json({ error }, 400);

  const mime = body.mime as string;
  try {
    // GitHub 图床分流（开关开启 + 配置齐全才走；失败回落 R2，不上报错误给前端）
    let bedConfig: Awaited<ReturnType<typeof getImageBedConfig>> | null = null;
    try {
      bedConfig = await getImageBedConfig();
    } catch {
      // 配置读取失败（如 DB 抖动）→ 视为未启用
    }
    if (bedConfig && isImageBedReady(bedConfig)) {
      const gh = await uploadToGitHub(bedConfig, buffer, mime);
      if (gh.ok) {
        const stored = await storeImageViaGitHub(mime, buffer, gh.path);
        return json({ ok: true, url: `/api/images/${stored.id}` });
      }
      console.warn('[api/images] GitHub 图床上传失败，回落 R2:', gh.error);
    }

    const stored = await storeImage(mime, base64);
    return json({ ok: true, url: `/api/images/${stored.id}` });
  } catch (err) {
    console.error('[api/images]', err);
    return json({ error: err instanceof Error ? err.message : '上传失败' }, 500);
  }
};
