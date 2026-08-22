/**
 * PATCH/DELETE /api/photos/[id] —— 修改照片元数据 / 删除照片（管理员）
 */
import type { APIRoute } from 'astro';
import { deletePhoto, getPhotoById, updatePhoto } from '@/lib/photos';
import { json } from '@/lib/api';
import { deletePhotoObject } from '@/lib/photo-storage';

export const prerender = false;

/** 修改标题/展示日期 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const patch: { title?: string; takenAt?: Date } = {};
  if (typeof body.title === 'string') {
    patch.title = body.title.slice(0, 200);
  }
  if (typeof body.takenAt === 'string') {
    const takenAt = new Date(body.takenAt);
    if (Number.isNaN(takenAt.getTime())) return json({ error: '日期不合法' }, 400);
    patch.takenAt = takenAt;
  }
  if (Object.keys(patch).length === 0) return json({ error: '没有可更新的字段' }, 400);

  const photo = await updatePhoto(id, patch);
  if (!photo) return json({ error: '照片不存在' }, 404);
  return json({
    photo: {
      id: photo.id,
      url: photo.url,
      thumbUrl: photo.thumbUrl,
      title: photo.title,
      width: photo.width,
      height: photo.height,
      takenAt: photo.takenAt.toISOString(),
    },
  });
};

/** 删除照片（DB 行 + Blob 对象） */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: '缺少 id' }, 400);

  const photo = await getPhotoById(id);
  if (!photo) return json({ error: '照片不存在' }, 404);

  await deletePhotoObject(photo.url);
  if (photo.thumbUrl) await deletePhotoObject(photo.thumbUrl);
  await deletePhoto(id);

  return json({ ok: true });
};
