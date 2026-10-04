/**
 * AI 助手配置（是否启用 LLM、服务地址、密钥、模型）
 *
 * 助手**不配置也能用**：本地规则解析器覆盖全部高频操作，零网络零 Key。
 * 配置了 OpenAI 兼容接口后，无法被本地规则覆盖的长句会交给 LLM 做意图路由
 * （LLM 只负责"选工具 + 提参数"，执行仍走本应用的用例层 —— 参数要过 Zod，
 * 删除要过确认，边界与本地路径完全一致）。
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AssistantConfigState {
  /** 启用 LLM 意图路由；false = 只用本地规则解析 */
  llmEnabled: boolean;
  /** OpenAI 兼容接口，如 https://api.deepseek.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  setConfig: (patch: Partial<Omit<AssistantConfigState, "setConfig">>) => void;
}

const DEFAULTS = {
  llmEnabled: false,
  baseUrl: "",
  apiKey: "",
  model: "",
};

export const useAssistantStore = create<AssistantConfigState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setConfig: (patch) => set(patch),
    }),
    {
      name: "byqx-cadence.assistant",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        llmEnabled: state.llmEnabled,
      }),
    },
  ),
);

/** 仅编排器使用的非响应式读取 */
export function assistantConfig() {
  return useAssistantStore.getState();
}
