# My-Blog AI 系统接入开发计划 ——「问问小卿」

> 版本：v1.0 ｜ 日期：2026-09-09 ｜ 状态：待评审
> 目标：为站点接入 AI 助手「小卿」，实现 选中文本 → 右键菜单 → 悬浮对话 → 流式回答 → 多轮追问 → 可调整大小 的完整链路。

---

## 0. 结论先行

**一句话方案**：设置页新增 AI 配置分区（OpenAI 兼容协议，Key 存 DB 掩码回传），新增 `/api/ai/chat` 服务端 SSE 流式代理（Key 永不出服务端），BaseLayout 挂一个全站 React 岛 `AiChatFloat` 统一承载右键菜单 + 悬浮对话框（单例、fixed 定位、自绘边缘拖拽 resize），对话状态经 sessionStorage 在 ClientRouter 转场间保持。

**5 项功能 → 技术映射**：

| # | 功能 | 承载 | 核心技术 |
|---|------|------|---------|
| F1 | AI 设置模块 + 测试连接 | SettingsForm.astro 新分区 + `/api/ai/config` + `/api/ai/test` | settings KV（复用 image-bed 模式：掩码/留空保留/就绪判定） |
| F2 | 选中文本右键「问问小卿」 | AiChatFloat 岛内 document contextmenu 监听 | Selection API + 容器白名单（`.prose`、`#post-grid`）+ 自绘菜单 |
| F3 | 悬浮框弹出 + 自动发送 + 流式回答 | AiChatFloat 岛 | fetch + ReadableStream 消费 SSE，鼠标附近 clamp 定位 |
| F4 | 深入追问（多轮） | AiChatFloat 岛 | messages 数组累积 + 新发送时 abort 旧流（无需等回答完毕） |
| F5 | 拖拽边缘调整大小 | AiChatFloat 岛 | Pointer Events 自绘手柄（右/下/右下三向）+ 尺寸持久化 localStorage |

**里程碑**：M1 配置与代理（后端全绿）→ M2 选词交互与悬浮框 → M3 多轮与 resize → M4 打磨（转场恢复/限流/移动端/可选 Markdown 渲染）。预计 4 个可独立验收的交付段。

---

## 1. 市面方案调研

### 1.1 选中文本 AI 解释类产品（5 个开源方案，均为 Chrome 扩展形态）

| 方案 | 交互 | AI 接入 | 回答呈现 | 多轮 | 可借鉴点 |
|------|------|---------|---------|------|---------|
| **text-explainer** | 选中 → 右键菜单 Explain → popup | OpenRouter API，prompt 模板 `{text}` 占位 | 流式 popup | ✗ | prompt 模板占位符设计；Esc 关闭 |
| **genlookup** | 选中 → 右键 Lookup → 页面内 overlay | Ollama 本地 | overlay 弹层 | ✗ | 把选中文字 + 页面上下文一起发给 AI |
| **Luna** | 选中 → 右键 → **popup 定位在选区附近** | 多 provider | typing effect 流式 | ✗ | position-aware 定位容器（与本项目诉求一致） |
| **tellme** | 右键菜单两项（自定义问题/摘要）→ side panel | **FastAPI 后端代理 OpenAI**（Key 不进前端） | 流式 | ✅ side panel 多轮 | **服务端代理模式**；side panel 多轮对话结构 |
| **Explain This** | 选中 → 右键 → 本地推理 | WebLLM（WebGPU 浏览器内跑模型） | 流式 | ✗ | 不适用（浏览器推理太重，本项目走 API） |

### 1.2 流式回答技术实践（多篇生产级文章交叉验证）

