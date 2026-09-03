# 文档「就地编辑」Tiptap 迁移 · 实施计划

> 状态：**已落地 ✅**（commit `0dbe55d`，master 已 push，vercel 生产 Ready）｜日期：2026-09-03｜适用范围：`DocInlineEditor`（文档详情页就地编辑）｜不触及：写作台 / 日记 / 服务端渲染 / 评论 / 导图
> 关键技术结论（已联网核实到 2026-09 版本现状）：Tiptap **v3.2x** 活跃迭代；官方 `@tiptap/markdown`（MarkedJS 内核）已支持表格/GFM/自定义 tokenizer；官方 `@tiptap/extension-mathematics`（KaTeX、inline+block 节点、`latex` 属性存储）；React 19 官方支持。

---

## 0. 背景与目标

### 0.1 现有实现的局限（为什么必须换）
- 正文以 **MDX 源码** 为唯一真相存储，阅读时服务端 `renderMdx` 渲染为 HTML。
- CodeMirror 6（Obsidian 同架构）是**源码层编辑器**：编辑对象是 markdown 字符流，靠 decoration 把语法"伪装"成渲染态。因此：
  - 表格 / `:::note` 笔记 / 复杂公式在编辑态**必然回退为源码或不可见**（已由用户截图证实）；
  - "页面外观完全不变 + 内容始终渲染可见 + 点哪改哪" 在该架构下**不可达成**（Obsidian 亦同）。
- 结论：迁移到 **ProseMirror/Tiptap 富文本内核**（编辑对象即渲染对象）。

### 0.2 目标
1. 点击「编辑」后页面外观不变、无编辑框感；公式 / 表格 / `:::note` / 代码块始终以渲染形态可见。
2. 鼠标可点击任意段落、公式、笔记等位置，就地编辑。
3. 再次点击「编辑」= 保存并退出，`PATCH content` 链路与缓存失效机制保持原样。
4. 读写两侧均以 **markdown 字符串** 为边界，服务端渲染管线零改动。

---

## 1. 技术选型（2026-09 核实）

| 依赖 | 用途 | 版本基准 | 备注 |
|---|---|---|---|
| `@tiptap/react` | React 绑定 | v3.2x | React 19 官方支持（v2.10 起） |
| `@tiptap/core` / `@tiptap/pm` | 内核 | v3.2x | `pm` 需显式安装（peer） |
| `@tiptap/starter-kit` | 基础节点（段落/标题/列表/引用/代码块/分割线等） | v3.2x | v3 内含 Link、TrailingNode |
| `@tiptap/markdown` | markdown ⇄ 文档 双向转换 | v3.2x（最新） | MarkedJS 内核；early release；v3.22 已修 HTML 实体/空行 bug，**务必用最新** |
| `@tiptap/extension-mathematics` | 公式：`inlineMath` + `blockMath` 节点 | v3.2x | KaTeX 渲染，`latex` 属性存源码，`onClick` 可弹编辑；提供 `migrateMathStrings` |
| `@tiptap/extension-table` + row/cell/header | 表格 | v3.2x | v3.22+ markdown 表格对齐支持；推荐 `TableKit` 聚合包 |
| `@tiptap/extension-task-list` / task-item | 任务列表 | v3.2x | StarterKit 未含，需单装 |
| `katex` | 公式排版 | 已有（^0.16） | 样式已在全局引入，编辑器内复用 |
| `marked` | @tiptap/markdown 内建解析器 | 传递依赖 | 无需直引 |

> 不引入：TipTap 收费模块、`@tiptap/extension-code-block-lowlight`（现有 prism 高亮在服务端完成，编辑态代码块用普通 codeBlock + CSS 即可，避免再引入低亮依赖——若后续需要可单列）。

### 1.1 为什么「编辑态也走 Tiptap 渲染」而不是「直接编辑服务端 HTML」
- 服务端 HTML 是"只读产物"（KaTeX HTML、para-N 锚点、prism 结构均非可编辑模型）；把渲染 HTML 反向喂给富文本编辑器会丢失可编辑语义，且 `:::note`/公式已塌缩为 `<div>/<span>` 无法还原源码。
- 正确方向：**编辑态用 markdown 源码 → Tiptap（客户端解析即渲染）**，与阅读态共用同一份 markdown，双向以源码字符串为契约。见 2.2 数据流。

---

## 2. 架构设计

### 2.1 模块划分（低耦合、高内聚）

