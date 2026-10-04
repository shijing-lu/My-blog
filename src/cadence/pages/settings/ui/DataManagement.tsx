import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import {
  buildExportBundle,
  ExportBundleSchema,
  importBundle,
  type ExportBundle,
} from "@/cadence/data/db/export";
import { db } from "@/cadence/data/db/database";
import {
  BUSINESS_TABLES,
  type BusinessTableName,
} from "@/cadence/data/db/schema";
import { emptyTrash } from "@/cadence/data/repo/soft-delete";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { Card, CardHeader } from "@/cadence/shared/ui/Card";
import { ConfirmDialog } from "@/cadence/shared/ui/ConfirmDialog";

const labels: Record<BusinessTableName, string> = {
  plans: "计划",
  tasks: "任务",
  sessions: "执行记录",
  reviewSchedules: "复盘周期",
  reviewEntries: "复盘条目",
  todos: "待办",
  axisConfigs: "轴配置",
  dailyPlans: "今日计划",
  scheduleEvents: "日程",
  countdowns: "倒计时",
  settings: "设置",
};
const download = (content: string, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const showError = (e: unknown) =>
  toast.error(e instanceof Error ? e.message : "操作失败");
type DeletedRow = {
  id: string;
  deletedAt: number;
  title?: string;
  content?: string;
  name?: string;
  planId?: string;
  parentId?: string;
  scheduleId?: string;
};

async function restore(table: BusinessTableName, row: DeletedRow) {
  await db.transaction("rw", BUSINESS_TABLES, async () => {
    const restoreOne = async (name: BusinessTableName, id: string) => {
      await db.table(name).update(id, { deletedAt: 0, updatedAt: Date.now() });
    };
    if (table === "tasks") {
      if (row.planId) await restoreOne("plans", row.planId);
      let parent = row.parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const p = await db.tasks.get(parent);
        await restoreOne("tasks", parent);
        parent = p?.parentId;
      }
    }
    if (table === "reviewEntries" && row.scheduleId)
      await restoreOne("reviewSchedules", row.scheduleId);
    await restoreOne(table, row.id);
    if (table === "plans")
      await db.tasks
        .filter((t) => t.planId === row.id && t.deletedAt === row.deletedAt)
        .modify({ deletedAt: 0, updatedAt: Date.now() });
    if (table === "tasks") {
      const queue = [row.id],
        restored = new Set<string>();
      while (queue.length) {
        const parentId = queue.shift()!;
        if (restored.has(parentId)) continue;
        restored.add(parentId);
        const children = await db.tasks
          .where("parentId")
          .equals(parentId)
          .filter((t) => t.deletedAt === row.deletedAt)
          .toArray();
        for (const child of children) {
          await restoreOne("tasks", child.id);
          queue.push(child.id);
        }
      }
    }
  });
  toast.success("已恢复记录");
}

