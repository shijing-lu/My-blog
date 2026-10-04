/**
 * AI 助手 · 本地意图解析器（零网络、零 Key、确定性）
 * ---------------------------------------------------------------------------
 * 设计立场：**宁可说"不会"，绝不猜错。** 每条规则绑定唯一的工具；
 * 一句话命中多个不同意图时判定为 ambiguous 并反问。
 * 这一层同时是无 Key 环境下的完整可用路径（不是降级凑合——它更快更可控）。
 *
 * 顺序敏感的规则放在前面（更长、更具体的模式优先）。
 */

import type { ParseResult } from "./types";

interface LocalRule {
  /** 命中的工具名 */
  tool: string;
  summary: string;
  /** 全部都必须匹配（正则，i 不区分大小写）；groups 作为参数来源 */
  patterns: RegExp[];
  /** 本规则命中时被忽略的工具（更具体的说法优先于更泛的说法） */
  suppress?: string[];
  /** 从 match 数组构造工具参数；返回 null 表示匹配了字面但参数不足（触发反问） */
  build: (match: RegExpMatchArray) => Record<string, unknown> | null;
}

/**
 * 把"写周报、回邮件 然后 整理数据"切成清单。
 * 导出共用：daily_plan_set 的 LLM 参数纠错（string → string[]）也用它，
 * 保证本地规则与 LLM 路由对"清单"的理解一致。
 *
 * 分隔符：顿号 / 逗号 / 分号 / "然后" / "和"，以及"数字 + 点 + 空白"编号。
 * 编号后要求空白，避免把"版本 2.0 发布"里的 2.0 误当编号。
 */