| 结论 | 依据 |
|------|------|
| **SSE 而非 WebSocket**：LLM 输出是单向服务端→客户端文本流，SSE 走标准 HTTP/2、穿代理、无需握手协议，各大模型厂商（OpenAI/Anthropic/Google）原生 SSE 出流 | vife.ai 流式对比文章；dev.to SSE 指南 |
| **服务端代理而非前端直连**：Key 必须留在服务端；代理层顺带获得注入 system prompt、限流、日志、换模型不发版的能力 | RedLineSoft「Never call an LLM API directly from the browser」；tellme 的 FastAPI 代理 |
| **客户端用 fetch + ReadableStream 而非 EventSource**：EventSource 仅支持 GET、不能带 POST body 与自定义头；fetch + reader 逐块解析 `data:` 行、`\n\n` 分帧、处理跨块 JSON 截断 | RedLineSoft；dev.to（生产代码均此模式） |
| **重帧而非裸透传**：服务端解析上游 delta 后重组为自定义轻量 SSE 帧（`{delta}`/`{error}`/[DONE]），客户端逻辑最简，且上游协议变化不波及前端 | Froala 生产教程（translate instead of forwarding） |
| **必须支持中断**：AbortController 一路传到上游 fetch，「停止生成」是真取消而非仅停止显示 | Froala「cancels all the way back to the provider」 |

### 1.3 调研 → 本项目的取舍

- 扩展方案的**交互范式**（选中 → 右键 → 鼠标附近弹层 → 流式 → 追问）完整迁移到网页内嵌实现，交互形态与用户 5 项诉求逐条吻合。
- 扩展方案的**实现载体**（background script / contextMenus API / side panel）不适用——本项目是网页内自绘，需用 DOM contextmenu 事件 + 单例浮层替代。
- tellme 的**服务端代理**与 1.2 的 SSE 重帧结论直接采纳为本项目架构基线。

---

## 2. 技术选型（结合项目现状）

### 2.1 总体架构与数据流

```
┌─ 浏览器 ──────────────────────────────────────────────┐
│ AiChatFloat.tsx（React 岛，BaseLayout 挂载，client:idle）│
│  ├ document contextmenu 监听 → 白名单容器内选中 → 自绘菜单 │
│  ├ 悬浮对话框（单例 fixed）→ fetch('/api/ai/chat') POST   │
│  └ reader 解析 SSE 帧 → delta 追加渲染 / abort 中断        │
└──────────────┬────────────────────────────────────────┘
               │ POST {messages, pageCtx}（无 Key）
┌─ Vercel Node fn ─▼────────────────────────────────────┐
│ /api/ai/chat                                           │
│  ├ 读 DB ai_config（enabled/就绪/游客开关/限流）          │
│  ├ 组装 messages（systemPrompt 人设 + 选中文字上下文）     │
│  └ fetch 上游 stream:true → 解析 delta → 重帧 SSE 下发    │
└──────────────┬────────────────────────────────────────┘
               │ POST {baseUrl}/v1/chat/completions（Bearer Key）
        OpenAI 兼容上游（DeepSeek / GLM / Kimi / OpenRouter / Ollama …）
```

### 2.2 选型决策表

