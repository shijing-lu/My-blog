/**
 * AI 助手 · 类型与行为规则
 * ---------------------------------------------------------------------------
 * 核心架构：**能力注册表（tools）+ 意图路由（parser / LLM）+ 编排器（run）**。
 * AI 不直接碰数据库 —— 它只能从注册表里"点名"一个工具，参数经 Zod 校验后
 * 由编排器调用现有的用例层。应用里用户能做的每一件事都对应注册表中的一个工具，
 * 因此"AI 能做的 ⊆ 用户能做的"，这是职责边界的结构性保证。
 *
 * 行为边界（六条铁律，写入 LLM 系统提示，并由编排器代码强制）：
 *   R1 一条指令 = 恰好一个工具。绝不通配、绝不串联执行多个操作。
 *   R2 意图与工具必须语义完全匹配："制定计划"绝不允许落到待办上。
 *   R3 参数只能取自用户话语；可选参数缺失就留空，**必需参数缺失时反问，不猜测**。
 *   R4 破坏性操作（删除类）必须经用户在界面上二次确认。
 *   R5 意图无法确定时，列出能力清单请用户澄清，绝不"猜一个最像的"执行。
 *   R6 工具执行结果如实回告，不粉饰、不虚报成功。
 */

import type { z } from "zod";

/** 工具执行上下文：时间与宿主能力由外部注入（与全站"用例层不读系统时间"纪律一致） */
export interface ToolContext {
  now: number;
  /** 页面跳转（由 UI 层注入 router，逻辑层不依赖路由实现） */
  navigate: (to: string) => Promise<unknown>;
}

/** 注册表中的一个能力 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AssistantTool<T extends z.ZodTypeAny = any> {
  /** 稳定工具名（LLM function-calling 的 name，也用于本地路由） */
  name: string;
  /** 一句话中文描述（进入 LLM 的工具列表，也是"无法确定意图"时的能力清单） */
  description: string;
  /** 参数 JSON Schema 的 zod 描述；execute 前会被 parse 校验 */
  params: T;
  /** 删除类操作：执行前必须经用户确认 */
  destructive: boolean;
  execute: (args: z.output<T>, ctx: ToolContext) => Promise<string>;
}

/** 一次解析结果：意图命中某个工具 */
export interface ParsedCommand {
  tool: string;
  args: Record<string, unknown>;
  /** 命中来路：本地规则（确定性）或 LLM */
  via: "local" | "llm";
  /** 意图说明（回显给用户） */
  summary: string;
}

/** 解析失败：无法确定意图（R5 —— 绝不猜） */
export interface ParseFailure {
  tool: undefined;
  reason: "ambiguous" | "unsupported";
  /** 反问 / 拒答时要对用户说的话（LLM 路径由 LLM 生成；本地路径由面板生成能力清单） */
  summary?: string;
  missingParam?: string;
}

export type ParseResult = ParsedCommand | ParseFailure;

export function isParsed(command: ParseResult): command is ParsedCommand {
  return command.tool !== undefined;
}

/** 六条铁律的完整文本（LLM 系统提示用；本地路由天然满足，代码另行强制 R1/R3/R4） */
export const BEHAVIOR_RULES = [
  "你是一个本地效率应用的操作执行器，不是聊天机器人。用户说的话是要执行的操作，不是闲聊。",
  '每次只允许调用一个工具，且该工具的语义必须与用户意图完全匹配：说"制定计划"只能调用创建计划的工具，绝不允许调用创建待办；说"完成任务"只能改任务状态，绝不允许删除或新建任何东西。不扩大、不缩小、不改写操作范围。',
  "参数只能来自用户话语。可选参数缺失就省略；必需参数缺失时，不要调用工具，改为向用户提出一个具体的澄清问题。",
  "删除类工具永远不允许直接调用，只能提示用户在界面里操作或要求确认。",
  '如果没有任何工具与意图匹配，如实说做不到，并简短列出你能做的操作类别。绝不猜测、绝不调用"最接近"的工具。',
  "执行结果会由系统回填，不要虚构执行结果。",
] as const;

/** 用户可见的能力边界说明（设置页与助手空态展示） */
export const CAPABILITY_SUMMARY = [
  "倒计时：建一个（分钟/小时/天）/ 加时减时 / 暂停与继续 / 播报剩余 / 删除（需确认）",
  "今日计划：制定今天做什么 / 加一项 / 勾完成 / 播报进度",
  "日程：一句话建多条（带起止时间）/ 挪时间 / 调时长 / 改标题备注 / 标完成 / 删除（需确认）/ 播报",
  "计划：新建 / 改标题说明 / 暂停完成归档 / 删除（需确认）",
  "任务：给计划加任务、加子任务 / 完成与重开 / 写备注 / 删除（需确认）",
  "待办：在指定象限记一条 / 改状态 / 删除（需确认）",
  "专注：开始专注（可带事项）/ 结束专注（自动进入该时段复盘）",
  "复盘：建复盘周期 / 给当前时段写一条复盘",
  "应用：跳转到任意页面 / 切换纸面与墨夜主题 / 播报今日总览",
] as const;
