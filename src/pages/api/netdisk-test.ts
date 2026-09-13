/**
 * POST /api/netdisk-test —— 网盘中转服务（AList）连接测试（管理员）
 *
 * 请求体字段全部可选，缺省回落 DB 已存配置；密码留空 = 用已存密码。
 * { baseUrl?, adminUsername?, adminPassword?, uploaderUsername?, uploaderPassword?, managePath?, stagingDir? }
 *
 * 返回 { ok, message, steps }：steps 为分步诊断结果（登录 / 身份 / 管理目录 /
 * 暂存目录 / 直传子账号），便于精确定位是哪一环不通。
 */
import type { APIRoute } from 'astro';
import { guardManager, json, readJsonLoose } from '@/lib/api';
import { getNetdiskConfig, type NetdiskConfig } from '@/lib/netdisk-config';
import { testAlistConnection } from '@/lib/alist';

export const prerender = false;

/** 表单非空才覆盖已存配置（密码留空 = 保留原值） */
function pick(formValue: unknown, saved: string): string {
  return typeof formValue === 'string' && formValue.trim() !== '' ? formValue.trim() : saved;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = await guardManager(cookies);
  if (denied) return denied;
  const body = await readJsonLoose<Partial<NetdiskConfig>>(request);
  try {
    const saved = await getNetdiskConfig();
    const overrides: Partial<NetdiskConfig> = {
      baseUrl: pick(body.baseUrl, saved.baseUrl),
      adminUsername: pick(body.adminUsername, saved.adminUsername),
      adminPassword: pick(body.adminPassword, saved.adminPassword),
      uploaderUsername: pick(body.uploaderUsername, saved.uploaderUsername),
      uploaderPassword: pick(body.uploaderPassword, saved.uploaderPassword),
      managePath: pick(body.managePath, saved.managePath),
      stagingDir: pick(body.stagingDir, saved.stagingDir),
    };
    const result = await testAlistConnection(saved, overrides);
    return json(result);
  } catch (err) {
    console.error('[api/netdisk-test]', err);
    return json({ ok: false, message: '测试失败', steps: [] }, 500);
  }
};
