import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/cadence/data/db/database";
import {
  createReviewDeps,
  createSchedule,
  updateScheduleDetails,
} from "@/cadence/features/review/usecases";
import type { ReviewSchedule } from "@/cadence/entities/review";
import {
  isValidRegion,
  defaultAxisConfig,
  type AxisConfig,
} from "@/cadence/entities/axis";
import { newEntityId } from "@/cadence/shared/model/entity";
import { PIGMENT_KEYS } from "@/cadence/shared/config/pigment";
import { PayloadSchemas } from "@/cadence/data/db/validation";
import { useAppearanceStore } from "@/cadence/shared/store/appearance-store";
import { useAssistantStore } from "@/cadence/shared/store/assistant-store";
import { toast } from "@/cadence/shared/store/toast-store";
import { Card, CardHeader } from "@/cadence/shared/ui/Card";
import { Button } from "@/cadence/shared/ui/Button";
import { TextField } from "@/cadence/shared/ui/TextField";
import { Checkbox } from "@/cadence/shared/ui/Checkbox";
import { SegmentedControl } from "@/cadence/shared/ui/SegmentedControl";
import {
  MOTION_OPTIONS,
  type MotionStrength,
} from "@/cadence/shared/config/appearance";
import { SyncPanel } from "@/cadence/sync/SyncPanel";
import { CAPABILITY_SUMMARY } from "@/cadence/widgets/assistant";
import { DataManagement } from "./ui/DataManagement";

export function SettingsPage() {
  const motion = useAppearanceStore((s) => s.motion);
  const setMotion = useAppearanceStore((s) => s.setMotion);
  const enabled = useAssistantStore((s) => s.llmEnabled);
  const configure = useAssistantStore((s) => s.setConfig);
  return (
    <div className="space-y-6 pt-6">
      <h2 className="text-2xl">设置</h2>
      <Card>
        <CardHeader
          title="外观"
          hint="颜色、字体与明暗模式跟随博客，可通过顶部主题按钮调整。"
        />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <span className="text-sm">日程动效</span>
          <SegmentedControl<MotionStrength>
            label="动效强度"
            options={MOTION_OPTIONS}
            value={motion}
            onChange={setMotion}
          />
        </div>
      </Card>
      <SyncPanel />
      <ReviewSettings />
      <AxisSettings />
      <DataManagement />
      <Card>
        <CardHeader
          title="日程助手"
          hint="右下角助手可用一句话管理日程，删除操作需再次确认。"
        />
        <div className="mt-4">
          <Checkbox
            checked={enabled}
            onChange={(checked) => configure({ llmEnabled: checked })}
            label="启用智能理解"
          >
            <span className="text-sm">启用智能理解</span>
          </Checkbox>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          基础指令在本机解析。启用后，较复杂的语句使用博客后台配置的 AI
          服务；操作参数仍需校验。
        </p>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer">查看支持的操作</summary>
          <ul className="mt-3 space-y-2 text-muted-foreground">
            {CAPABILITY_SUMMARY.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </Card>
    </div>
  );
}

function ReviewSettings() {
  const schedules = useLiveQuery(
    () => db.reviewSchedules.filter((s) => !s.deletedAt).toArray(),
    [],
  );
  const [editing, setEditing] = useState<ReviewSchedule>();
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState("2");
  const [anchor, setAnchor] = useState("08:00");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const [h, m] = anchor.split(":").map(Number);
      const draft = {
        title: title.trim(),
        intervalHours: Number(hours),
        anchorOffsetMs: ((h ?? 0) * 60 + (m ?? 0)) * 60000,
        prompt,
      };
      if (!Number.isFinite(draft.anchorOffsetMs))
        throw new Error("请输入有效的锚点时间");
      const deps = createReviewDeps(db);
      if (editing)
        await updateScheduleDetails(deps, editing, draft, Date.now());
      else await createSchedule(deps, draft, Date.now());
      setEditing(undefined);
      setTitle("");
      setPrompt("");
      toast.success("复盘周期已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="复盘周期"
        hint="按间隔与当天锚点生成复盘格子；修改周期会保留原有复盘记录。"
      />
      <div className="mt-4 space-y-3">
        {schedules?.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
          >
            <span className="flex-1 text-sm">
              {s.title} · 每 {s.intervalHours} 小时 ·{" "}
              {String(Math.floor(s.anchorOffsetMs / 3600000)).padStart(2, "0")}:
              {String(Math.floor(s.anchorOffsetMs / 60000) % 60).padStart(
                2,
                "0",
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(s);
                setTitle(s.title);
                setHours(String(s.intervalHours));
                setAnchor(
                  `${String(Math.floor(s.anchorOffsetMs / 3600000)).padStart(2, "0")}:${String(Math.floor(s.anchorOffsetMs / 60000) % 60).padStart(2, "0")}`,
                );
                setPrompt(s.prompt ?? "");
              }}
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void db.reviewSchedules
                  .update(s.id, { enabled: !s.enabled, updatedAt: Date.now() })
                  .catch(() => toast.error("保存失败"))
              }
            >
              {s.enabled ? "停用" : "启用"}
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <TextField
          label="周期名称"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label="间隔（小时，最少 0.25）"
          type="number"
          min="0.25"
          step="0.25"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <TextField
          label="锚点时间"
          type="time"
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
        />
      </div>
      <div className="mt-4">
        <TextField
          label="复盘提示（可选）"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        每天约 {Number(hours) > 0 ? Math.ceil(24 / Number(hours)) : "—"}{" "}
        个格子。修改后的格子可能与历史记录的时段不同，请先导出备份。
      </p>
      <div className="mt-4 flex gap-3">
        <Button size="sm" loading={busy} onClick={() => void save()}>
          {editing ? "保存修改" : "添加周期"}
        </Button>
        {editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(undefined);
              setTitle("");
            }}
          >
            取消编辑
          </Button>
        )}
      </div>
    </Card>
  );
}

