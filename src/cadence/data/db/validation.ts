import { z } from 'zod'
import { PIGMENT_KEYS } from '@/cadence/shared/config/pigment'
/* ── 基础 Schema ── */

const IsoId = z.string().min(1)
const Timestamp = z.number().int()
const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, '日期不存在')

const SoftDeletableSchema = z.object({ deletedAt: Timestamp.optional() })
const TimestampedSchema = z.object({ createdAt: Timestamp, updatedAt: Timestamp })
const TagsSchema = z.object({ tags: z.array(z.string()) })

const PigmentKeySchema = z.enum(PIGMENT_KEYS)

/* ── 实体 Schema ── */

const PlanStatusSchema = z.enum(['active', 'paused', 'completed', 'archived'])
const TaskStatusSchema = z.enum(['todo', 'doing', 'done', 'blocked'])
const TodoStatusSchema = z.enum(['open', 'doing', 'done', 'archived'])

const PlanSchema = TimestampedSchema.extend(SoftDeletableSchema.shape).extend(TagsSchema.shape).extend({
  id: IsoId,
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  status: PlanStatusSchema,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  color: PigmentKeySchema,
})

const TaskSchema = TimestampedSchema.extend(SoftDeletableSchema.shape).extend(TagsSchema.shape).extend({
  id: IsoId,
  planId: IsoId,
  parentId: IsoId.optional(),
  title: z.string().min(1).max(200),
  note: z.string().optional(),
  status: TaskStatusSchema,
  order: z.number(),
  estimateMinutes: z.number().positive().optional(),
  dueAt: Timestamp.optional(),
})

const SessionSchema = TimestampedSchema.extend({
  id: IsoId,
  taskId: IsoId.optional(),
  planId: IsoId.optional(),
  startedAt: Timestamp,
  endedAt: Timestamp.optional(),
  pausedAt: Timestamp.optional(),
  pausedMs: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
})

const ReviewScheduleSchema = TimestampedSchema.extend(SoftDeletableSchema.shape).extend({
  id: IsoId,
  title: z.string().min(1).max(120),
  intervalHours: z.number().min(24 / 500),
  anchorOffsetMs: z.number().int().min(0).max(86399999),
  enabled: z.boolean(),
  order: z.number().int(),
  prompt: z.string().optional(),
})

const ReviewEntrySchema = TimestampedSchema.extend(TagsSchema.shape).extend(SoftDeletableSchema.shape).extend({
  id: IsoId,
  scheduleId: IsoId,
  slotStart: Timestamp,
  dateKey: CalendarDate,
  content: z.string().max(20_000),
  mood: z.number().int().min(1).max(5).optional(),
})

const TodoCoordinateSchema = z.object({
  // 刻意不设 min/max：坐标越界属于"可归一化"问题（导入后 clamp 收敛），
  // 而不是"结构非法"。若在这里拦截，normalizeBundle 的收敛逻辑永远不会执行。
  x: z.number(),
  y: z.number(),
})

const TodoSchema = TimestampedSchema.extend(SoftDeletableSchema.shape).extend(TagsSchema.shape).extend({
  id: IsoId,
  title: z.string().min(1).max(200),
  note: z.string().optional(),
  status: TodoStatusSchema,
  axisConfigId: IsoId,
  coordinate: TodoCoordinateSchema,
  dueAt: Timestamp.optional(),
})

const ZoneRegionSchema = z.object({
  id: IsoId,
  label: z.string().min(1).max(60),
  color: PigmentKeySchema,
  x0: z.number().min(0).max(100),
  y0: z.number().min(0).max(100),
  x1: z.number().min(0).max(100),
  y1: z.number().min(0).max(100),
  order: z.number().int(),
})

const AxisConfigSchema = TimestampedSchema.extend({
  id: IsoId,
  name: z.string().min(1).max(80),
  axisXLabel: z.string().min(1).max(40),
  axisYLabel: z.string().min(1).max(40),
  regions: z.array(ZoneRegionSchema),
  fallbackZoneId: IsoId,
  isDefault: z.boolean(),
})

const SettingRowSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  updatedAt: Timestamp,
})

const DailyItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['task', 'todo', 'free']),
  refId: z.string().optional(),
  title: z.string().min(1).max(500),
  note: z.string().max(2000).optional(),
  estimateMinutes: z.number().positive().max(24 * 60).optional(),
  done: z.boolean(),
  refMissing: z.boolean().optional(),
})

const DailyPlanSchema = TimestampedSchema.extend({
  id: IsoId,
  dateKey: CalendarDate,
  items: z.array(DailyItemSchema).max(200),
})

const ScheduleEventSchema = TimestampedSchema.extend({
  id: IsoId,
  dateKey: CalendarDate,
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
  title: z.string().min(1).max(500),
  note: z.string().max(2000).optional(),
  refKind: z.enum(['plan-item', 'task', 'free']).optional(),
  refId: z.string().optional(),
  done: z.boolean(),
})

const CountdownSchema = TimestampedSchema.extend(SoftDeletableSchema.shape).extend({
  id: IsoId,
  name: z.string().min(1).max(200),
  unit: z.enum(['minute', 'hour', 'day']),
  targetAt: Timestamp,
  pausedRemainingMs: Timestamp.nullable().optional(),
  color: PigmentKeySchema,
  order: z.number().int(),
})

/** 导出包的结构。format 字段用于"用户拿错文件"时的快速失败 */export const ExportBundleSchema = z.object({
  format: z.literal('cadence-export'),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.number().int(),
  appVersion: z.string(),
  data: z.object({
    plans: z.array(PlanSchema),
    tasks: z.array(TaskSchema),
    sessions: z.array(SessionSchema),
    reviewSchedules: z.array(ReviewScheduleSchema),
    reviewEntries: z.array(ReviewEntrySchema),
    todos: z.array(TodoSchema),
    axisConfigs: z.array(AxisConfigSchema),
    // default([])：兼容 schemaVersion 1 早期导出的文件（尚无日计划表）。
    // 空数组不会清空库内数据 —— importBundle 只 bulkPut 非空表
    dailyPlans: z.array(DailyPlanSchema).default([]),
    scheduleEvents: z.array(ScheduleEventSchema).default([]),
    // 旧导出文件无该键 → 空数组；importBundle 只 bulkPut 非空表，不会清空库内数据
    countdowns: z.array(CountdownSchema).default([]),
    settings: z.array(SettingRowSchema),
  }),
})


export const PayloadSchemas = { plans: PlanSchema, tasks: TaskSchema, sessions: SessionSchema, reviewSchedules: ReviewScheduleSchema, reviewEntries: ReviewEntrySchema, todos: TodoSchema, axisConfigs: AxisConfigSchema, dailyPlans: DailyPlanSchema, scheduleEvents: ScheduleEventSchema, countdowns: CountdownSchema, settings: SettingRowSchema };
