/**
 * XY 待办看板（M4 核心）
 * ---------------------------------------------------------------------------
 * 这页是动画/拖拽基建的"最终受益者"：
 *   DraggableSurface 保证拖动全程零渲染、松手才提交；
 *   resolveZone 派生分区，改配置不用迁移数据；
 *   StickyNote 给每张便签手工感与确定性倾斜。
 *
 * 坐标系约定（全站统一）：
 *   业务坐标 y 轴向上为正（"重要性越高越靠上"），取值 0–100；
 *   屏幕坐标 y 向下为正 —— 渲染时 top = 100 - y。
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useRef, useState, type MouseEvent } from "react";

import { resolveZones, type AxisConfig } from "@/cadence/entities/axis";
import type { Todo, TodoCoordinate } from "@/cadence/entities/todo";
import { db } from "@/cadence/data/db/database";
import {
  DraggableSurface,
  PresenceDialog,
  StickyNote,
  toNormalizedPoint,
} from "@/cadence/shared/motion";
import { toast } from "@/cadence/shared/store/toast-store";
import { Button } from "@/cadence/shared/ui/Button";
import { softPigment } from "@/cadence/shared/config/pigment";
import { PageHeader } from "@/cadence/shared/ui/PageHeader";
import { pigmentClasses } from "@/cadence/shared/ui/pigment-classes";
import { SegmentedControl } from "@/cadence/shared/ui/SegmentedControl";
import { TextField } from "@/cadence/shared/ui/TextField";
import {
  createTodo,
  createTodoDeps,
  deleteTodo,
  moveTodo,
  setTodoStatus,
  updateTodoDetails,
  type TodoDeps,
} from "@/cadence/features/todos";

const BOARD_HEIGHT = 560;

type ViewMode = "board" | "list";

export function TodosPage() {
  const deps: TodoDeps = useMemo(() => createTodoDeps(db), []);
  const boardRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<ViewMode>("board");
  const [selectedAxis, setSelectedAxis] = useState("");
  /** 待创建的坐标（点击空白处记录；确认后落库） */
  const [pendingPoint, setPendingPoint] = useState<TodoCoordinate | undefined>(
    undefined,
  );
  const [draftTitle, setDraftTitle] = useState("");
  /** 右键菜单：todo=便签上（编辑备注/修改/删除），undefined=空白处（新建） */
  const [menu, setMenu] = useState<
    { x: number; y: number; todo: Todo | undefined } | undefined
  >(undefined);
  /** 编辑备注对话框 */
  const [noteTarget, setNoteTarget] = useState<Todo | undefined>(undefined);
  const [noteDraft, setNoteDraft] = useState("");
  /** 修改（重命名）对话框 */
  const [renameTarget, setRenameTarget] = useState<Todo | undefined>(undefined);
  const [renameDraft, setRenameDraft] = useState("");

  const axes = useLiveQuery(() => db.axisConfigs.toArray(), []);
  const axis: AxisConfig | undefined =
    axes?.find((item) => item.id === selectedAxis) ??
    axes?.find((item) => item.isDefault) ??
    axes?.[0];
  // useLiveQuery 首帧返回 undefined；用 useMemo 托底，避免空数组每次渲染都是新引用
  const liveTodos = useLiveQuery(() => deps.todos.list(), [deps]);
  const todos = useMemo(
    () => (liveTodos ?? []).filter((todo) => todo.axisConfigId === axis?.id),
    [liveTodos, axis?.id],
  );

  // 批量派生分区：regions 只排序一次（200 条待办逐条 resolveZone 会各排序一次）
  const zoneIds = useMemo(
    () =>
      axis === undefined
        ? []
        : resolveZones(
            axis,
            todos.map((todo) => todo.coordinate),
          ),
    [axis, todos],
  );

  const commitMove = (todo: Todo, point: TodoCoordinate) => {
    void moveTodo(deps, todo, point, Date.now());
  };

  const toggleDone = (todo: Todo) => {
    void setTodoStatus(
      deps,
      todo,
      todo.status === "done" ? "open" : "done",
      Date.now(),
    );
  };

  const remove = (todo: Todo) => {
    void deleteTodo(deps, todo.id, Date.now()).then(() =>
      toast.undoable(`已删除「${todo.title}」`, () =>
        toast.info("可在回收站中恢复"),
      ),
    );
  };

  /** 点击空白处：把点击位置换算成业务坐标，记下来等用户填标题 */
  const onBoardClick = (event: MouseEvent<HTMLDivElement>) => {
    const container = boardRef.current;
    if (container === null) return;
    const point = toNormalizedPoint(
      { clientX: event.clientX, clientY: event.clientY },
      container.getBoundingClientRect(),
    );
    setPendingPoint(point);
  };

  /** 右键看板：覆盖浏览器默认菜单。便签上 → 编辑/修改/删除；空白处 → 新建 */
  const onBoardContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const noteEl = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-todo-id]",
    );
    const id = noteEl?.dataset.todoId;
    const todo =
      id === undefined ? undefined : todos.find((item) => item.id === id);
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 170),
      todo,
    });
  };

  /** 右键"新建"：以菜单弹出的位置为落点（与左键点击空白同一条换算链） */
  const createAtMenu = () => {
    const container = boardRef.current;
    if (container === null || menu === undefined) return;
    setPendingPoint(
      toNormalizedPoint(
        { clientX: menu.x, clientY: menu.y },
        container.getBoundingClientRect(),
      ),
    );
    setMenu(undefined);
  };

  const saveNote = () => {
    if (noteTarget === undefined) return;
    // 空串 = 清除备注（usecase 归一化），与"编辑备注"语义闭环
    void updateTodoDetails(deps, noteTarget, { note: noteDraft }, Date.now());
    setNoteTarget(undefined);
    setNoteDraft("");
  };

  const saveRename = () => {
    if (renameTarget === undefined || renameDraft.trim().length === 0) return;
    void updateTodoDetails(
      deps,
      renameTarget,
      { title: renameDraft },
      Date.now(),
    );
    setRenameTarget(undefined);
  };

  const confirmCreate = () => {
    const title = draftTitle.trim();
    if (title.length === 0 || pendingPoint === undefined) return;
    // 乐观关闭：创建浮层是"输入完成"的信号，不该等数据库往返。
    // 写入失败由响应式查询兜底 —— 便签不会出现，用户重试即可
    setPendingPoint(undefined);
    setDraftTitle("");
    void createTodo(
      deps,
      { title, coordinate: pendingPoint, axisConfigId: axis?.id },
      Date.now(),
    ).catch((e) => toast.error(e.message));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Todos"
        title="待办"
        rule="ripple"
        description="XY 双轴分类：横轴紧急、纵轴重要。拖到哪就算哪，分区归属由坐标实时派生。"
        action={
          <SegmentedControl
            value={mode}
            onChange={(value) => setMode(value as ViewMode)}
            options={[
              { value: "board", label: "看板" },
              { value: "list", label: "列表" },
            ]}
            label="视图切换"
          />
        }
      />

      <label className="flex flex-wrap items-center gap-3 text-sm">
        坐标配置
        <select
          className="rounded-md border border-border bg-background px-3 py-2"
          value={axis?.id ?? ""}
          onChange={(e) => setSelectedAxis(e.target.value)}
        >
          {axes?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">
          横轴：{axis?.axisXLabel} · 纵轴：{axis?.axisYLabel}
        </span>
      </label>
      {mode === "board" ? (
        <div
          ref={boardRef}
          onClick={onBoardClick}
          onContextMenu={onBoardContextMenu}
          className="relative overflow-hidden rounded-[var(--radius-hand-md)] shadow-[inset_0_0_0_1.5px_var(--color-paper-line)]"
          style={{ height: BOARD_HEIGHT }}
          data-testid="todo-board"
        >
          {/* 象限底：同一颜料系的四档明度（不用四个色相，避免花） */}
          {(axis?.regions ?? []).map((region) => (
            <div
              key={region.id}
              aria-hidden="true"
              className="pointer-events-none absolute border border-border"
              style={{
                left: `${region.x0}%`,
                bottom: `${region.y0}%`,
                width: `${region.x1 - region.x0}%`,
                height: `${region.y1 - region.y0}%`,
                backgroundColor: softPigment[region.color],
              }}
            />
          ))}

          {/* 象限标签（来自分区配置，随配置变化） */}
          {(axis?.regions ?? []).map((region) => {
            const tone = pigmentClasses(region.color);
            return (
              <span
                key={region.id}
                className={[
                  "text-ink-3 absolute z-[3] text-[11px] tracking-[0.2em]",
                ].join(" ")}
                style={{
                  left: `calc(${region.x0}% + 8px)`,
                  top: `calc(${100 - region.y1}% + 8px)`,
                }}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                    tone.dot,
                  ].join(" ")}
                />
                {region.label}
              </span>
            );
          })}

          {todos.map((todo) => (
            <div
              key={todo.id}
              data-todo-id={todo.id}
              className="absolute z-10"
              style={{
                left: `${todo.coordinate.x}%`,
                top: `${100 - todo.coordinate.y}%`,
                transform: "translate(-50%, -50%)",
              }}
              // 便签自身的 click 语义是"勾选完成"，不能冒泡到看板
              // （否则会同时触发"点击空白处 → 就地创建"浮层）
              onClick={(event) => event.stopPropagation()}
            >
              <DraggableSurface
                id={todo.id}
                value={todo.coordinate}
                containerRef={boardRef}
                onCommit={(point) => commitMove(todo, point)}
                maxTilt={1}
                onClick={() => toggleDone(todo)}
                className="w-[110px]"
              >
                <StickyNote
                  id={todo.id}
                  size="compact"
                  tone="paper"
                  maxTilt={1}
                  className="w-full text-center"
                >
                  <span
                    className={
                      todo.status === "done" ? "text-ink-4 line-through" : ""
                    }
                  >
                    {todo.title}
                  </span>
                  {todo.note !== undefined ? (
                    <span
                      className="text-ink-4 mt-1 block truncate text-[10px]"
                      title={todo.note}
                    >
                      ✎ {todo.note}
                    </span>
                  ) : null}
                </StickyNote>
              </DraggableSurface>
            </div>
          ))}

          {todos.length === 0 ? (
            <p className="text-ink-4 pointer-events-none absolute inset-0 z-[3] grid place-items-center text-[12.5px]">
              点击任意空白处，就地记一条待办
            </p>
          ) : null}
        </div>
      ) : (
        <TodoListView
          todos={todos}
          axis={axis}
          zoneIds={zoneIds}
          onToggle={toggleDone}
          onDelete={remove}
        />
      )}

      {/* 所有待办弹窗复用 Radix 的焦点陷阱、Esc 与焦点归还。 */}
      <PresenceDialog
        open={pendingPoint !== undefined}
        onOpenChange={(open) => { if (!open) setPendingPoint(undefined); }}
        title="在这里记一条"
        footer={<><Button variant="ghost" size="sm" onClick={() => setPendingPoint(undefined)}>取消</Button><Button size="sm" onClick={confirmCreate}>记下</Button></>}
      >
        <TextField
          label="待办内容"
          value={draftTitle}
          placeholder="一句话说清要做什么"
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); confirmCreate(); }
          }}
        />
      </PresenceDialog>

      {/* 右键菜单：覆盖浏览器默认菜单（容器 preventDefault）。
          便签上 → 编辑备注 / 修改 / 删除；空白处 → 在此新建。
          透明遮罩负责"点别处收起"，菜单本体浮在它上面。 */}
      {menu !== undefined ? (
        <>
          <div
            className="fixed inset-0 z-[var(--z-modal)]"
            onClick={() => setMenu(undefined)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(undefined);
            }}
          />
          <div
            role="menu"
            data-m3-role="menu"
            aria-label="待办操作"
            className="surface-card fixed z-[calc(var(--z-modal)+1)] min-w-[150px] py-1.5 shadow-[0_6px_18px_-8px_var(--paper-shadow-strong)]"
            style={{
              left: menu.x,
              top: menu.y,
              borderRadius: "var(--radius-hand-sm)",
            }}
          >
            {menu.todo !== undefined ? (
              <>
                <MenuItem
                  label={
                    menu.todo.note !== undefined ? "编辑备注 ●" : "编辑备注"
                  }
                  onClick={() => {
                    setNoteTarget(menu.todo);
                    setNoteDraft(menu.todo?.note ?? "");
                    setMenu(undefined);
                  }}
                />
                <MenuItem
                  label="修改"
                  onClick={() => {
                    if (menu.todo === undefined) return;
                    setRenameTarget(menu.todo);
                    setRenameDraft(menu.todo.title);
                    setMenu(undefined);
                  }}
                />
                <MenuItem
                  label="删除"
                  danger
                  onClick={() => {
                    if (menu.todo === undefined) return;
                    remove(menu.todo);
                    setMenu(undefined);
                  }}
                />
              </>
            ) : (
              <MenuItem label="在此新建待办" onClick={createAtMenu} />
            )}
          </div>
        </>
      ) : null}

      {/* 编辑备注（多行；空保存 = 清除） */}
      <PresenceDialog
        open={noteTarget !== undefined}
        onOpenChange={(open) => { if (!open) setNoteTarget(undefined); }}
        title={`备注 · ${noteTarget?.title ?? ''}`}
        footer={<><Button variant="ghost" size="sm" onClick={() => setNoteTarget(undefined)}>取消</Button><Button size="sm" onClick={saveNote}>保存</Button></>}
      >
        <TextField
          label="备注"
          multiline
          rows={4}
          value={noteDraft}
          placeholder="补充标题装不下的信息；留空保存即清除"
          onChange={(event) => setNoteDraft(event.target.value)}
        />
      </PresenceDialog>

      {/* 修改（重命名） */}
      <PresenceDialog
        open={renameTarget !== undefined}
        onOpenChange={(open) => { if (!open) setRenameTarget(undefined); }}
        title="修改待办"
        footer={<><Button variant="ghost" size="sm" onClick={() => setRenameTarget(undefined)}>取消</Button><Button size="sm" onClick={saveRename}>保存</Button></>}
      >
        <TextField
          label="标题"
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); saveRename(); }
          }}
        />
      </PresenceDialog>
    </div>
  );
}