```
src/components/doc/tiptap/              # 新增：就地编辑专属（高内聚，不污染 admin）
├── DocTiptapEditor.tsx                 # 受控编辑岛：props { initialMarkdown, onChange(md), onDone(), onCancel() }
│                                        # 内部：useEditor + Markdown 绑定；不做任何网络/保存逻辑（单一职责）
├── extensions/
│   ├── index.ts                        # 统一导出扩展组合 buildDocExtensions()
│   ├── admonition.ts                   # :::note/:::warning/... 容器节点 + markdownTokenizer + parseMarkdown/renderMarkdown
│   └── math-serialize.ts               # 公式 round-trip 加固（如需要，见 §4.3）
└── __tests__/
    └── markdown-roundtrip.test.ts      # 保真矩阵（见 §3 P2）
```

```
src/components/doc/DocInlineEditor.tsx  # 改造（现状组件）
│  职责保持不变：悬浮/标题按钮桥接、fetch 源码、防抖 PATCH、updatedAt 回写、关闭补拉 render、data-editing 守卫
│  └── 渲染部分由 <MarkdownEditor ghost> 替换为 <DocTiptapEditor>
```

- **DocTiptapEditor 与 DocInlineEditor 解耦**：前者纯 UI/编辑（props 进 markdown、出 markdown），后者管网络/生命周期。可单测、可复用。
- **不新增"编辑器管理器"全局层**：一次只服务一个文档，无需多余抽象。

### 2.2 数据流（唯一真相仍是 markdown 源码）

```
阅读态：DB(markdown) ──renderMdx──▶ 服务端 HTML  ◀──（游客/未编辑时唯一路径）
编辑态：DB(markdown) ──GET /api/doc/nodes/:id──▶ DocTiptapEditor
        │  setContent(md, {contentType:'markdown'})  → ProseMirror doc（公式=inlineMath/blockMath 节点、:::note=admonition 节点…）
        │  onUpdate: editor.getMarkdown()  → 受控 onChange(md)
        ▼
DocInlineEditor：1.5s 防抖 → PATCH { content: md }（与现状完全一致）
        → updatedAt 回写 #doc-detail-data（CDN 版本失效，不变）
        → 关闭后后台补拉 /render 刷新正文与 TOC（不变）
```

> 关键不变式：**任何一次编辑的产物仍是可被 `renderMdx` 接受的 markdown**。P1/P2 的测试矩阵就是这条不变式的守门人。

### 2.3 视觉无框化
- Tiptap 内容容器套用项目现有 **`.prose`** 排版类（已在 global.css 定义，含 KaTeX 规则），保证编辑态排版 ≈ 阅读态。
- 编辑器 host 无边框/无工具条；工具能力收敛到：标题按钮「编辑⇄完成」 + 右下小胶囊（沿用现状交互，仅换内核）。
- 大文档高度策略沿用现状：短文贴合原文高；超长文视口高内滚动。

---

## 3. 分阶段实施步骤

### P0 依赖与最小验证（0.5 天）
- [ ] `pnpm add` 上述 Tiptap v3 包（记录精确版本锁入 lockfile）。
- [ ] 临时 page 或现有 doc 页注入最小 `<DocTiptapEditor>`：验证
  1) Astro SSR + `client:idle` 下水合无 `hydration mismatch`（须 `useEditor({ immediatelyRender: false })`）；
  2) `setContent('# hi\n\n$$x^2$$', { contentType: 'markdown' })` 后 `getMarkdown()` round-trip 一致；
  3) KaTeX 样式在编辑器内生效。
- 退出条件：三项全过，产出依赖版本清单写入本文档附录。

### P1 markdown round-trip 保真矩阵（1 天，**成败关键，先行**）
用 vitest（node 环境 + 现有测试基建）建 `markdown-roundtrip.test.ts`，覆盖真实文档语料：
- 标题 1–6 级 / 粗斜体 / 删除线 / 行内码 / 链接（含 title）/ 图片
- 无序 / 有序 / 嵌套列表；任务列表 `- [ ]`
- 代码围栏（含语言标记、含 `$`/`:::` 字面内容）
- **公式**：行内 `$…$`；块级 `$$…$$`（跨行）；表格 cell 内 `$…$`
- **Admonition 容器**：`:::note` / `:::tip` / `:::warning` / `:::danger` / `:::info`（含嵌套块与行内格式）
- **GFM 表格**（对齐、空 cell）
- 特殊转义：`\$`、`\{`、`\|`、反引号变体
- **幂等性**：parse→serialize→parse→serialize 第二次不再漂移
- 与 `renderMdx` 渲染等价性抽查：随机 N 段语料 serialize 后走服务端 `renderMdx`，断言不抛错、`katex-error` 为零
- 退出条件：矩阵全绿；不绿项记录为已知差异（白名单）并写清降级行为。

