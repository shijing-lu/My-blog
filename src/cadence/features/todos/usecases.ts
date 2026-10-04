/**
 * 待办模块用例层
 *
 * 关键约束（01-需求文档 FR-TODO-08/09）：
 *   拖动过程中不写库，松手才提交一次坐标；分区归属由坐标派生，绝不存储。
 *   这两条在 UI 层由 DraggableSurface 保证，这里只负责落库与派生。
 */

import type { Todo, TodoCoordinate, TodoStatus } from "@/cadence/entities/todo";
import { clampCoordinate } from "@/cadence/entities/todo";
import { resolveZone } from "@/cadence/entities/axis";
import type { AxisConfig } from "@/cadence/entities/axis";
import { NOT_DELETED, newEntityId } from "@/cadence/shared/model/entity";
import type { CadenceDatabase } from "@/cadence/data/db/database";
import { DexieTodoRepo } from "@/cadence/data/repo/dexie-repos";
import type { SoftDeleteRepository } from "@/cadence/data/repo/types";

export interface TodoDeps {
  todos: SoftDeleteRepository<Todo> & {
    /** 某轴配置下的待办（命中 axisConfigId 索引） */
    byAxis(axisConfigId: string): Promise<Todo[]>;
  };
  axes: {
    /** 默认轴配置；新建待办时落到它上面 */
    getDefault(): Promise<AxisConfig | undefined>;
    list(): Promise<AxisConfig[]>;
  };
}

export function createTodoDeps(database: CadenceDatabase): TodoDeps {
  const repo = new DexieTodoRepo(database);
  return {
    todos: repo,
    axes: {
      getDefault: async () => {
        const all = await database.axisConfigs.toArray();
        return all.find((axis) => axis.isDefault) ?? all[0];
      },
      list: () => database.axisConfigs.toArray(),
    },
  };
}

export interface TodoDraft {
  title: string;
  note?: string | undefined;
  coordinate: TodoCoordinate;
  dueAt?: number | undefined;
  tags?: string[];
  /** 不传则落到默认轴 */
  axisConfigId?: string;
}

/** 在指定坐标创建待办（XY 视图空白处点击即建，FR-TODO-11） */
export async function createTodo(
  deps: TodoDeps,
  draft: TodoDraft,
  now: number,
): Promise<Todo> {
  const axisConfigId =
    draft.axisConfigId ?? (await deps.axes.getDefault())?.id ?? "axis-priority";

  return deps.todos.put(
    {
      id: newEntityId("todo", now),
      title: draft.title,
      note: draft.note,
      status: "open",
      axisConfigId,
      coordinate: clampCoordinate(draft.coordinate),
      dueAt: draft.dueAt,
      tags: draft.tags ?? [],
      deletedAt: NOT_DELETED,
      createdAt: now,
      updatedAt: now,
    },
    now,
  );
}

/**
 * 拖拽落点提交
 *
 * 坐标在 UI 层已换算为归一化 0–100（DraggableSurface），这里只做两件事：
 *   1. clamp 兜底（浮点误差 / 越界）
 *   2. 更新坐标。分区不存 —— 派生（FR-TODO-09）
 */
export async function moveTodo(
  deps: TodoDeps,
  todo: Todo,
  coordinate: TodoCoordinate,
  now: number,
): Promise<void> {
  await deps.todos.put(
    { ...todo, coordinate: clampCoordinate(coordinate), updatedAt: now },
    now,
  );
}

/** 勾选 / 取消完成 */
export async function setTodoStatus(
  deps: TodoDeps,
  todo: Todo,
  status: TodoStatus,
  now: number,
): Promise<void> {
  await deps.todos.put({ ...todo, status, updatedAt: now }, now);
}

/** 软删除（回收站） */
export async function deleteTodo(
  deps: TodoDeps,
  id: string,
  now: number,
): Promise<void> {
  await deps.todos.softDelete(id, now);
}

/** 编辑标题 / 备注（右键菜单的"修改"与"编辑备注"共用；空串备注 = 清除） */
export async function updateTodoDetails(
  deps: TodoDeps,
  todo: Todo,
  draft: { title?: string | undefined; note?: string | undefined },
  now: number,
): Promise<void> {
  const title = draft.title?.trim();
  if (title !== undefined && title.length === 0)
    throw new Error("待办标题不能为空");
  const note = draft.note?.trim();
  await deps.todos.put(
    {
      ...todo,
      ...(title !== undefined ? { title } : {}),
      ...(note !== undefined && note.length > 0
        ? { note }
        : { note: undefined }),
      updatedAt: now,
    },
    now,
  );
}

/**
 * 待办在某个轴下的视图模型：坐标 + 派生出的分区
 *
 * 分区在这里派生一次（而不是每个组件各派生一次），
 * 列表与看板共用同一个归属结果，不会出现"两处显示不一致"。
 */
export interface TodoView {
  todo: Todo;
  zoneId: string;
}

export async function withZones(
  deps: TodoDeps,
  axis: AxisConfig,
): Promise<TodoView[]> {
  const todos = await deps.todos.byAxis(axis.id);
  return todos.map((todo) => ({
    todo,
    zoneId: resolveZone(axis, todo.coordinate),
  }));
}
