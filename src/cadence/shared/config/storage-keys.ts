/**
 * localStorage / sessionStorage 的 key 集中管理
 *
 * ⚠️ `appearance` 这个 key 在 index.html 的内联防闪烁脚本中也被硬编码引用
 *    （那里无法 import 模块）。改动时必须同步修改 index.html。
 */
export const STORAGE_KEYS = {
  /** 外观设置：主题 / 质感强度 / 动效强度 */
  appearance: "cadence.appearance",
  /** 外壳布局偏好：侧边栏折叠等 */
  shell: "cadence.shell",
  /** AI 助手配置：LLM 接口地址 / 密钥 / 模型 */
  assistant: "cadence.assistant",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