### P2 DocInlineEditor 换核（1 天）
- [ ] DocTiptapEditor 完成（含 admonition 扩展、公式扩展配置、.prose 容器）。
- [ ] DocInlineEditor 的编辑器区由 `<MarkdownEditor ghost>` 切为 `<DocTiptapEditor>`；保留 fetch/防抖 PATCH/updatedAt/补拉 render/data-editing 全部逻辑（这部分代码零改动）。
- [ ] 本地 E2E 重跑既有就地编辑链路（dev + msedge）：打开 → 公式/表格/笔记可见 → 点击段落输入 → 自动保存 → 完成退出 → DB content 更新且经 `renderMdx` 渲染正常。

### P3 视觉与交互打磨（0.5 天）
- [ ] 进入编辑的"零跳变"：短文贴合原文高；长文视口内滚动（复用现状策略，微调 ghost→prose 容器的间距）。
- [ ] 光标进入公式/表格/笔记的行为定义：默认公式节点 `onClick` 弹最小源码编辑（`updateInlineMath/updateBlockMath`）；表格按 ProseMirror 原生 cell 导航；`: 笔记内部按块编辑。
- [ ] 主题联动（暗色/亮色）与字体变量对齐 `.prose`。
- [ ] 关键处补注释；`astro check` 0 errors。

### P4 回归与部署（0.5 天）
- [ ] `astro check`；既有写作台/日记编辑器**不改一行**，人工回归截图留存。
- [ ] 生产 doc 全库渲染复扫（沿用 prod-scan 脚本）确认服务端零回归。
- [ ] 提交 + push + `vercel deploy --prod`；生产冒烟（doc 详情 200、正文渲染）。
- [ ] 全量 E2E（含悬浮按钮、完成/放弃、自动保存、缓存失效「改了别不变」回归）。

---

## 4. 预期问题与解决方案

### 4.1 hydration / SSR
- **现象**：Astro 岛 SSR 输出与客户端水合不一致，编辑器空白或闪烁。
- **方案**：`useEditor({ immediatelyRender: false })`（Tiptap 官方 SSR 要求）；编辑器内容在 `client` mount 后再 `setContent`。绝不在 `.astro` 里序列化 ProseMirror doc。

### 4.2 `@tiptap/markdown` 为 early release，round-trip 有边角
- **现象**：个别语法 parse→serialize 漂移（早期版本有 HTML 实体、块后空行丢失，已在 v3.22 修复）。
- **方案**：① 锁定并使用**最新** v3.2x；② P1 保真矩阵守住幂等性；③ 白名单化残余差异并在保存侧做**规范化补偿**（如统一空行、转义归一），确保写入 DB 的内容与原始语料仅存在"可接受的等价变化"。

### 4.3 公式 round-trip 与「编辑前内容已被服务端规整过」的错位
- **现象**：服务端渲染前 `mdx.ts` 的 `normalizeMathFences`/`tableLineToSafe` 会改写源码（拆 `$$`、表格 `|`→`\vert`、转义 `{}`）。编辑器拿到的是 **DB 原始源码**，两套规整若不一致会漂移。
- **方案**：
  - 编辑器读/写始终对 **DB 原始字符串**，服务端规整只在渲染前做 → 编辑器不做任何服务端规整的镜像（单一职责）。
  - 表格 cell 内 `$…$`：P1 矩阵单测确认 Tiptap/Marked 对 GFM 表格内公式的识别；若 Marked 不支持 cell 内 `$…$` 数学节点，则**降级策略**：cell 内公式按普通文本保留 `$`（阅读态仍由现有服务端管线负责美化），并把该差异记入已知清单——不得为编辑器妥协去改 `mdx.ts`。

### 4.4 `:::note` 指令（Admonition）
- **方案**：完全参照 Tiptap 官方「Create an Admonition Block with Markdown Support」三步实现：节点 + `markdownTokenizer`（识别 `:::\w+ … :::`）+ `renderMarkdown`（还原 `:::type`）。Admonition 内部按块级内容递归（`content: 'block+'`、`lexer.blockTokens`）。
- **对齐点**：服务端为 `remark-directive` 五类 `note/tip/warning/danger/info`；客户端 admonition 节点 `type` 属性限定同集合，两侧语义一致。

### 4.5 表格
- **现象**：Tiptap 表格为 ProseMirror grid 模型，而 markdown 表格是 pipe 语法；官方限制"cell 仅单子节点"。
- **方案**：直接用官方 table 扩展 + `@tiptap/markdown` 的 GFM 表格支持；P1 矩阵验证嵌套/空 cell/对齐。若 cell 内需要多个块（如列表），记录限制并引导用户避免（与服务端 GFM 一致的能力边界）。

### 4.6 大文档性能
- **现象**：243KB 级文档全量载入 ProseMirror。
- **方案**：编辑态载入仅在**点编辑后**发生（岛 `client:idle` 不预载）；实测首载耗时（P0 验证项）；若超阈值，先接受（编辑器内滚动为常态），后续再评估节点惰性化——不提前优化。

### 4.7 para-N 锚点漂移（既有固有行为，非本次引入）
- **现象**：思维导图引用基于渲染 HTML 的 `para-N`（按 DOM 顺序编号）。任何编辑器改动段落结构都会重编号。
- **方案**：不做兼容 hack（不应把 `para-N` 写进源码/节点属性）。在交付说明中向用户明示：**引用在"删/插段落"后需在导图侧复查**。此与 CM 时代完全等价。

### 4.8 与既有 CM 编辑器体系并存
- 写作台（LiveEditor）、日记（DiaryEditor）**继续使用 CodeMirror**；`MarkdownEditor`/`cm-*`/`md-keymap` 保持原样，不删除、不双写。
- 边界纪律：新 Tiptap 代码只在 `src/components/doc/tiptap/` 与 `DocInlineEditor.tsx` 出现；`MarkdownEditor` 的 `ghost` 变体不再被 doc 引用（保留实现防回归，标注 deprecated 注释）。

---

## 5. 影响范围评估

### 5.1 影响面
| 子系统 / 文件 | 影响 | 说明 |
|---|---|---|
| `src/components/doc/DocInlineEditor.tsx` | **改造** | 仅替换编辑器渲染块；网络/状态逻辑零改动 |
| `src/components/doc/tiptap/*`（新） | 新增 | 见 2.1 |
| `RightToolbar.astro` / `doc/[id].astro` 按钮 | 无 | 桥接契约 `open/saveAndClose` 不变 |
| 服务端 `mdx.ts` / `mdx-plugins.ts` / KaTeX / TOC / para-N | **零改动** | 编辑器只产出 markdown 源码 |
| `MarkdownEditor.tsx` / `cm-wysiwyg` / `cm-live-preview` / `md-keymap` | 零改动（保留） | 供写作台/日记继续使用 |
| 写作台 / 日记 / 评论 / 点赞 / 图片 / 思维导图 | 零影响 | 未触及 |
| 数据存储（DB content 字段） | 格式不变 | 仍是 MDX/markdown 字符串 |

### 5.2 净改动规模估算
新增约 5–8 个文件（含测试）、改造 1 个文件；删除 0 个既有功能文件。前端主 bundle 增大约 200–400KB（Tiptap+PM+Marked），**仅在点开编辑器时经动态 import 加载**，阅读页不受影响。

### 5.3 适用范围界定
| 编辑器功能场景 | 适用本方案？ |
|---|---|
| 文档详情页**就地编辑**（目标场景） | ✅ 完全适用 |
| 文档 **node 弹窗内正文 textarea+预览**（doc-node-dialog） | 不适用（保持轻量 textarea，勿引入 Tiptap） |
| 博客文章写作台（独立页三栏布局） | 不适用（保持 CM；如需未来迁移，本文架构可平移，但需独立立项） |
| 日记编辑器 | 不适用（保持 CM） |
| 评论区富文本 | 不适用 |

---

## 6. 代码规范与实现纪律（团队约定）
- **分层纪律**：`DocTiptapEditor` 不出现 `fetch`/`setTimeout` 保存/`document.querySelector`；一切副作用留在 `DocInlineEditor`。
- **受控组件**：props 进出均为 markdown 字符串；编辑器内部 ProseMirror doc 不跨组件传递，杜绝 JSON 双源。
- **命名**：新模块沿用 `DocTiptapEditor`/`DocTiptapView`（如拆分）前缀；扩展名小写语义化（`admonition`）。
- **注释**：文件头注释说明职责/数据流/为何选 Tiptap；扩展文件注释 markdown round-trip 的方向与已知白名单。
- **测试**：round-trip 为纯函数测试，放 `src/components/doc/tiptap/__tests__/`，走既有 vitest 配置（node 环境，不需要 DOM 的用例不引入 jsdom）。
- **不做**：不引入全局状态库；不 copy-paste `@tiptap/markdown` 内部；不降级 React 版本。

---

## 附录 A：P0 后回填（实测）

**锁定依赖版本（package.json 直接添加的统一版本）**：

| 包 | 版本 |
|---|---|
| `@tiptap/core` | 3.31.0 |
| `@tiptap/react` | 3.31.0 |
| `@tiptap/pm` | 3.31.0 |
| `@tiptap/starter-kit` | 3.31.0 |
| `@tiptap/markdown` | 3.31.0 |
| `@tiptap/extension-mathematics` | 3.31.0 |
| `@tiptap/extension-table`（聚合 TableKit） | 3.31.0 |
| `@tiptap/extension-task-list` | 3.31.0 |
| `@tiptap/extension-task-item` | 3.31.0 |
| `katex`（沿用既有 ^0.18.5） | — |

**首载性能实测（dev 4324 + msedge）**：
- 客户端点编辑 → `setContent(md, contentType:'markdown')` 后约 60ms 内 ProseMirror 就绪可 focus
- 文档规模 < 25KB 的常规讲义首载 DOM mount 即时，无可感知延迟
- KaTeX widget 在 onUpdate 后渲染（包含渲染延迟，但与 ghost-CM 时代同量级）
- 浏览器端冷启动 chunk：`@tiptap/markdown` (含 marked) 通过 doc 岛 `client:idle` 懒加载，无首屏阻塞

## 附录 B：已知差异白名单（P1 实测回填）

| 语法 | 差异描述 | 降级/接受理由 |
|---|---|---|
| 同行 `$$x^2$$` | 解析为独立 fence `$$\nx^2\n$$` | **与服务端 `mdx.ts` `normalizeMathFences` 行为一致**，下次渲染仍正确。**安全等价差异**（serialize 后立即 normalize 再次拆开，二阶幂等） |
| GFM 表格单元格对齐 padding | `\| a \| b \|` → serialize 输出 `\| a  \| b    \|` | 视觉等价；renderMdx 端 GFM 解析后视图一致 |
| 反引号变体 | `U+FF40/02CB/2035` | serialize 后保留为 ASCII `` ` ``；与 `normalizeBackticks` 对齐，**安全等价** |
| 表格 cell 多子节点 | `:::note` / `[\`code\`]` 等不能直接作 cell 唯一内容（MarkedJS 限制） | 已知限制；项目表格 cell 当前承载行内公式 + 文本，已能 round-trip；写入前用户须知此边界 |
| Tiptap v3.31 Mathematics 块级公式 `displayMode` | 不消费 `blockOptions.displayMode`（上游未实现），块级公式默认 inline 渲染 | **已用 CSS 兜底**（`.tiptap-mathematics-render[data-type='block-math'] { display:block; text-align:center; padding:.5em 0 }`），视觉与 katex-display 等价 |
| Markdown 扩展 v3.31 | 官方标记 "early release" | 锁定最新 3.31，已修 v3.22 的 HTML 实体/空行丢失 bug；P1 矩阵守门员

**关键踩坑（避免后人重复）**：
1. `@tiptap/markdown` 的 `parseMarkdown` / `renderMarkdown` 回调里 `this` 是 spec 而非扩展实例 —— `this.name`/`this.options` 都是 `undefined`，导致节点 type 字段丢失 → 序列化空字符串。**必须用模块级 `const` + 字面量引用**（见 `extensions/admonition.ts`）。
2. `MarkdownManager` 构造无需 Editor/DOM（核心利好），可纯 node 跑 round-trip 测试 —— P1 保真矩阵不引入 jsdom。

## 附录 C：落地清单（最终）

| 阶段 | 交付物 | 验证 |
|---|---|---|
| P0 | 依赖装好 | `pnpm exec` 9 包同版本 3.31.0 |
| P1 | `src/components/doc/tiptap/__tests__/markdown-roundtrip.test.ts` | vitest 9/9 全绿 + `.diag/full-src/` 真实语料 STABLE 4/4、katex-error 0/4 |
| P2 | `DocTiptapEditor` + `Admonition` 扩展 + `DocInlineEditor` 换核 | msedge E2E：ProseMirror 挂载 / admonition(note) / 表格 + cell 公式 / checkbox / 自动保存 / 完成退出 / 零控制台错误 |
| P3 | `global.css` blockMath displayMode 视觉补全 | E2E 截图确认块级公式视觉成块、居中 |
| P4 | 提交 / push / deploy | `astro check` 0 errors · `vitest` 30/30 · `git push` ok · `vercel deploy --prod` Ready（1m 构建）|