| # | 决策点 | 结论 | 理由 | 备选（未采纳原因） |
|---|--------|------|------|------------------|
| D1 | API 协议 | **OpenAI 兼容 `/v1/chat/completions`，`stream:true`** | 事实标准：DeepSeek/GLM/Kimi/OpenRouter/Ollama/硅基流动等全兼容，换服务商只改 baseUrl+model | 各厂商私有 SDK（绑定单一供应商） |
| D2 | 流式通道 | **SSE（服务端 Astro API route 返回 ReadableStream 透传重帧）** | Vercel Node runtime 原生支持流式响应；单向文本流 SSE 最轻 | WebSocket（过重）；轮询（体验差，调研已证伪） |
| D3 | Key 安全 | **Key 只存 DB settings 表；服务端代理；接口只回 `hasApiKey` 布尔** | 复用 image-bed 掩码模式（`serializeImageBedConfig`），前端零 Key 暴露 | 前端直连（Key 泄漏 + 无法限流） |
| D4 | 配置存储 | **settings 表 `ai_config` 键存 JSON**（enabled/baseUrl/apiKey/model/temperature/maxTokens/systemPrompt/allowGuests） | 复用 image-bed.ts 的 normalizeConfig PATCH 语义（留空=保留原值）与 upsert 写法；无需建新表 | 新建 ai_config 表（单对象配置，KV 足够） |
| D5 | 前端载体 | **单个 React 岛 `AiChatFloat` 挂 BaseLayout，右键菜单+悬浮框一体** | 菜单/浮窗共享选中文字与消息状态；全站一次挂载（BaseLayout 已挂 ManageDialog/RightToolbar，先例成立）；岛内 useEffect 注册全局监听，无需各页散落 script | 纯原生 script（多轮消息+流式+resize 状态管理复杂，React 更稳）；每页各挂岛（重复挂载） |
| D6 | 回答渲染 | **M1 流式期间纯文本（textContent 注入，安全零成本）；完成态 Markdown 渲染列为 M4 可选增强（marked + DOMPurify）** | 纯文本天然免 XSS；打字机流式感已达标；聊天场景 Markdown 增益有限，不阻塞主线 | 首版就上 Markdown（新增 2 依赖 + XSS 面增大，推迟到 M4 评审） |
| D7 | 使用者范围 | **默认全站访客可用 + 服务端限流；设置页提供 `allowGuests` 开关与每日全局上限，可一键收窄为仅管理员** | 「问问小卿」是站点功能，面向读者；但费用风险必须有闸门（限流 + 开关双保险） | 仅管理员（最保守，若用户确认只自用则删限流逻辑，实现更简） |
| D8 | 转场状态保持 | **消息列表持久化 sessionStorage，岛随 ClientRouter 重建时恢复** | ClientRouter swap body 会销毁重建岛（项目已知约定），内存态必丢 | 岛挂 body 外（Astro 不支持） |

### 2.3 复用项目既有约定（实现时勿违反）

| 约定 | 落点 |
|------|------|
| settings KV upsert + PATCH 语义 + 掩码序列化 | `src/lib/image-bed.ts` → `src/lib/ai-config.ts` 照此实现 |
| 「测试连接」API 先例（body 可选字段回落 DB 已存配置） | `src/pages/api/image-bed-test.ts` → `/api/ai/test` 照此实现 |
| API 内部鉴权 `isManagerSession(cookies)`，不动 middleware | `/api/ai/config`、`/api/ai/test` 用；`/api/ai/chat` 走自己的 enabled/游客判定 |
| API route 骨架 `prerender = false` + `json()` 助手 | 全部 3 个新 API |
| React 岛放置：功能域目录（`src/components/ai/`），client:idle 用于非首屏 | 参照 LikeButton/Comments |
| 列表容器白名单：文档/文章页 `.prose`、首页 `#post-grid` | F2 选区判定 |
| Edit 后 grep 复核、`pnpm exec astro check`、`.diag/*.mjs` playwright E2E（msedge channel） | 每里程碑验收 |

---

## 3. 详细设计

### 3.1 数据层：`src/lib/ai-config.ts`（新增）

```ts
export interface AiConfig {
  enabled: boolean;       // 总开关（false 时 /api/ai/chat 直接 403）
  baseUrl: string;        // 如 https://api.deepseek.com（服务端规范化拼 /v1/chat/completions）
  apiKey: string;         // 掩码存储，序列化只回 hasApiKey
  model: string;          // 如 deepseek-chat
  temperature: number;    // 默认 0.7，范围 [0,2]
  maxTokens: number;      // 默认 1024，上限 8192
  systemPrompt: string;   // 「小卿」人设，留空用内置默认
  allowGuests: boolean;   // 游客可用开关
  guestDailyLimit: number;// 游客每日全局次数上限（0 = 不限）
}
export type PublicAiConfig = Omit<AiConfig, 'apiKey'> & { hasApiKey: boolean };
```