export function splitItemList(raw: string): string[] {
  return raw
    .split(/\s*(?:、|，|,|；|;|然后|和)\s*|\s*\d+[.、:：]\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const RULES: LocalRule[] = [
  /* ── 每日计划（⚠️ 必须排在 plan_create 之前：
   * 「制定今天的计划」与「制定计划」是两个不同意图，靠"今天/今日"关键词分界 ——
   * 见 docs/07 §4 的正反例表） ── */
  {
    tool: "daily_plan_set",
    summary: "制定今天的计划",
    suppress: ["plan_create", "daily_plan_add"],
    patterns: [
      /(?:制定|排|安排|规划)(?:一下)?(?:今天|今日)(?:的)?(?:执行)?计划[:：，,]?\s*(.+)/,
      /今天(?:要|打算|准备)(?:做|干|完成)(?:这些|如下|以下)?[:：]?\s*(.+)/,
    ],
    build: (match) => {
      const raw = match[1]?.trim();
      if (raw === undefined || raw.length === 0) return null;
      // 分隔符：顿号 / 逗号 / 分号 / "然后" / 数字编号（切分逻辑见 splitItemList）
      const items = splitItemList(raw);
      if (items.length === 0) return null;
      return { items };
    },
  },
  {
    tool: "daily_plan_add",
    summary: "往今天的计划加一项",
    suppress: ["daily_plan_set", "todo_create"],
    patterns: [
      /(?:今天|今日)(?:再)?(?:加|添加)(?:一项|一条|一件事|一个)[:：]?\s*(.+?)(?:，?大概?\s*(\d+)\s*分钟)?[。.]?$/,
      /(?:加|放)到今天(?:的计划)?(?:里|中)[:：]?\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      if (title === undefined || title.length === 0) return null;
      return {
        title,
        estimateMinutes: match[2] !== undefined ? Number(match[2]) : undefined,
      };
    },
  },
  {
    tool: "daily_plan_add_task",
    summary: "把任务排进今天",
    patterns: [
      /(?:今天|今日)(?:做|排|处理)\s*任务[:：]?\s*(.+?)[。.]?$/,
      /把(?:任务)?[:：]?\s*(.+?)\s*(?:任务)?排(?:到|进|入)(?:今天|今日)(?:的)?(?:计划|日程)?[。.]?$/,
    ],
    build: (match) => {
      const task = match[1]?.trim();
      return task !== undefined && task.length > 0 ? { task } : null;
    },
  },
  {
    tool: "daily_plan_done",
    summary: "完成今天计划里的一项",
    patterns: [
      /今天(?:的)?(?:计划)?(?:里的)?[:：]?\s*(.+?)\s*(?:做完了|完成了|搞定(?:了)?)[。.]?$/,
      /(?:完成|勾掉|划掉)今天(?:计划)?(?:里的)?[:：]?\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      return title !== undefined && title.length > 0 ? { title } : null;
    },
  },
  {
    tool: "daily_plan_remove",
    summary: "从今天的计划移除一项",
    patterns: [
      /(?:从|把)今天(?:的)?(?:计划)?(?:里)?(?:移除|去掉|删掉|划掉)[:：]?\s*(.+?)[。.]?$/,
      /今天(?:的)?计划(?:里)?(?:不要|取消)[:：]?\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      return title !== undefined && title.length > 0 ? { title } : null;
    },
  },
  {
    tool: "daily_plan_report",
    summary: "播报今天的计划",
    // 提到"计划/安排"的问句归日计划；"日程"归 schedule_report（docs/08 §AI）
    suppress: ["overview_report"],
    patterns: [
      /(?:今天|今日)(?:的)?(?:计划|安排)(?:是什[么么]|有哪些|怎么样)/,
      /(?:说|看|报)一下今天(?:的)?(?:计划|安排)/,
    ],
    build: () => ({}),
  },

  /* ── 日程（⚠️ "日程"与"计划"是两个领域：docs/08 §AI 对照表） ── */
  {
    tool: "schedule_report",
    summary: "播报今天的日程",
    suppress: ["overview_report", "daily_plan_report"],
    patterns: [
      /(?:今天|今日)?(?:的)?日程(?:是什[么么]|有哪些|怎么样|安排)/,
      /(?:说|看|报)一下今天(?:的)?日程/,
    ],
    build: () => ({}),
  },
  {
    tool: "schedule_create",
    summary: "按一句话创建日程",
    suppress: [
      "daily_plan_add",
      "daily_plan_set",
      "task_create",
      "todo_create",
    ],
    patterns: [
      // 显式点名日程："安排日程：6点到7点背单词"
      /(?:新增?|添加?|建立?|安排?|排)(?:一[项条个])?(?:日程|时间块)(?:[：:]|\s)?(.+)/,
      // 裸时间段句："6点到7点背单词，7点半到9点复习数学"（两个时刻夹连接词；捕获整句）
      /((?:\d{1,2}|[一两二三四五六七八九十]{1,3})\s*(?:点|:|：).{0,12}?(?:到|至|~|～|—|–|-).{0,10}?(?:\d{1,2}|[一两二三四五六七八九十]{1,3})\s*(?:点|:|：).*)/,
    ],
    build: (match) => {
      const text = (match[1] ?? match[0]).trim();
      if (text.length === 0) return null;
      return { text };
    },
  },
  {
    tool: "schedule_rename",
    summary: "修改日程标题或备注",
    patterns: [
      /(?:把)?\s*(.+?)\s*(?:的)?(?:标题|名字)改成?\s*(.+)/,
      /(?:把)?\s*(.+?)\s*(?:的)?备注改成?\s*(.+)/,
    ],
    build: (match) => {
      const target = match[1]?.trim();
      const value = match[2]?.trim();
      if (target === undefined || value === undefined || value.length === 0)
        return null;
      // 区分两条 pattern 命中的是标题还是备注：看捕获到的关键词
      const isNote = /备注/.test(match[0]);
      return isNote
        ? { title: target, note: value }
        : { title: target, newTitle: value };
    },
  },
  {
    tool: "schedule_resize",
    summary: "调整日程结束时间或时长",
    suppress: ["schedule_move"],
    patterns: [
      /(?:把)?\s*(.+?)\s*(?:延|拖|拉)长?\s*(\d+)\s*分钟/,
      /(?:把)?\s*(.+?)\s*(?:改到?|延到?|拖到?|调到?)\s*((?:\d{1,2}|[一两二三四五六七八九十]{1,3})\s*(?:[:：]\s*\d{2}|点半|一刻|三刻|点)?)\s*结束/,
      /(?:把)?\s*(.+?)\s*(?:的结束时间|结束)(?:改到?|延到?|拖到?|调到?)\s*((?:\d{1,2}|[一两二三四五六七八九十]{1,3})\s*(?:[:：]\s*\d{2}|点半|一刻|三刻|点)?)/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      if (title === undefined) return null;
      if (match[2] !== undefined && /^\d+$/.test(match[2])) {
        return { title, durationMinutes: Number(match[2]) };
      }
      const time = match[2]?.trim();
      if (time === undefined || time.length === 0) return null;
      return { title, endTime: time };
    },
  },
  {
    tool: "schedule_move",
    summary: "挪动日程开始时间",
    patterns: [
      /(?:把)?\s*(.+?)\s*(?:挪|移|改|调)(?:到|至)\s*((?:\d{1,2}|[一两二三四五六七八九十]{1,3})\s*(?:[:：]\s*\d{2}|点半|一刻|三刻|点)?)/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      const time = match[2]?.trim();
      if (title === undefined || time === undefined || time.length === 0)
        return null;
      return { title, time };
    },
  },
  {
    tool: "schedule_complete",
    summary: "标记日程完成",
    suppress: ["task_set_status"],
    // 注意：裸"X做完了"归今日计划（daily_plan_done，既有行为）；
    // 日程完成必须显式带"日程/时间块"字样 —— 边界写入 docs/08 §AI 对照表
    patterns: [
      /(?:把)?\s*(.+?)\s*(?:的)?(?:日程|时间块)(?:做完了|搞定了|完成了|标记?(?:为)?完成)/,
      /日程\s*(.+?)\s*(?:做完了|搞定了|完成了)/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      if (title === undefined || title.length === 0) return null;
      return { title, done: true };
    },
  },
  {
    tool: "schedule_delete",
    summary: "删除日程",
    patterns: [/(?:删除|删掉|去掉|取消)\s*(.+?)\s*(?:的)?(?:日程|时间块)/],
    build: (match) => {
      const title = match[1]?.trim();
      if (title === undefined || title.length === 0) return null;
      return { title };
    },
  },

  /* ── 倒计时（docs/10 §AI） ── */
  {
    tool: "countdown_create",
    summary: "新建倒计时",
    patterns: [
      // 动词式："建一个倒计时：考研 100 天"
      /(?:建|新建|设|设置|加|来)(?:一个|个)?倒计时[:：，,]?\s*([^\d\s][^，,：:]*?)\s*(\d+)\s*(分钟|小时|天)(?:后)?/,
      // 冒号式："倒计时：考研 100 天"（必须有分隔符：否则"倒计时 30 分钟"这类无名句会被误读）
      /倒计时[:：，,]\s*([^\d\s][^，,：:]*?)\s*(\d+)\s*(分钟|小时|天)(?:后)?/,
    ],
    build: (match) => {
      const name = match[1]?.trim();
      const amount = Number(match[2]);
      const unitText = match[3];
      if (
        name === undefined ||
        name.length === 0 ||
        !Number.isFinite(amount) ||
        amount <= 0
      )
        return null;
      const unit =
        unitText === "分钟" ? "minute" : unitText === "小时" ? "hour" : "day";
      return { name, amount, unit };
    },
  },
  {
    tool: "countdown_report",
    summary: "播报倒计时剩余",
    suppress: ["overview_report"],
    patterns: [
      /(?:还有多少|还剩多少)(?:天|时间|小时|分钟)?(?:就)?(?:到)?\s*(.+)/,
      /倒计时(?:还剩|还有|剩下|都剩|怎么样|有哪些|是什么)/,
      /(.+?)(?:倒计时)?(?:还)?(?:剩|有)多少(?:天|小时|分钟)/,
    ],
    build: (match) => {
      const name = match[1]?.trim();
      return name !== undefined && name.length > 0 ? { name } : {};
    },
  },
  {
    tool: "countdown_pause",
    summary: "暂停 / 继续倒计时",
    suppress: ["countdown_create"],
    patterns: [
      /(?:暂停|继续)\s*(.+?)\s*(?:的)?倒计时/,
      /(.+?)\s*(?:的)?倒计时\s*(?:暂停|继续)/,
    ],
    build: (match) => {
      const name = match[1]?.trim();
      if (name === undefined || name.length === 0) return null;
      return { name, paused: !/继续/.test(match[0]) };
    },
  },
  {
    tool: "countdown_adjust",
    summary: "给倒计时加时 / 减时",
    patterns: [
      /(?:给)?\s*(.+?)\s*(?:的)?倒计时\s*(加|减|延|缩短)\s*(\d+)\s*(分钟|小时|天)/,
    ],
    build: (match) => {
      const name = match[1]?.trim();
      const amount = Number(match[3]);
      const unitText = match[4];
      if (
        name === undefined ||
        name.length === 0 ||
        !Number.isFinite(amount) ||
        amount <= 0
      )
        return null;
      const unit =
        unitText === "分钟" ? "minute" : unitText === "小时" ? "hour" : "day";
      const direction = match[2] === "加" || match[2] === "延" ? "add" : "sub";
      return { name, amount, unit, direction };
    },
  },
  {
    tool: "countdown_remove",
    summary: "删除倒计时",
    patterns: [/(?:删除|删掉|去掉)\s*(.+?)\s*(?:的)?倒计时/],
    build: (match) => {
      const name = match[1]?.trim();
      return name !== undefined && name.length > 0 ? { name } : null;
    },
  },

  /* ── 专注 ── */
  {
    tool: "focus_stop",
    summary: "结束当前专注",
    patterns: [/结束(这段)?专注/, /停止(计时|专注)/],
    build: () => ({}),
  },
  {
    tool: "focus_start",
    summary: "开始专注",
    patterns: [
      /开始(?:一段)?专注(?:[:：，,]?\s*(.*))?/,
      /专注(?:[:：]\s*)?(.+)$/ /* "专注写周报" */,
    ],
    build: (match) => ({ note: match[1]?.trim() || undefined }),
  },

  /* ── 待办（先于计划：'待办'字样优先级更高） ── */
  {
    tool: "todo_create",
    summary: "记一条待办",
    patterns: [
      /(?:记|添加|新增|创建)(?:一条)?待办[:：，,]?\s*(.+?)(?:[，,]\s*放?在?([^，,。]+象限|重要[^，,。]*|紧急[^，,。]*|不重要[^，,。]*))?[。.]?$/,
      /(.+?)，?放到?([^，,。]+象限)[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      if (title === undefined || title.length === 0) return null;
      return { title, quadrant: match[2]?.trim() || undefined };
    },
  },
  {
    tool: "todo_set_status",
    summary: "完成待办",
    patterns: [
      /待办[:：]?\s*(.+?)\s*(?:已经)?完成(?:了)?[。.]?$/,
      /完成待办[:：]?\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      return title !== undefined && title.length > 0
        ? { todo: title, done: true }
        : null;
    },
  },
  {
    tool: "todo_delete",
    summary: "删除待办",
    patterns: [
      /删除待办[:：]?\s*(.+?)[。.]?$/,
      /待办[:：]?\s*(.+?)\s*(?:删掉|删除)[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      return title !== undefined && title.length > 0 ? { todo: title } : null;
    },
  },

  /* ── 任务 ── */
  {
    tool: "task_create",
    summary: "给计划添加任务",
    // "添加任务 X，备注 Y"比"给 X 写备注"更具体，命中时压制备注规则
    suppress: ["task_note"],
    patterns: [
      /给[:：]?\s*(.+?)\s*(?:计划|计划里)添加?任务[:：]?\s*(.+?)[。.]?$/,
      /(?:在|给)\s*(.+?)\s*(?:计划)?(?:里|下|中)(?:添加|新增|建|加)(?:一个)?任务[:：]?\s*([^，,。]+?)(?:，备注[:：]?([^，,。]+))?[。.]?$/,
    ],
    build: (match) => {
      const plan = match[1]?.trim();
      const title = match[2]?.trim();
      if (plan === undefined || title === undefined || title.length === 0)
        return null;
      return { plan, title, note: match[3]?.trim() || undefined };
    },
  },
  {
    tool: "task_create_sub",
    summary: "添加子任务",
    patterns: [
      /给(?:任务)?[:：]?\s*(.+?)\s*(?:添加|加)(?:一个)?子任务[:：]?\s*(.+?)[。.]?$/,
      /在\s*(.+?)\s*(?:下|里)(?:面)?(?:添加|建|加)子任务[:：]?\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const parent = match[1]?.trim();
      const title = match[2]?.trim();
      if (parent === undefined || title === undefined || title.length === 0)
        return null;
      return { parent, title };
    },
  },
  {
    tool: "task_set_status",
    summary: "完成任务 / 重新打开任务",
    patterns: [
      /(?:把|将)?\s*任务[:：]?\s*(.+?)\s*(?:标记)?(?:完成|做完)(?:了)?[。.]?$/,
      /完成任务[:：]?\s*(.+?)[。.]?$/,
      /(?:把|将)\s*(.+?)\s*任务重新打开[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      if (title === undefined || title.length === 0) return null;
      const done = !/重新打开/.test(match[0]);
      return { task: title, done };
    },
  },
  {
    tool: "task_note",
    summary: "写任务备注",
    patterns: [
      /给(?:任务)?[:：]?\s*(.+?)\s*(?:添加|写|加)备注[:：]?\s*(.+?)[。.]?$/,
      /任务[:：]?\s*(.+?)\s*备注(?:是|改为|改成|写)?[:：]?\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const task = match[1]?.trim();
      const note = match[2]?.trim();
      if (task === undefined || note === undefined || note.length === 0)
        return null;
      return { task, note };
    },
  },
  {
    tool: "task_delete",
    summary: "删除任务",
    patterns: [
      /删除任务[:：]?\s*(.+?)[。.]?$/,
      /任务[:：]?\s*(.+?)\s*(?:删掉|删除)[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      return title !== undefined && title.length > 0 ? { task: title } : null;
    },
  },

  /* ── 计划 ── */
  {
    tool: "plan_set_status",
    summary: "改变计划状态",
    patterns: [
      /(?:把|将)?\s*(.+?)\s*计划(?:标记)?(?:暂停|挂起)/,
      /(?:把|将)?\s*(.+?)\s*计划(?:标记)?(?:完成|做完)/,
      /(?:把|将)?\s*(.+?)\s*计划归档/,
      /(?:继续|恢复|重启)\s*(.+?)\s*计划/,
    ],
    build: (match) => {
      const plan = match[1]?.trim();
      if (plan === undefined || plan.length === 0) return null;
      const text = match[0];
      const status = /暂停|挂起/.test(text)
        ? "暂停"
        : /归档/.test(text)
          ? "归档"
          : /继续|恢复|重启/.test(text)
            ? "继续"
            : "完成";
      return { plan, status };
    },
  },
  {
    tool: "plan_update",
    summary: "修改计划说明",
    patterns: [
      /(?:把|将)\s*(.+?)\s*计划的?(?:说明|备注|描述)(?:改为|改成|更新为|设置为)[:：]?\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const plan = match[1]?.trim();
      const description = match[2]?.trim();
      if (plan === undefined || description === undefined) return null;
      return { plan, description };
    },
  },
  {
    tool: "plan_delete",
    summary: "删除计划（需确认）",
    patterns: [
      /删除计划[:：]?\s*(.+?)[。.]?$/,
      /计划[:：]?\s*(.+?)\s*(?:删掉|删除)[。.]?$/,
    ],
    build: (match) => {
      const plan = match[1]?.trim();
      return plan !== undefined && plan.length > 0 ? { plan } : null;
    },
  },
  {
    tool: "plan_create",
    summary: "新建计划",
    patterns: [
      /(?:制定|创建|新建|建)(?:一个)?(?:新的)?计划[:：，,]?\s*(.+?)(?:[，,](?:说明|描述)[:：]?(.+?))?[。.]?$/,
    ],
    build: (match) => {
      const title = match[1]?.trim();
      if (title === undefined || title.length === 0) return null;
      return { title, description: match[2]?.trim() || undefined };
    },
  },

  /* ── 复盘 ── */
  {
    tool: "review_entry_write",
    summary: "写当前时段复盘",
    patterns: [
      /(?:写|记)(?:一条|个)?复盘[:：]?\s*(.+?)(?:，心情([1-5]))?[。.]?$/,
      /复盘[:：]\s*(.+?)[。.]?$/,
    ],
    build: (match) => {
      const content = match[1]?.trim();
      if (content === undefined || content.length === 0) return null;
      return {
        content,
        mood: match[2] !== undefined ? Number(match[2]) : undefined,
      };
    },
  },
  {
    tool: "review_schedule_create",
    summary: "创建复盘周期",
    patterns: [
      /(?:建|创建|新建)(?:一个)?复盘周期(?:每|每隔)\s*([\d.]+)\s*(?:个)?小时(?:[:：，,]?(?:叫|名称)?[:：]?\s*([^，,。]+))?(?:，引导语[:：]?(.+?))?[。.]?$/,
      /(?:建|创建|新建)(?:一个)?(?:叫|名为|名称为)?[:：]?\s*([^，,。]+?)\s*的复盘周期/,
    ],
    build: (match) => {
      // 第一个模式：每 N 小时；第二个模式：只有名称
      const hours =
        match[1] !== undefined && /^[\d.]+$/.test(match[1])
          ? Number(match[1])
          : undefined;
      if (hours !== undefined) {
        return {
          title: match[2]?.trim() || `${hours} 小时复盘`,
          intervalHours: hours,
          prompt: match[3]?.trim() || undefined,
        };
      }
      const title = match[1]?.trim() ?? match[2]?.trim();
      if (title === undefined || title.length === 0) return null;
      return { title };
    },
  },

  /* ── 应用 ── */
  {
    tool: "theme_set",
    summary: "切换主题",
    patterns: [
      /(?:切换|换)(?:到|成|为)?(纸面|浅色|墨夜|深色|暗色)(?:主题|模式)?/,
    ],
    build: (match) => ({ mode: match[1]?.trim() ?? "" }),
  },
  {
    tool: "navigate",
    summary: "跳转页面",
    patterns: [
      /(?:打开|去|跳到|进入)(?:一下)?(总览|计划|执行|复盘|待办|设置)(?:页|页面|面板)?/,
    ],
    build: (match) => ({ page: match[1]?.trim() ?? "" }),
  },
  {
    tool: "overview_report",
    summary: "播报今日总览",
    patterns: [
      /今天(?:过得)?怎么样/,
      /今日(?:总览|概况|状态)/,
      /现在(?:的)?情况(?:如何|怎么样)/,
    ],
    build: () => ({}),
  },
];

/**
 * 解析一句话为一个意图。
 * 确定性保证：只接受"恰好一个规则命中"的话；多个不同工具命中时，
 * 先应用 suppress 优先级（具体说法压过泛化说法），仍有冲突 → ambiguous。
 */
export function parseLocal(input: string): ParseResult {
  const text = input.trim();
  if (text.length === 0) return { tool: undefined, reason: "unsupported" };

  /** 同一工具可能被多条 pattern 命中，只保留第一条的参数 */
  const hits = new Map<
    string,
    { rule: LocalRule; args: Record<string, unknown> }
  >();

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match === null) continue;
      const args = rule.build(match);
      if (args === null) continue; // 参数不足：不算命中，继续尝试其他规则
      if (!hits.has(rule.tool)) hits.set(rule.tool, { rule, args });
      break;
    }
  }

  // suppress：具体规则压掉被它包含的泛化规则（如"添加任务 X，备注 Y"压掉"写备注"）
  for (const { rule } of hits.values()) {
    for (const suppressed of rule.suppress ?? []) {
      if (hits.has(suppressed) && suppressed !== rule.tool) {
        hits.delete(suppressed);
      }
    }
  }

  if (hits.size === 0) {
    return { tool: undefined, reason: "unsupported" };
  }
  if (hits.size > 1) {
    return { tool: undefined, reason: "ambiguous" };
  }

  const hit = hits.values().next().value!;
  return {
    tool: hit.rule.tool,
    args: hit.args,
    via: "local",
    summary: hit.rule.summary,
  };
}
