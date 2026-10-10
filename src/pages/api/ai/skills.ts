import type { APIRoute } from "astro";
import { isTopAdmin } from "../../../lib/admin-auth";
import { json, readJson } from "../../../lib/api";
import {
  listSkillSources,
  saveSkill,
  setSkillMount,
  skillIdValid,
} from "../../../lib/ai-skills";
const reply = (data: unknown, status = 200) =>
  json(data, { status, headers: { "cache-control": "private, no-store" } });
export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isTopAdmin(cookies)))
    return reply({ error: "仅站主可管理技能" }, 403);
  try {
    return reply({ skills: await listSkillSources() });
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "读取技能失败" },
      503,
    );
  }
};
export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!(await isTopAdmin(cookies)))
    return reply({ error: "仅站主可管理技能" }, 403);
  const body = await readJson<{
    id: string;
    source?: string;
    heads?: string[];
    resources?: Record<string, string>;
    mount?: string | null;
  }>(request);
  if (!body || !skillIdValid(body.id))
    return reply({ error: "技能不存在" }, 400);
  try {
    if ("mount" in body) {
      if (body.mount !== null && typeof body.mount !== "string")
        throw new Error("挂载路径不合法");
      await setSkillMount(body.id, body.mount ?? null);
    } else {
      if (
        typeof body.source !== "string" ||
        !Array.isArray(body.heads) ||
        !body.heads.every((h) => typeof h === "string")
      )
        throw new Error("技能内容或版本不合法");
      await saveSkill(body.id, body.source, body.heads, body.resources);
    }
    return reply({ skills: await listSkillSources() });
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "保存技能失败" },
      409,
    );
  }
};