- `getAiConfig()` / `saveAiConfig(patch)` / `serializeAiConfig()` / `isAiReady(c)`（enabled + baseUrl + apiKey + model 四项齐全），逻辑形态与 `image-bed.ts` 逐行对齐：`cleanText` 清洗、normalizeConfig PATCH（apiKey 留空=保留原值）、upsert `onConflictDoUpdate`。
- baseUrl 规范化：服务端拼接时 strip 尾部 `/` 与 `/v1`，统一拼 `{base}/v1/chat/completions`（兼容用户填 `https://api.x.com` 或 `https://api.x.com/v1` 两种习惯）。

### 3.2 API 层（3 个新端点，均 `prerender=false` + `json()`）

| 端点 | 方法 | 鉴权 | 请求 | 响应 |
|------|------|------|------|------|
| `/api/ai/config` | GET / PUT | `isManagerSession`（401） | PUT：Partial\<AiConfig\> | GET：`PublicAiConfig`；PUT：保存后回 Public 形态 |
| `/api/ai/test` | POST | `isManagerSession` | 可选 {baseUrl?, apiKey?, model?}，缺省回落 DB（表单留空=用已存 Key） | `{ok, message, latencyMs, model}`；实现=对上游发 1 条 `stream:false`、`max_tokens` 极小的 chat 请求，2xx 即通 |
| `/api/ai/chat` | POST | 内部判定：`enabled` → 站主/管理员直通；游客需 `allowGuests` + 当日限额未满 | `{messages: [{role:'user'|'assistant', content}], page?: {title}}` | SSE 流（见下）；校验失败/未启用/超限 → 常规 JSON 错误码 |

**`/api/ai/chat` 要点**：
1. 入参校验：messages ≤ 20 条、单条 content ≤ 4000 字符、role 白名单（防注入滥用与费用失控）。
2. 组装 messages：`[{role:'system', content: systemPrompt}]` + 前端传来的历史（服务端不再重复注入选中文字——选中文字在首条 user message 里由前端模板化）。
3. 上游 fetch `stream:true` + `AbortController`（客户端断开时 `request.signal` 联动 abort 上游，不白烧 token）。
4. **重帧下发**：读上游 body reader，解析 `choices[0].delta.content`，重新组帧：
   ```
   data: {"delta":"文本片段"}\n\n     # 逐段
   data: {"error":"上游错误信息"}\n\n  # 任意时刻出错
   data: {"done":true}\n\n            # 收尾（映射上游 [DONE]）
   ```
   响应头：`Content-Type: text/event-stream`、`Cache-Control: no-store`、`X-Accel-Buffering: no`。
5. **游客限流**（D7）：内存 `Map<ip, {day, count}>` 计每 IP 每日次数 + settings KV 记全局当日计数（冷启动重置可接受，注明局限；若后续要精确计费再升级）。

### 3.3 前端层：`src/components/ai/AiChatFloat.tsx`（新增 React 岛）

**挂载**：`BaseLayout.astro` 在 `<ManageDialog />` 旁挂 `<AiChatFloat client:idle />`（全站覆盖：首页文章列表、文档文章页、普通文章页统一生效；client:idle 符合「视口外抽屉用 idle」项目约定）。

**结构（单例三件套）**：

```
#ai-context-menu   右键菜单（单条「问问小卿」入口，z-index 最高层）
#ai-chat-float     悬浮对话框
  ├ 头部：标题「小卿」+ 选中文字摘录（line-clamp-2）+ 停止/清空/关闭按钮
  ├ 消息区（overflow-y-auto + overscroll-contain，不外溢滚动）
  ├ 流式光标动画（回答中）
  └ 输入区：textarea（Enter 发送 / Shift+Enter 换行）+ 发送按钮
```