export function DataManagement() {
  const file = useRef<HTMLInputElement>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [preview, setPreview] = useState<{
    bundle: ExportBundle;
    duplicates: number;
  }>();
  const [policy, setPolicy] = useState<"skip" | "replace">("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trash = useLiveQuery(async () => {
    const groups = await Promise.all(
      BUSINESS_TABLES.map(async (table) => ({
        table,
        rows: ((await db.table(table).toArray()) as DeletedRow[]).filter(
          (r) => r.deletedAt > 0,
        ),
      })),
    );
    return groups.filter((g) => g.rows.length);
  }, []);
  const backups = useLiveQuery(
    () => db.snapshots.orderBy("createdAt").reverse().limit(5).toArray(),
    [],
  );
  const total = trash?.reduce((n, g) => n + g.rows.length, 0) ?? 0;
  const exportAll = async () => {
    const bundle = await buildExportBundle(db, "blog-cadence-1", Date.now());
    download(
      JSON.stringify(bundle, null, 2),
      `cadence-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
    );
    toast.success("已导出全部数据");
  };
  const selectFile = async (selected: File | undefined) => {
    if (!selected) return;
    setError("");
    setPreview(undefined);
    try {
      if (selected.size > 20 * 1024 * 1024)
        throw new Error("备份文件超过 20 MB，请分批整理后重试");
      const bundle = ExportBundleSchema.parse(
        JSON.parse(await selected.text()),
      );
      if (bundle.schemaVersion > 1)
        throw new Error("备份版本较新，当前版本无法导入");
      let duplicates = 0;
      for (const table of BUSINESS_TABLES) {
        const keys = new Set(
          await db.table(table).toCollection().primaryKeys(),
        );
        duplicates += (
          bundle.data[table] as unknown as Record<string, unknown>[]
        ).filter((r) => keys.has(String(r.id ?? r.key))).length;
      }
      setPolicy("skip");
      setPreview({ bundle, duplicates });
    } catch (e) {
      setError(e instanceof Error ? e.message : "备份文件不合法");
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const confirmImport = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await importBundle(db, preview.bundle, policy);
      if (!result.ok)
        throw new Error(
          result.issues?.[0]?.message ??
            "导入未完成，请检查重复日程、活动计时器与记录引用。原数据已保留。",
        );
      toast.success(
        `已导入 ${Object.values(result.stats).reduce((a, b) => a + b, 0)} 条记录，导入前副本已保留`,
      );
      setPreview(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };
  const csv = async (table: "sessions" | "reviewEntries") => {
    const rows = (await db.table(table).toArray()) as Record<string, unknown>[];
    const columns =
      table === "sessions"
        ? ["id", "startedAt", "endedAt", "pausedMs", "planId", "taskId", "note"]
        : [
            "id",
            "scheduleId",
            "dateKey",
            "slotStart",
            "content",
            "mood",
            "tags",
          ];
    const quote = (v: unknown) => {
      let s = Array.isArray(v) ? v.join(" / ") : String(v ?? "");
      if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    download(
      "\uFEFF" +
        [
          columns.map(quote).join(","),
          ...rows.map((r) => columns.map((c) => quote(r[c])).join(",")),
        ].join("\r\n"),
      `cadence-${table}.csv`,
      "text/csv;charset=utf-8",
    );
  };
  return (
    <Card>
      <CardHeader
        title="数据管理"
        hint="本机副本支持离线操作；连接同步后可在设备之间合并。定期导出备份以保留独立副本。"
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <Button size="sm" onClick={() => void exportAll().catch(showError)}>
          导出 JSON 备份
        </Button>
        <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>
          导入备份
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void csv("sessions").catch(showError)}
        >
          执行记录 CSV
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void csv("reviewEntries").catch(showError)}
        >
          复盘 CSV
        </Button>
        <input
          type="file"
          ref={file}
          className="hidden"
          accept=".json,application/json"
          aria-label="选择备份"
          onChange={(e) => void selectFile(e.target.files?.[0])}
        />
      </div>
      {preview && (
        <section className="mt-4 rounded-md border border-border p-4">
          <h4 className="font-medium">导入预览</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            共{" "}
            {Object.values(preview.bundle.data).reduce(
              (n, rows) => n + rows.length,
              0,
            )}{" "}
            条，{preview.duplicates}{" "}
            条与本机记录编号相同。导入前会自动保留一份本机快照。
          </p>
          <div className="my-3 flex flex-wrap gap-3 text-sm">
            {BUSINESS_TABLES.map((t) => (
              <span key={t}>
                {labels[t]} {preview.bundle.data[t].length}
              </span>
            ))}
          </div>
          <label className="block text-sm">
            重复记录处理{" "}
            <select
              className="ml-2 rounded-md border border-border bg-background p-2"
              value={policy}
              onChange={(e) => setPolicy(e.target.value as "skip" | "replace")}
            >
              <option value="skip">保留本机版本，跳过重复记录</option>
              <option value="replace">使用备份版本覆盖重复记录</option>
            </select>
          </label>
          <div className="mt-4 flex gap-3">
            <Button
              size="sm"
              loading={busy}
              onClick={() => void confirmImport()}
            >
              确认导入
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              取消
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {!!backups?.length && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer">导入前的历史副本</summary>
          <ul className="mt-3 space-y-2">
            {backups.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3"
              >
                <span>{new Date(b.createdAt).toLocaleString("zh-CN")}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    download(
                      b.payload,
                      `cadence-snapshot-${b.createdAt}.json`,
                      "application/json",
                    )
                  }
                >
                  下载副本
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <section className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <h4>回收站 · {total} 条</h4>
          {total > 0 && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmEmpty(true)}
            >
              清空回收站
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          删除的记录保留 30 天；恢复任务时一并恢复必要的父任务与计划。
        </p>
        {trash?.map((g) => (
          <details key={g.table} className="mt-3 text-sm">
            <summary className="cursor-pointer">
              {labels[g.table]} · {g.rows.length}
            </summary>
            <ul className="mt-2 space-y-2">
              {g.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2"
                >
                  <span className="min-w-0 truncate">
                    {r.title ?? r.name ?? r.content ?? "未命名记录"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void restore(g.table, r).catch(showError)}
                  >
                    恢复
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title="清空回收站？"
        description={`将永久删除 ${total} 条记录。请先导出备份。`}
        confirmLabel="彻底删除"
        danger
        onConfirm={() => {
          setConfirmEmpty(false);
          void emptyTrash(db)
            .then((n) => toast.success(`已删除 ${n} 条记录`))
            .catch(showError);
        }}
      />
    </Card>
  );
}
