import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "@tanstack/react-router";
import {
  enableSync,
  disableSync,
  conflicts,
  resolveConflict,
  restoreConflictVersion,
  startSyncWatching,
  syncPreview,
  synchronize,
  useSyncStatus,
  type ConflictCopy,
} from "./client";
import type { EntityPayload } from "./protocol";
import { Button } from "@/cadence/shared/ui/Button";
import { Card } from "@/cadence/shared/ui/Card";
import { ConfirmDialog } from "@/cadence/shared/ui/ConfirmDialog";

const fieldLabels: Record<string, string> = {
  title: "标题",
  name: "名称",
  description: "说明",
  note: "备注",
  content: "内容",
  status: "状态",
  tags: "标签",
  startDate: "开始日期",
  endDate: "结束日期",
  dateKey: "日期",
  startMin: "开始分钟",
  endMin: "结束分钟",
  startedAt: "开始时间",
  endedAt: "结束时间",
  pausedAt: "暂停时间",
  pausedMs: "累计暂停（毫秒）",
  deletedAt: "删除时间",
  updatedAt: "修改时间",
  targetAt: "目标时间",
  slotStart: "复盘起点",
  mood: "心情",
  intervalHours: "周期（小时）",
  anchorOffsetMs: "当天锚点（毫秒）",
  enabled: "启用",
  prompt: "复盘提示",
  items: "今日计划项",
  coordinate: "坐标",
  axisXLabel: "横轴名称",
  axisYLabel: "纵轴名称",
  regions: "分区",
};
const statuses: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  archived: "已归档",
  todo: "待处理",
  doing: "进行中",
  done: "已完成",
  open: "待处理",
  blocked: "受阻",
};
const formatValue = (key: string, value: unknown): string => {
  if ((key === "startMin" || key === "endMin") && typeof value === "number")
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  if (key === "anchorOffsetMs" && typeof value === "number")
    return `${String(Math.floor(value / 3600000)).padStart(2, "0")}:${String(Math.floor(value / 60000) % 60).padStart(2, "0")}`;
  if (key === "tags" && Array.isArray(value)) return value.join("、");
  if (key === "items" && Array.isArray(value))
    return value
      .map(
        (item) =>
          `${item.done ? "☑" : "☐"} ${item.title ?? ""}${item.note ? ` · ${item.note}` : ""}`,
      )
      .join("\n");
  if (key === "regions" && Array.isArray(value))
    return value
      .map((r) => `${r.label}：横轴 ${r.x0}–${r.x1}，纵轴 ${r.y0}–${r.y1}`)
      .join("\n");
  if (key === "coordinate" && value && typeof value === "object") {
    const point = value as { x: number; y: number };
    return `横轴 ${point.x} · 纵轴 ${point.y}`;
  }
  if (key === "status" && typeof value === "string")
    return statuses[value] ?? value;
  if (typeof value === "number" && (key.endsWith("At") || key === "slotStart"))
    return value === 0 ? "未删除" : new Date(value).toLocaleString("zh-CN");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value !== null && typeof value === "object")
    return JSON.stringify(value, null, 2);
  return String(value ?? "");
};
function RecordView({ payload }: { payload: EntityPayload | null }) {
  if (!payload)
    return <p className="text-sm text-muted-foreground">已删除或不存在</p>;
  const fields = Object.entries(payload).filter(
    ([key, value]) => fieldLabels[key] && value !== undefined,
  );
  return (
    <div>
      <dl className="space-y-3">
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">
              {fieldLabels[key]}
            </dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
              {formatValue(key, value)}
            </dd>
          </div>
        ))}
      </dl>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">查看完整记录</summary>
        <pre className="sync-comparison mt-2">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
function Versions({ copy }: { copy: ConflictCopy }) {
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2">
      <div className="rounded-md bg-muted/50 p-3">
        <p className="mb-3 text-sm font-medium">本地版本</p>
        <RecordView payload={copy.local} />
      </div>
      <div className="rounded-md bg-muted/50 p-3">
        <p className="mb-3 text-sm font-medium">远端版本</p>
        <RecordView payload={copy.remote.payload} />
      </div>
    </div>
  );
}
const recordTitle = (copy: ConflictCopy) =>
  String(
    copy.local?.title ??
      copy.local?.name ??
      copy.remote.payload?.title ??
      copy.remote.payload?.name ??
      "同步记录",
  );