**F2 选中文本右键菜单**：
- 岛内 `useEffect` 注册 `document.addEventListener('contextmenu', handler, true)`（捕获阶段，符合项目「拦截导航必须捕获阶段」的既有经验）。
- 触发条件：`window.getSelection()` 非空且选区 anchor/focus 落在白名单容器（`closest('.prose, #post-grid')`）内；否则放行浏览器原生菜单（不做全局劫持，尊重原生行为）。
- 菜单 `position:fixed` 定位在鼠标附近，视口 clamp：`min(x+8, vw - w - 8)`；记录 `mouseX/mouseY` 供 F3 弹窗定位；点击别处 / Esc / 滚动 → 关闭。

**F3 悬浮框弹出与自动发送**：
- 点击「问问小卿」→ 以鼠标坐标为锚点弹出悬浮框（同样 clamp），自动组装首条 user 消息（无需用户输入）：
  `请解释/分析以下我选中的内容（来自「${pageTitle}」）：\n"""${selection.slice(0, 2000)}"""\n`
- 立即 `POST /api/ai/chat` 流式渲染：`res.body.getReader()` + TextDecoder，按 `\n\n` 分帧、`data:` 前缀解析，缓冲区保留半帧防 JSON 跨块截断（调研结论 1.2）。
- 不遮挡原文：fixed 定位不占文档流、不随滚动引起 reflow；默认宽 380px 弹在鼠标侧下方，紧贴视口边缘时自动翻转到另一侧；浮窗内滚动 `overscroll-contain`，页面滚动/阅读不受影响。

**F4 多轮追问**：
- 岛内 `messages` state（`{role, content}[]`）持续累积，输入框随时可发（**不阻塞**：AI 回答中仍可输入）。
- 用户发送新问题时：若上一条流仍在进行 → `abortRef.current?.abort()`（保留已生成文本），再发起新请求——实现最简且语义正确（「无需等回答完毕」）。
- 「停止生成」按钮 = abort 当前流但保留已输出文本；「清空」= 重置 messages（重新以选中文字开场需重新选词）。
- 页面标题随消息附带（pageCtx），让小卿知道上下文出处。

**F5 可调整大小**：
- Pointer Events 自绘三向手柄：右边缘、下边缘、右下角（P0）；P1 扩展四角八向。
- `pointerdown` 捕获 → `pointermove` 更新 width/height，clamp `[320, vw-24] × [360, vh-24]`；`pointerup` 释放并写 localStorage（`ai_float_size`），下次打开恢复。
- 不用原生 CSS `resize:both`（样式不可控、与圆角阴影不搭、部分浏览器占位丑）。
- P1 可选：头部拖拽移动位置（用户未要求，留作加分项）。

**转场与状态**：
- 每次消息变更同步 `sessionStorage`（`ai_chat_messages` + 选中文字摘录）；ClientRouter 转场岛重建时恢复（`astro:page-load` 后 hydrate 读回）——解决 D8 状态丢失。
- 浮窗开着时转场：恢复后默认收起为关闭态（避免跨页面上下文错乱），消息记录保留，重新右键选词可继续追问历史。

### 3.4 设置页 F1：SettingsForm.astro 新增「AI 接入」分区

- 位置：现有 md-css 分区之后，结构与图床分区对齐。
- 控件：启用开关、API 地址、API Key（password 输入框，placeholder 提示「留空=不修改」，下方显示 `已配置/未配置` 状态）、模型名称、温度、maxTokens、系统提示词（textarea，placeholder 给默认人设）、游客开关 + 每日上限。
- 「测试连接」按钮：POST `/api/ai/test`（空 Key 字段自动用已存值），按钮态 loading → 成功显示 `✓ 连接成功 · {model} · {latency}ms`，失败显示上游报错摘要（如 401 Key 无效 / 404 模型不存在——baseUrl 拼错在此环节即可暴露）。
- 保存走 PUT `/api/ai/config`，成功后刷新 `hasApiKey` 状态展示。

---

## 4. 里程碑与验收

