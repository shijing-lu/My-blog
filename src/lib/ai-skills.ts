import { createHash } from "node:crypto";
import { readFile, realpath, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, dbWrite } from "../../db";
import { aiSkillVersions, settings } from "../../db/schema.sqlite";
import { ensureAiTables } from "./ai-store";
import normalizer from "../ai-skills/note-normalizer/SKILL.md?raw";
import structured from "../ai-skills/my-blog-structured-notes/SKILL.md?raw";
import syntaxManual from "../../docs/Markdown-语法手册.md?raw";

export const SKILL_CATALOG = [
  {
    id: "note-normalizer",
    name: "通用笔记整理",
    description: "识别笔记类型，规范化整理；学习笔记按需读取结构化规范。",
  },
  {
    id: "my-blog-structured-notes",
    name: "结构化学习笔记",
    description: "以 My-Blog 扩展 Markdown 整理知识手册、例题和复习笔记。",
  },
] as const;
export type SkillId = (typeof SKILL_CATALOG)[number]["id"];
export const skillIdValid = (id: string): id is SkillId =>
  SKILL_CATALOG.some((s) => s.id === id);
function skillDescription(source: string, fallback: string) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1];
  const lines = front?.split(/\r?\n/) ?? [],
    index = lines.findIndex((line) => /^description:/.test(line));
  if (index < 0) return fallback;
  let text = lines[index]!.replace(/^description:\s*/, "").trim();
  if (/^[|>][-+]?$/.test(text))
    text = lines
      .slice(index + 1)
      .filter(
        (line, i, all) =>
          /^\s+/.test(line) && all.slice(0, i).every((p) => /^\s+/.test(p)),
      )
      .map((line) => line.trim())
      .join(" ");
  if (text.startsWith('"'))
    try {
      text = JSON.parse(text);
    } catch {
      /* retain literal metadata */
    }
  else if (text.startsWith("'") && text.endsWith("'"))
    text = text.slice(1, -1).replace(/''/g, "'");
  return typeof text === "string" && text.trim() ? text.trim() : fallback;
}
const defaults = {
  "note-normalizer": normalizer,
  "my-blog-structured-notes": structured,
};
export const hashSource = (source: string) =>
  createHash("sha256").update(source).digest("hex");
export interface SkillSnapshot {
  id: SkillId;
  version: string;
  source: string;
  resources: Record<string, string>;
  kind: "managed" | "mount";
}
type Mounts = Partial<Record<SkillId, string>>;

