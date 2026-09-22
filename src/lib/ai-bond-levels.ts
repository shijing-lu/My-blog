/**
 * AI 小卿：等级表（纯常量 + 纯函数，**客户端可安全引用**）
 *
 * ⚠️ 此文件禁止 import 任何 DB / Node 专属模块——AiChatFloat / XiaoQingFox
 * 等客户端组件会直接引用它；一旦混入服务端依赖，DB 代码会被打进浏览器
 * bundle，岛在加载时崩溃（表现为按钮点击无响应）。
 * DB 读写相关的都在 ai-bond.ts，此处只放等级派生与文案。
 */

/** 等级阈值：bondPoints 达到即晋级 */
export const LEVEL_THRESHOLDS = [0, 30, 80, 160, 280, 450, 680, 950] as const;

/** 等级行为约束（注入到 system 的人格段落） */
export const LEVEL_BEHAVIOR: Record<number, string> = {
  0: '用敬语、只回答问题、不主动延伸话题',
  1: '可用「你」称呼，允许一句轻松收尾',
  2: '允许小调侃、可以提"上次你说过"',
  3: '可主动关心一句（作息/进度）、允许网络化表达',
  4: '可用专属昵称、适度玩笑、可主动追问细节',
  5: '允许打趣、吐槽、共情式回应；可引用共同记忆',
  6: '允许嬉皮打闹式玩笑（仍守边界）、会记得纪念性事件',
  7: '最放松的语气，可主动开启话题、偶尔撒娇式抱怨',
};

/** 等级名称（UI 展示用） */
export const LEVEL_NAMES = ['客人', '熟客', '熟人', '朋友', '好友', '知己', '挚友', '心之所系'] as const;

/** 由 bondPoints 派生等级（0~7，纯函数） */
export function deriveLevel(bondPoints: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (bondPoints >= LEVEL_THRESHOLDS[i]!) return i;
  }
  return 0;
}

/** 由等级取行为约束文本（供 chat 端点注入 system） */
export function levelBehaviorText(level: number): string {
  return LEVEL_BEHAVIOR[Math.min(level, 7)] ?? LEVEL_BEHAVIOR[0]!;
}