| 里程碑 | 交付 | 验收标准 |
|--------|------|---------|
| **M1 配置与代理**（后端全绿） | ai-config.ts、3 个 API、SettingsForm AI 分区 | astro check 通过；dev 手测：保存配置（留空 Key 不清空）、测试连接成功/失败两态；curl 直打 `/api/ai/chat` 看到 SSE 帧流式输出；未配置时 403；游客限流生效 |
| **M2 选词交互与悬浮框** | AiChatFloat 岛（F2+F3）挂 BaseLayout | E2E：`.prose` 内选中→右键出菜单→点击→浮窗弹出→流式回答完整渲染；白名单外右键不出菜单；Esc/点外关闭；浮窗不遮选区、页面可正常滚动 |
| **M3 多轮与 resize** | F4+F5 | E2E：回答中输入追问→新流启动旧流终止；多轮上下文正确（第 2 问能引用第 1 答）；拖拽右/下/右下改尺寸且 clamp 生效；刷新尺寸恢复 |
| **M4 打磨** | 转场恢复、移动端 fallback、限流复核、（可选）Markdown 渲染 | ClientRouter 转场后消息记录保留；触屏长按选词出浮动按钮（P1）；生产 byqx-blog.online 冒烟通过；M4 评审决定是否上 marked+DOMPurify |

每个里程碑固定流程：`pnpm exec astro check` → dev 手测 → `.diag/ai-e2e.mjs`（playwright msedge 无头）→ Conventional Commits 提交 → push 自动部署 → 生产验证。

## 5. 风险与对策

| 级别 | 风险 | 对策 |
|------|------|------|
| P1 | Vercel 函数流式响应在某些边缘情况被缓冲 | 已带 `X-Accel-Buffering: no`；生产实测验证；兜底：chat API 支持 `stream:false` 参数降级为整段返回 |
| P1 | API Key 被恶意消耗（游客模式） | allowGuests 默认关、每日全局上限、每 IP 限流、单条/总会话长度硬校验；站长可随时关闭 |
| P2 | 上游兼容性差异（个别网关 SSE 帧格式非标准） | 服务端重帧隔离了协议差异；「测试连接」让问题在配置阶段即暴露 |
| P2 | 移动端 contextmenu 支持不一（iOS 长按不触发） | P1 方案：触屏设备改为选区浮动小按钮（mouseup 后检测选区显示），桌面端仍走右键 |
| P2 | ClientRouter 转场岛重建丢状态 | sessionStorage 恢复（D8）；E2E 覆盖转场场景 |
| P2 | system prompt 注入（选中文字含指令性内容） | 选中文字包在 `"""` 引用块内并长度截断；temperature 默认 0.7；个人博客威胁模型可接受 |

## 6. 范围外（本期不做）

聊天记录永久存储（仅 sessionStorage 会话级）、语音/图片多模态输入、账号体系打通、思维导图/文档系统深度集成（如「对整篇文章提问」按钮，留作二期）、RAG 站内知识库检索。

---

## 附：新增/修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/ai-config.ts` | 新增 | settings KV 读写 + 掩码序列化 + 就绪判定 |
| `src/pages/api/ai/config.ts` | 新增 | GET/PUT 配置（isManagerSession） |
| `src/pages/api/ai/test.ts` | 新增 | 测试连接（回落 DB 配置） |
| `src/pages/api/ai/chat.ts` | 新增 | SSE 流式代理 + 重帧 + 限流 |
| `src/components/ai/AiChatFloat.tsx` | 新增 | 右键菜单 + 悬浮对话框一体岛 |
| `src/components/admin/SettingsForm.astro` | 修改 | 新增 AI 接入分区（表单 + 测试连接按钮） |
| `src/layouts/BaseLayout.astro` | 修改 | 挂载 `<AiChatFloat client:idle />` |
| `.diag/ai-e2e.mjs` | 新增 | 里程碑 E2E 脚本 |
| `tests/ai-config.test.ts`（可选） | 新增 | normalizeConfig PATCH 语义单测（vitest，tests/** 约定） |