/** 右键菜单项（统一形态，颜色语义：危险项用黏土色） */
function MenuItem({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-m3-role="menu-item"
      data-m3-variant={danger ? "danger" : undefined}
      onClick={onClick}
      className={[
        "craft-transition-fast block w-full px-4 py-2 text-left text-[12.5px]",
        danger
          ? "text-clay-deep hover:bg-clay-soft"
          : "text-ink-1 hover:bg-paper-2",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/** 列表视图：分区标签 + 勾选 + 删除（分区 id 由看板批量派生，避免逐条重算） */
function TodoListView({
  todos,
  axis,
  zoneIds,
  onToggle,
  onDelete,
}: {
  todos: readonly Todo[];
  axis: AxisConfig | undefined;
  /** 与 todos 等长对齐的分区 id */
  zoneIds: readonly string[];
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}) {
  if (axis === undefined) return null;

  return (
    <div className="space-y-2">
      {todos.map((todo, index) => {
        const region = axis.regions.find((item) => item.id === zoneIds[index]);
        const tone = pigmentClasses(region?.color ?? "todo");

        return (
          <div
            key={todo.id}
            className="surface-card flex items-center gap-3 px-4 py-3"
          >
            <input
              type="checkbox"
              aria-label={`完成 ${todo.title}`}
              checked={todo.status === "done"}
              onChange={() => onToggle(todo)}
              className="accent-[var(--color-amber-base)] h-4 w-4"
            />
            <span
              className={[
                "flex-1 text-[13.5px]",
                todo.status === "done"
                  ? "text-ink-4 line-through"
                  : "text-ink-1",
              ].join(" ")}
            >
              {todo.title}
              {todo.note !== undefined ? (
                <span
                  className="text-ink-3 mt-0.5 block truncate text-[11.5px]"
                  title={todo.note}
                >
                  ✎ {todo.note}
                </span>
              ) : null}
            </span>
            {region ? (
              <span
                className={[
                  "numeric rounded-[var(--radius-hand-sm)] px-2.5 py-1 text-[11.5px]",
                  tone.softBg,
                  tone.text,
                ].join(" ")}
              >
                {region.label}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onDelete(todo)}
              aria-label={`删除 ${todo.title}`}
              className="text-ink-4 hover:text-clay-deep craft-transition-fast rounded-full px-2 py-1 text-[11.5px]"
            >
              删除
            </button>
          </div>
        );
      })}
      {todos.length === 0 ? (
        <p className="text-ink-4 py-8 text-center text-[12.5px]">
          还没有待办。切到看板，点空白处就地记一条。
        </p>
      ) : null}
    </div>
  );
}