export function SyncStatusBar() {
  const status = useSyncStatus();
  const unresolved = useLiveQuery(
    async () => (await conflicts.toArray()).filter((c) => !c.resolved).length,
    [],
  );
  useEffect(() => startSyncWatching(), []);
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-border pb-4 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <span>
        {status.running
          ? "同步中…"
          : !status.enabled
            ? "本地保存 · 尚未连接同步"
            : status.error
              ? "本地已保存 · 同步待重试"
              : status.pending
                ? "本地已保存 · 等待同步"
                : "已同步"}
      </span>
      {!!unresolved && (
        <Link to="/settings" className="text-destructive underline">
          {unresolved} 个冲突待处理
        </Link>
      )}
      {status.enabled && (
        <button
          disabled={status.running}
          onClick={() => void synchronize()}
          className="ml-auto hover:text-foreground disabled:opacity-50"
        >
          立即同步
        </button>
      )}
      {!!status.error && (
        <span role="alert" className="w-full text-destructive">
          {status.error}
        </span>
      )}
    </div>
  );
}

export function SyncPanel() {
  const status = useSyncStatus();
  const allCopies = useLiveQuery(() => conflicts.toArray(), []);
  const copies = allCopies?.filter((c) => !c.resolved);
  const history = allCopies?.filter((c) => c.resolved || c.history?.length);
  const [preview, setPreview] = useState<{ local: number; remote: number }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<{
    copy: ConflictCopy;
    choice: "local" | "remote";
  }>();
  const perform = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h3>设备同步</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        每台设备先保存本地副本。联网后比较共同基线，单侧变化自动同步；双方修改同一条记录时，由你选择保留哪一版。
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {status.enabled ? (
          <Button
            size="sm"
            loading={status.running}
            disabled={busy}
            onClick={() => void synchronize()}
          >
            立即同步
          </Button>
        ) : (
          <Button
            size="sm"
            loading={busy}
            onClick={() =>
              void perform(async () => setPreview(await syncPreview()))
            }
          >
            检查本地与远端
          </Button>
        )}
        {status.enabled && (
          <Button
            size="sm"
            variant="ghost"
            disabled={status.running || busy}
            onClick={() => void perform(disableSync)}
          >
            暂停同步
          </Button>
        )}
        {status.lastSync && (
          <span className="text-xs text-muted-foreground">
            上次同步：{new Date(status.lastSync).toLocaleString("zh-CN")}
          </span>
        )}
      </div>
      {preview && !status.enabled && (
        <div className="mt-4 rounded-md border border-border p-4">
          <p className="text-sm">
            本地 {preview.local} 条 · 远端 {preview.remote}{" "}
            条。首次连接会合并两边数据，同一条记录的不同版本会保留为冲突。
          </p>
          <Button
            size="sm"
            className="mt-3"
            loading={status.running || busy}
            onClick={() => void perform(enableSync)}
          >
            连接并同步
          </Button>
        </div>
      )}
      {(error || status.error) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error || status.error}
        </p>
      )}
      {!!copies?.length && (
        <div className="mt-5 space-y-4">
          <h3>待处理冲突</h3>
          {copies.map((copy) => (
            <section
              key={copy.key}
              className="rounded-md border border-border p-4"
            >
              <h4 className="text-sm font-medium">{recordTitle(copy)}</h4>
              <Versions copy={copy} />
              <div className="mt-3 flex gap-3">
                {(["local", "remote"] as const).map((choice) => (
                  <Button
                    key={choice}
                    size="sm"
                    variant="ghost"
                    disabled={busy || status.running}
                    onClick={() =>
                      void perform(() => resolveConflict(copy, choice))
                    }
                  >
                    采用{choice === "local" ? "本地" : "远端"}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                另一版会留在历史副本中。
              </p>
            </section>
          ))}
        </div>
      )}
      {!!history?.length && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer">
            冲突历史副本 · {history.length} 条
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            恢复旧版会作为一次新的本地编辑参与同步，当前内容也会保留副本。
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(history, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "cadence-conflict-history.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            下载冲突历史
          </Button>
          <div className="mt-3 space-y-4">
            {history.map((copy) => (
              <details
                key={copy.key}
                className="rounded-md border border-border p-4"
              >
                <summary className="cursor-pointer">
                  {recordTitle(copy)} ·{" "}
                  {new Date(copy.detectedAt).toLocaleString("zh-CN")}
                </summary>
                <Versions copy={copy} />
                {copy.resolved && (
                  <div className="mt-3 flex gap-3">
                    {(["local", "remote"] as const).map((choice) => (
                      <Button
                        key={choice}
                        size="sm"
                        variant="ghost"
                        disabled={busy || status.running}
                        onClick={() => setRestoring({ copy, choice })}
                      >
                        恢复原{choice === "local" ? "本地" : "远端"}版
                      </Button>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        </details>
      )}
      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(open) => {
          if (!open) setRestoring(undefined);
        }}
        title="恢复历史版本？"
        description="这条记录的当前本地内容会替换为所选历史版本，并保留当前内容的副本。"
        confirmLabel="恢复此版本"
        onConfirm={() => {
          if (restoring)
            void perform(() =>
              restoreConflictVersion(restoring.copy, restoring.choice),
            );
          setRestoring(undefined);
        }}
      />
    </Card>
  );
}