function AxisSettings() {
  const axes = useLiveQuery(() => db.axisConfigs.toArray(), []);
  const [selected, setSelected] = useState("");
  const axis =
    axes?.find((a) => a.id === selected) ??
    axes?.find((a) => a.isDefault) ??
    axes?.[0];
  return (
    <Card>
      <CardHeader
        title="待办坐标与分区"
        hint="分区由坐标决定；修改标签与边界不会移动已有待办。"
      />
      <div className="mt-4 flex flex-wrap gap-3">
        {axes?.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant="ghost"
            onClick={() => setSelected(a.id)}
          >
            {a.name}
            {a.isDefault ? " · 默认" : ""}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const now = Date.now();
            const a = {
              ...defaultAxisConfig(now),
              id: newEntityId("axis", now),
              name: "新坐标配置",
              isDefault: false,
            };
            void db.axisConfigs
              .put(a)
              .then(() => setSelected(a.id))
              .catch(() => toast.error("新建失败"));
          }}
        >
          新建配置
        </Button>
      </div>
      {axis && <AxisEditor key={`${axis.id}:${axis.updatedAt}`} axis={axis} />}
    </Card>
  );
}

function AxisEditor({ axis }: { axis: AxisConfig }) {
  const [draft, setDraft] = useState<AxisConfig>(() => structuredClone(axis));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changeRegion = (
    id: string,
    patch: Partial<AxisConfig["regions"][number]>,
  ) =>
    setDraft((d) => ({
      ...d,
      regions: d.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  const preset = (size: 2 | 3) => {
    const regions: AxisConfig["regions"] = [];
    for (let y = size - 1; y >= 0; y--)
      for (let x = 0; x < size; x++) {
        const index = regions.length;
        regions.push({
          id: `zone-${axis.id}-${size}-${index}`,
          label: `分区 ${index + 1}`,
          color: PIGMENT_KEYS[index % PIGMENT_KEYS.length] ?? "todo",
          x0: (x * 100) / size,
          x1: ((x + 1) * 100) / size,
          y0: (y * 100) / size,
          y1: ((y + 1) * 100) / size,
          order: index,
        });
      }
    setDraft((d) => ({ ...d, regions, fallbackZoneId: regions.at(-1)!.id }));
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const parsed = PayloadSchemas.axisConfigs.parse({
        ...draft,
        updatedAt: Date.now(),
      });
      if (
        !parsed.regions.length ||
        parsed.regions.some((r) => !isValidRegion(r)) ||
        !parsed.regions.some((r) => r.id === parsed.fallbackZoneId) ||
        new Set(parsed.regions.map((r) => r.id)).size !== parsed.regions.length
      )
        throw new Error("分区边界、编号或默认分区不合法");
      await db.transaction("rw", db.axisConfigs, async () => {
        if (parsed.isDefault)
          await db.axisConfigs
            .toCollection()
            .modify({ isDefault: false, updatedAt: Date.now() });
        await db.axisConfigs.put(parsed);
      });
      toast.success("坐标配置已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="配置名称"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <TextField
          label="横轴名称"
          value={draft.axisXLabel}
          onChange={(e) =>
            setDraft((d) => ({ ...d, axisXLabel: e.target.value }))
          }
        />
        <TextField
          label="纵轴名称"
          value={draft.axisYLabel}
          onChange={(e) =>
            setDraft((d) => ({ ...d, axisYLabel: e.target.value }))
          }
        />
      </div>
      <Checkbox
        checked={draft.isDefault}
        onChange={(checked) => setDraft((d) => ({ ...d, isDefault: checked }))}
        label="设为默认坐标配置"
      >
        <span className="text-sm">新待办默认使用此配置</span>
      </Checkbox>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => preset(2)}>
          使用 2×2 分区
        </Button>
        <Button size="sm" variant="ghost" onClick={() => preset(3)}>
          使用 3×3 分区
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              regions: [
                ...d.regions,
                {
                  id: newEntityId("zone", Date.now()),
                  label: "新分区",
                  color: "todo",
                  x0: 0,
                  y0: 0,
                  x1: 100,
                  y1: 100,
                  order: d.regions.length,
                },
              ],
            }))
          }
        >
          添加自定义分区
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        坐标范围
        0–100；横、纵轴起点均应小于终点。重叠区域优先匹配排在前面的分区。
      </p>
      {draft.regions.map((r, index) => (
        <div key={r.id} className="rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={`分区 ${index + 1} 名称`}
              value={r.label}
              onChange={(e) => changeRegion(r.id, { label: e.target.value })}
            />
            <label className="text-xs">
              颜色
              <select
                className="mt-2 block w-full rounded-md border border-border bg-background p-2 text-sm"
                value={r.color}
                onChange={(e) =>
                  changeRegion(r.id, {
                    color: e.target.value as typeof r.color,
                  })
                }
              >
                {PIGMENT_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {
                      {
                        plan: "计划",
                        session: "执行",
                        done: "完成",
                        todo: "待办",
                        review: "复盘",
                        archive: "归档",
                      }[c]
                    }
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["x0", "x1", "y0", "y1"] as const).map((field, i) => (
              <TextField
                key={field}
                label={
                  ["横轴起点", "横轴终点", "纵轴起点", "纵轴终点"][i] ?? field
                }
                type="number"
                min="0"
                max="100"
                step="any"
                value={r[field]}
                onChange={(e) =>
                  changeRegion(r.id, { [field]: Number(e.target.value) })
                }
              />
            ))}
          </div>
          <div className="mt-3 flex gap-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={index === 0}
              onClick={() =>
                setDraft((d) => {
                  const list = [...d.regions];
                  [list[index - 1], list[index]] = [
                    list[index]!,
                    list[index - 1]!,
                  ];
                  return {
                    ...d,
                    regions: list.map((item, order) => ({ ...item, order })),
                  };
                })
              }
            >
              上移
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={draft.regions.length <= 1}
              onClick={() =>
                setDraft((d) => {
                  const regions = d.regions.filter((item) => item.id !== r.id);
                  return {
                    ...d,
                    regions,
                    fallbackZoneId:
                      d.fallbackZoneId === r.id
                        ? regions[0]!.id
                        : d.fallbackZoneId,
                  };
                })
              }
            >
              移除分区
            </Button>
          </div>
        </div>
      ))}
      <label className="block text-xs">
        未命中区域时归入
        <select
          className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
          value={draft.fallbackZoneId}
          onChange={(e) =>
            setDraft((d) => ({ ...d, fallbackZoneId: e.target.value }))
          }
        >
          {draft.regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" loading={busy} onClick={() => void save()}>
        保存坐标与分区
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
