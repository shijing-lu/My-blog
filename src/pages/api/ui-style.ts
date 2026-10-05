import type { APIRoute } from 'astro';
import { hasAnyPermission } from '@/lib/admin-auth';
import { json, readJson } from '@/lib/api';
import { isUiStyle, type UiStyleSettings } from '@/lib/ui-style';
import { getSiteUiStyle, saveSiteUiStyle } from '@/lib/ui-style-server';

export const prerender = false;
const headers = { 'cache-control': 'no-store' };

export const GET: APIRoute = async () => {
  try {
    return json({ defaultStyle: await getSiteUiStyle({ fallbackOnError: false }) }, { headers });
  } catch (error) {
    console.error('[api/ui-style] GET', error);
    return json({ error: '读取界面风格失败' }, { status: 500, headers });
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!(await hasAnyPermission(cookies, ['settings']))) {
    return json({ error: '无权修改站点设置' }, { status: 403, headers });
  }
  const body = await readJson<Partial<UiStyleSettings>>(request);
  if (!body || !isUiStyle(body.defaultStyle)) {
    return json({ error: '请选择现有风格或 Google Material 3' }, { status: 400, headers });
  }
  try {
    return json({ defaultStyle: await saveSiteUiStyle(body.defaultStyle) }, { headers });
  } catch (error) {
    console.error('[api/ui-style] PUT', error);
    return json({ error: '保存界面风格失败，请重试' }, { status: 500, headers });
  }
};