export async function skillVersions(id: SkillId) {
  if (!(await ensureAiTables())) throw new Error("技能数据层不可用");
  const seed = {
    id: `seed-${id}-${hashSource(defaults[id]).slice(0, 16)}`,
    skillId: id,
    parentId: null,
    source: defaults[id],
    resources: "{}",
    createdAt: "2026-10-08T00:00:00.000Z",
  };
  // Seed only a genuinely empty skill store. Updated bundled files never replace user revisions.
  let rows = await db
    .select()
    .from(aiSkillVersions)
    .where(eq(aiSkillVersions.skillId, id));
  if (!rows.length) {
    await dbWrite((d) =>
      d.insert(aiSkillVersions).values(seed).onConflictDoNothing(),
    );
    rows = await db
      .select()
      .from(aiSkillVersions)
      .where(eq(aiSkillVersions.skillId, id));
  }
  const parents = new Set(
    rows.flatMap((r) =>
      r.parentId ? (JSON.parse(r.parentId) as string[]) : [],
    ),
  );
  return { rows, heads: rows.filter((r) => !parents.has(r.id)) };
}
async function readMounts(): Promise<Mounts> {
  if (process.env.DESKTOP_MODE !== "1") return {};
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "ai_skill_mounts"))
    .limit(1);
  if (row) return JSON.parse(row.value) as Mounts;
  const mounts: Mounts = {};
  for (const skill of SKILL_CATALOG) {
    const directory = path.join(homedir(), ".agents", "skills", skill.id);
    try {
      await stat(path.join(directory, "SKILL.md"));
      mounts[skill.id] = directory;
    } catch {
      /* New installations may use managed skills. */
    }
  }
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({
        key: "ai_skill_mounts",
        value: JSON.stringify(mounts),
        updatedAt: new Date(),
      })
      .onConflictDoNothing(),
  );
  return mounts;
}
async function mountResources(
  directory: string,
): Promise<Record<string, string>> {
  const resources: Record<string, string> = {};
  let bytes = 0;
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 5) throw new Error("技能参考目录嵌套超过 5 层");
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        entry.name === "node_modules"
      )
        continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(file, depth + 1);
        continue;
      }
      if (
        !/\.(md|txt|json)$/i.test(entry.name) ||
        file === path.join(directory, "SKILL.md")
      )
        continue;
      const size = (await stat(file)).size;
      if (size > 200000 || bytes + size > 1000000)
        throw new Error("技能参考文件过大，请减少资源体积");
      bytes += size;
      resources[path.relative(directory, file).split(path.sep).join("/")] =
        await readFile(file, "utf8");
    }
  };
  await walk(directory, 0);
  return resources;
}
export async function setSkillMount(id: SkillId, directory: string | null) {
  if (process.env.DESKTOP_MODE !== "1")
    throw new Error("本机技能目录仅可在桌面端挂载");
  const mounts = await readMounts();
  if (directory) {
    const resolved = await realpath(directory);
    const source = await readFile(path.join(resolved, "SKILL.md"), "utf8");
    if (!source.trim() || source.length > 200000)
      throw new Error("SKILL.md 为空或过大");
    mounts[id] = resolved;
  } else delete mounts[id];
  await dbWrite((d) =>
    d
      .insert(settings)
      .values({
        key: "ai_skill_mounts",
        value: JSON.stringify(mounts),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(mounts), updatedAt: new Date() },
      }),
  );
}
export async function readSkill(id: SkillId): Promise<SkillSnapshot> {
  const mounts = await readMounts();
  if (mounts[id]) {
    const directory = await realpath(mounts[id]!);
    const source = await readFile(path.join(directory, "SKILL.md"), "utf8");
    if (!source.trim() || source.length > 200000)
      throw new Error(`${id} 的 SKILL.md 为空或过大`);
    const resources = await mountResources(directory);
    return {
      id,
      source,
      version: hashSource(source + JSON.stringify(resources)),
      resources,
      kind: "mount",
    };
  }
  const { heads } = await skillVersions(id);
  if (heads.length !== 1)
    throw new Error(
      `技能 ${id} 有 ${heads.length} 个并行版本，请先在 AI 设置中合并或选择版本`,
    );
  const head = heads[0]!;
  return {
    id,
    source: head.source,
    version: head.id,
    resources: JSON.parse(head.resources),
    kind: "managed",
  };
}
export async function saveSkill(
  id: SkillId,
  source: string,
  expectedHeads: string[],
  resources: Record<string, string> = {},
) {
  if (!source.trim() || source.length > 200000)
    throw new Error("技能内容为空或超过 200000 字");
  if (
    !resources ||
    Array.isArray(resources) ||
    Object.values(resources).some((value) => typeof value !== "string")
  )
    throw new Error("技能参考文件必须是相对路径到完整文本的映射");
  if (
    JSON.stringify(resources).length > 1000000 ||
    Object.keys(resources).some(
      (k) => k.startsWith("/") || k.includes("..") || k.includes("\\"),
    )
  ) {
    throw new Error("技能资源大小或相对路径不合法");
  }
  const { heads } = await skillVersions(id);
  if (
    heads
      .map((h) => h.id)
      .sort()
      .join() !== [...expectedHeads].sort().join()
  )
    throw new Error("技能已变化，请重新读取后保存");
  const revision = {
    id: crypto.randomUUID(),
    skillId: id,
    parentId: JSON.stringify(expectedHeads),
    source,
    resources: JSON.stringify(resources),
    createdAt: new Date().toISOString(),
  };
  await dbWrite((d) => d.insert(aiSkillVersions).values(revision));
  return revision.id;
}
export function readSkillResource(snapshot: SkillSnapshot, resource: string) {
  if (resource === "docs/Markdown-语法手册.md") return syntaxManual;
  const text = snapshot.resources[resource];
  if (typeof text !== "string")
    throw new Error("该资源未登记；请在技能设置中导入，不能读取任意本机文件");
  return text;
}
export async function listSkillSources() {
  const mounts = await readMounts();
  return Promise.all(
    SKILL_CATALOG.map(async (s) => {
      let mountedSource: string | undefined, mountError: string | undefined;
      if (mounts[s.id])
        try {
          mountedSource = (await readSkill(s.id)).source;
        } catch (e) {
          mountError = e instanceof Error ? e.message : "读取本机技能失败";
        }
      return {
        ...s,
        ...(await skillVersions(s.id)),
        mountedSource,
        mountError,
        mount: mounts[s.id] || null,
        desktop: process.env.DESKTOP_MODE === "1",
      };
    }),
  );
}
export async function discoverSkills(pinned?: Map<string, SkillSnapshot>) {
  return Promise.all(
    SKILL_CATALOG.map(async (skill) => {
      try {
        const snapshot = pinned?.get(skill.id) ?? (await readSkill(skill.id));
        pinned?.set(skill.id, snapshot);
        return {
          ...skill,
          description: skillDescription(snapshot.source, skill.description),
          version: snapshot.version,
          available: true,
        };
      } catch (e) {
        return {
          ...skill,
          available: false,
          error: e instanceof Error ? e.message : "技能不可用",
        };
      }
    }),
  );
}
