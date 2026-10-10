import { useEffect, useState } from "react";
interface Revision {
  id: string;
  source: string;
  resources: string;
  createdAt: string;
}
interface Skill {
  id: string;
  name: string;
  description: string;
  rows: Revision[];
  heads: Revision[];
  mount: string | null;
  mountedSource?: string;
  mountError?: string;
  desktop: boolean;
}
export default function AiSkillsSettings() {
  const [skills, setSkills] = useState<Skill[]>([]),
    [active, setActive] = useState("note-normalizer");
  const [source, setSource] = useState(""),
    [resources, setResources] = useState("{}"),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [mount, setMount] = useState("");
  const skill = skills.find((s) => s.id === active);
  const load = async () => {
    const response = await fetch("/api/ai/skills", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取技能失败");
    setSkills(data.skills);
  };
  useEffect(() => {
    void load().catch((e) => setStatus(e.message));
  }, []);
  useEffect(() => {
    if (!skill) return;
    setSource(
      skill.mount ? skill.mountedSource || "" : skill.heads[0]?.source || "",
    );
    setResources(skill.heads[0]?.resources || "{}");
    setMount(skill.mount || "");
  }, [skill]);
  const update = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setStatus("保存中…");
    try {
      const response = await fetch("/api/ai/skills", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: active, ...payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      setSkills(data.skills);
      setStatus("已保存，下一个 AI 任务将读取新版本");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const importSkill = async (file: File | undefined) => {
    if (!file) return;
    setSource(await file.text());
    setStatus("已载入文件，保存后生效");
  };
  const exportSkill = () => {
    const url = URL.createObjectURL(
      new Blob([source], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "SKILL.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">文章编辑技能</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        AI 按需读取完整
        SKILL.md。技能修改后对新任务生效；正在进行的任务保留其读取的版本。
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {skills.map((s) => (
          <button
            type="button"
            key={s.id}
            disabled={busy}
            onClick={() => setActive(s.id)}
            className={`rounded-md border px-3 py-2 text-xs ${active === s.id ? "border-primary bg-accent" : "border-border"}`}
          >
            {s.name}
          </button>
        ))}
      </div>
      {skill && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {skill.description}
          </p>
          {skill.mountError && (
            <p className="mt-3 text-xs text-destructive">
              {skill.mountError}。请修复目录或切换站点版本；不会自动使用旧副本。
            </p>
          )}
          {skill.heads.length > 1 && (
            <p className="mt-3 text-xs text-destructive">
              检测到同步分叉。下方选择一个版本并整理内容，保存将合并这些分支；站点版本在解决前不会用于
              AI。
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs">历史版本</label>
            <select
              className="max-w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                const r = skill.rows.find((v) => v.id === e.target.value);
                if (r) {
                  setSource(r.source);
                  setResources(r.resources);
                }
              }}
            >
              <option value="">选择版本查看或恢复…</option>
              {[...skill.rows]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                    {r.id.slice(0, 12)}
                  </option>
                ))}
            </select>
            <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs">
              导入 SKILL.md
              <input
                type="file"
                accept=".md,text/markdown"
                className="hidden"
                onChange={(e) => void importSkill(e.target.files?.[0])}
              />
            </label>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs"
              onClick={exportSkill}
            >
              导出
            </button>
          </div>
          <textarea
            aria-label="技能原文"
            value={source}
            disabled={busy || !!skill.mount}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            className="mt-3 h-72 w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-ring"
          />
          <details className="mt-2 text-xs">
            <summary>技能参考文件（相对路径 → 完整文本）</summary>
            <textarea
              aria-label="技能参考文件 JSON"
              value={resources}
              onChange={(e) => setResources(e.target.value)}
              className="mt-2 h-32 w-full rounded-md border border-input bg-background p-3 font-mono"
            />
          </details>
          <button
            type="button"
            disabled={busy || !!skill.mount}
            className="mt-3 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"
            onClick={() => {
              try {
                const parsed = JSON.parse(resources);
                if (
                  !parsed ||
                  Array.isArray(parsed) ||
                  Object.values(parsed).some((v) => typeof v !== "string")
                )
                  throw new Error("参考文件必须是文本映射");
                void update({
                  source,
                  heads: skill.heads.map((h) => h.id),
                  resources: parsed,
                });
              } catch (e) {
                setStatus(
                  e instanceof Error ? e.message : "参考文件 JSON 不合法",
                );
              }
            }}
          >
            保存技能版本
          </button>
          {skill.desktop && (
            <div className="mt-5 rounded-md border border-border p-3">
              <h4 className="text-xs font-medium">本机技能目录</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                填写含 SKILL.md
                的文件夹。启用后每次任务重新读取原文件；路径只保存在本机，网页端使用站点技能版本。
              </p>
              <input
                value={mount}
                onChange={(e) => setMount(e.target.value)}
                aria-label="本机技能目录"
                placeholder="C:\Users\你的账号\.agents\skills\…"
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-md border border-border px-3 py-2 text-xs"
                  onClick={() => {
                    const desktop = (
                      window as Window & {
                        desktop?: {
                          pickSkillDirectory?: (
                            id: string,
                          ) => Promise<string | null>;
                        };
                      }
                    ).desktop;
                    if (!desktop?.pickSkillDirectory) {
                      setStatus("当前桌面壳尚未更新，请填写目录路径");
                      return;
                    }
                    void desktop.pickSkillDirectory(active).then((value) => {
                      if (value) setMount(value);
                    });
                  }}
                >
                  选择文件夹
                </button>
                <button
                  type="button"
                  disabled={busy || !mount.trim()}
                  className="rounded-md border border-border px-3 py-2 text-xs"
                  onClick={() => void update({ mount: mount.trim() })}
                >
                  挂载原文件
                </button>
                <button
                  type="button"
                  disabled={busy || !skill.mount}
                  className="rounded-md border border-border px-3 py-2 text-xs"
                  onClick={() => void update({ mount: null })}
                >
                  使用站点版本
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground" role="status">
        {status}
      </p>
    </section>
  );
}
