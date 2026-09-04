# 文档编辑模式：右侧目录点击跳转定位 —— 技术分析与设计方案

> 需求：编辑模式下（就地 CodeMirror 编辑器替换正文中），点击页面右侧悬浮目录面板中的标题项，
> 编辑器滚动/定位到对应内容位置。
> 本文为设计分析（对应 2026-09 会话），尚未实施；实施时按「§7 实施路线」执行。

---

## 1. 需求与现状盘点

### 1.1 阅读模式的跳转机制（现状）

- TOC 数据源：服务端 MDX 管线 `extractToc`（remarkMath + rehypeKatex + rehypeSlug）产出
  `TocItem[] { id, text, level, html }`，`id` 为 rehype-slug（github-slugger 算法）生成的标题 slug。
- 渲染：共享模块 `src/lib/toc-tree.ts` 的 `renderTocTreeHtml`（树形 + 折叠箭头），
  目录项为 `<a class="toc-item toc-l{level}" data-doc-anchor href="#{slug}">`，SSR 与客户端切文共用同一实现。
- 跳转机制：**纯原生锚点**——浏览器 hash 导航直接滚动到渲染 HTML 中的 `h2/h3/h4#slug` 元素。
  页面脚本中没有针对 `data-doc-anchor` 的自定义点击处理，也没有 active 高亮跟踪。

### 1.2 编辑模式带来的三个本质差异

| 差异 | 阅读模式 | 编辑模式 |
| --- | --- | --- |
| 文档载体 | 渲染后的 DOM（`article.prose` 内含 `#slug` 锚点元素） | CodeMirror 6 中的 **Markdown 源码文本**（正文 DOM 已 `display:none`） |
| 跳转目标 | DOM 元素（`getElementById` / hash 滚动） | CM 文档中的**行/offset**（`state.doc.line(n)`） |
| 滚动模型 | 页面级滚动 | **双模式**：短文 = 编辑器高 ≈ 正文高、页面级滚动（内容全可见，无需滚动）；长文 = 编辑器固定一屏高，**编辑器内部滚动**（`.cm-scroller`） |

另有一个项目特有约束：页面启用了 Astro `ClientRouter`（SPA 路由），其在 **document 冒泡阶段**监听 `<a>`
点击并先于页面底部脚本执行。TOC 链接是 `href="#slug"` 的 hash 链接——编辑模式下若不拦截，点击行为
将落入 ClientRouter / 浏览器原生 hash 逻辑（而正文锚点元素已随正文隐藏，无法滚到）。
项目已有既定约定：**想拦截链接导航必须在捕获阶段 `preventDefault`**（doc.astro ClientRouter 交互约定）。

### 1.3 已有的可复用资产

- `MarkdownEditorHandle.jumpToLine(line)`（`src/components/admin/MarkdownEditor.tsx`）：
  已实现「0 起行号 → 光标定位 + `EditorView.scrollIntoView(pos, { y: 'center' })` + focus」，
  是本需求的天然落点（写作台侧栏早已按此设计）。
- `window.__docInlineEditor` 桥（`DocInlineEditor.tsx`）：页面脚本 ↔ React 岛的既有通道
  （现为 `open` / `saveAndClose`），加一个方法即可，无需新通道。
- `cm-wysiwyg.ts` Pass 3 用正则识别标题行（`/^(\s*)(#{1,6})\s+(.*)$/`）；
  但编辑器同时挂载 `@codemirror/lang-markdown`，可改用 **Lezer 语法树**做更准确的标题识别（见 §3.2）。

---

## 2. 技术栈总览（分层）

| 层 | 技术 | 用途 | 现状 |
| --- | --- | --- | --- |
| 编辑器内核 | CodeMirror 6（`@codemirror/state` / `view` / `language`） | 文档模型、行定位、滚动 API、视口跟踪 | 已引入 |
| 标题识别 | `@codemirror/lang-markdown` 的 Lezer 语法树（`syntaxTree` + `iterate`） | 从源码准确枚举标题（排除代码块内 `#`、支持 setext） | 已引入，未使用语法树 |
| 滚动定位 | `EditorView.scrollIntoView(pos, { y: 'center' })` | 虚拟化渲染下按文档位置滚动（rAF 内精确测量） | 已用于 `jumpToLine` |
| TOC 数据 | `#doc-toc-list` 现有 DOM（`.toc-item` 的 class/文本/同名序号） | 编辑打开时快照目录，免新增请求 | 已存在 |
| 事件桥接 | `doc/[id].astro` 捕获阶段事件委托 + `window.__docInlineEditor` | TOC 点击 → 编辑器岛 | 桥已有，拦截待加 |
| 高亮联动 | CM `updateListener`（viewport/geometry 变化）+ TOC class 切换 | 反向：滚动 → 当前标题高亮（增强项） | 全新 |

> 对照参考（Tiptap/ProseMirror，本项目已回退不用，仅作技术对照）：
> PM 是真实 DOM 渲染树，标题节点自带 DOM，跳转 = `editor.view.dom.querySelector('#slug').scrollIntoView()`
> 或 `TextSelection.near(doc.resolve(pos))` + `scrollIntoView` 命令，锚点天然存在、无需「slug→行号」映射；
> 但代价是引入整套 PM 依赖与 Markdown 序列化往返（本项目已验证此路线交互不符预期）。
> CM 方案的全部额外复杂度集中在一步：**把目录项映射到源码行**（§3.2），其余环节两者成本相当。

---

## 3. 核心设计

### 3.1 TOC 数据获取：编辑打开时快照现有 DOM，免请求

编辑模式下目录面板内容在进入编辑前后不变化（仍是服务端渲染的旧目录），**M1 直接复用它**：

- `DocInlineEditor.openEditor()` 成功挂载后，遍历 `#doc-toc-list .toc-item`，
  读取 `{ level: class 中的 toc-l2/3/4, text }`，按 DOM 顺序存为快照
  `tocSnapshot: { level: number; text: string }[]`。
- 文本清洗：`item.html` 可能含 KaTeX 富文本，`textContent` 会把 `.katex-mathml`（MathML 可达性副本）
  里的源码重复计入。清洗方式：克隆节点 → 移除 `.katex-mathml` → 再取 `textContent`。

为什么不用「重新拉 `/render` 的 toc 字段」：该接口主产物是整篇渲染 HTML（大文档数百 KB），
为目录付这个成本不值；也不用「服务端把 `TocItem[]` 注入 data 属性」：需要同步改 SSR、切文脚本、
`refreshRendered` 三处，收益仅是免去一次 DOM 清洗。DOM 快照是最小改动路径。

### 3.2 锚点定位（核心难点）：推荐「序列对齐」，slug 匹配作校验

编辑器里没有 slug，目录项只有 `{ level, text }`。三条可选映射路线：

**路线 A：slug 反算匹配（直觉方案，不推荐做主键）**
扫描源码标题文本 → 用 github-slugger 同款算法算 slug → 与 `href="#slug"` 对齐。
问题：slug 算法细节多（标点删除、重名 `-1` 后缀、中文保留、数学标题被删得只剩残片），
`text`（LaTeX 源码形态）与渲染文本也不完全一致，任何一条不一致即匹配失败，脆弱。

**路线 B：文本匹配**（`norm(text)` 全等 / 前缀模糊）：比 slug 稳，但数学标题、
`{#custom-id}` 属性、不可见字符仍可能对不上，且重名标题需要出现序号辅助消歧。

**路线 C：序列对齐（推荐主键）** —— 关键洞察：
> **TOC 的顺序 = 渲染管线提取的标题序列；语法树扫描源码得到的标题序列 = 同一篇文档的标题序列。
> 两侧按「level 分组后各自是第 N 个」一一对应，根本不需要文本或 slug 参与。**

例如目录中「第 2 个 level=3 的标题」必然对应源码里「第 2 个 `###` 标题」。
它对以下情况全部免疫：重复标题、数学/特殊字符标题、中文 slug 差异、emoji。
`text` 匹配降级为**一致性校验**（对不上时 `console.warn` 并仍按序列对齐跳转）。

前提是源码标题枚举必须与渲染管线一致，因此用 **Lezer 语法树**而非正则：

```ts
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

interface HeadingHit { pos: number; level: number; text: string }

function scanHeadings(state: EditorState): HeadingHit[] {
  const out: HeadingHit[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const m = /^(?:ATXHeading(\d)|SetextHeading(\d))/.exec(node.name);
      if (!m) return;
      const level = Number(m[1] ?? m[2]);
      const text = state.sliceDoc(node.from, node.to)
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/, '').replace(/[ \t]+#+$/, '').trim();
      out.push({ pos: node.from, level, text });
    },
  });
  return out;
}
```

语法树法天然获得：代码块/行内代码里的 `#` 不会产生 `ATXHeading*` 节点（正则法会误判）；
setext 标题（下划线式 `===/---`）免费支持；`pos` 直接是文档 offset，无需再换算行号。

**每次点击时实时扫描**，不缓存索引：CM 语法树增量解析，扫描一遍几百 KB 文档是亚毫秒级；
不缓存就彻底免掉「编辑期间标题增删导致索引失效」的一致性维护。若未来 profiling 显示有必要，
再加 `docChanged` 失效重建，M1 不做。

### 3.3 滚动联动：`scrollIntoView` 是唯一可靠姿势（已验证）

CM6 视口是虚拟化的：未渲染区域的行高是估算值，块级 widget（本项目 KaTeX display 块、
代码块高亮）会让估算误差很大。CM 官方论坛（marijn 本人）结论：

- 手动设 `.cm-scroller.scrollTop` 在编辑器完成高度测量前**不可预测**（实测偏差可达数倍）；
- **`EditorView.scrollIntoView` effect 是最佳方式**——它在 update 的 rAF 回调里做精确测量后滚动。

现有 `jumpToLine` 已经是 `dispatch({ selection, effects: EditorView.scrollIntoView(pos, {y:'center'}) })`，
**直接复用，不改滚动逻辑**。

### 3.4 双滚动模型下的行为统一

`DocInlineEditor` 的高度策略决定两种形态，跳转行为要分别确认：

| 形态 | 判定 | 跳转行为 |
| --- | --- | --- |
| 短文（fit） | 原正文高 ≤ 一屏可用高 | 编辑器内容全可见、无内部滚动条；`scrollIntoView` 为 no-op。实际效果 = 光标落到标题行 + focus，**已足够**（用户本来就看得到全文） |
| 长文 | 正文超一屏 | 编辑器内部滚动；`scrollIntoView` 滚 `.cm-scroller` 到目标行居中 |

两种形态统一走 `jumpToHeading()`（内部即 selection + scrollIntoView + focus），无需分支特判。
这是 fit 判定（`artH <= avail`）保证的：短文形态下文档必然全渲染在视口内。

### 3.5 反向高亮联动（编辑器滚动 → 目录高亮，增强项 M2）

- 监听：`EditorView.updateListener`，条件 `update.viewportChanged || update.geometryChanged`，
  内部 rAF 节流（滚动事件高频）。
- 当前标题：取视口顶行
  `state.doc.lineAt(view.lineBlockAtHeight(view.documentTop - view.scrollDOM.getBoundingClientRect().top + 1).from)`
  → 在最近一次扫描的 `HeadingHit[]` 中取「最后一个 `pos ≤ 当前顶行 pos`」的标题（线性回扫即可，
  标题数量小；也可二分）。
- UI：给 `#doc-toc-list` 对应 `.toc-row .toc-item` 切 `toc-active` class
  （样式：`color: var(--color-primary)` + 左侧 2px 指示条，与现有 `:hover` 同族）；
  同名多个标题按序号对齐第 N 个 DOM 节点。
- 面板内滚动跟随：`activeEl` 相对面板手动算 `scrollTop`（避免 `scrollIntoView` 把 fixed
  面板外的页面一起滚）。
- 现有 `MarkdownEditor` 是共享组件（写作台等也在用），反向高亮逻辑应做成
  **可选 prop（如 `onViewportHeading?: (h: HeadingHit | null) => void`）**或由
  `DocInlineEditor` 通过新的 handle 方法读取，避免污染其他使用方。

### 3.6 集成落点（改动点清单）

1. **`src/components/admin/MarkdownEditor.tsx`**：`MarkdownEditorHandle` 增加
   `jumpToHeading(level: number, nth: number): boolean`（语法树扫描 → 序列对齐 →
   复用 `jumpToLine` 内核）；返回是否命中。
2. **`src/components/doc/DocInlineEditor.tsx`**：
   - `openEditor()` 成功后采集 `tocSnapshot`（DOM 清洗见 §3.1）；
   - `window.__docInlineEditor` 增加 `jumpToHeading(level, nth)` 成员（内部调 handle、
     保存当前跳转目标供「退出编辑回到该标题」增强用）。
3. **`src/pages/doc/[id].astro`**（页面脚本，TOC 三态控制代码块附近）：
   在 `#doc-toc-list` 上加**捕获阶段**点击委托：

   ```js
   tocList.addEventListener('click', (e) => {
     const a = e.target.closest('a[data-doc-anchor]');
     if (!a) return;
     if (document.getElementById('doc-3col')?.dataset.editing === 'true') {
       e.preventDefault(); // 捕获阶段：抢在 ClientRouter 冒泡处理之前
       const level = Number((a.className.match(/toc-l(\d)/)?.[1]) ?? 2);
       window.__docInlineEditor?.jumpToHeading(level, nthOfLevel(a)); // nth = 同 level 兄弟序号
     }
   }, true);
   ```

   `nthOfLevel`：在 `tocList.querySelectorAll('a.toc-l' + level)` 中取当前项的下标。
   （等价实现：直接把「点击 DOM 序号」传给岛，岛端按快照 level 序列对齐。）

## 4. 技术难点与对策（汇总）

| # | 难点 | 对策 |
| --- | --- | --- |
| 1 | slug 与源码文本对不上（数学/中文/重名/标点） | **不做主键**。序列对齐（level + 第 N 个）为主，文本匹配仅做校验告警 |
| 2 | 代码块内 `# 注释` 被误认为标题（正则法） | 用 Lezer 语法树枚举 `ATXHeading*/SetextHeading*`，天然排除 |
| 3 | setext 标题漏识别 | 语法树法免费覆盖；正则方案需补 `=+/-+` 下划线检测 |
| 4 | 编辑期间标题增删 → 映射漂移 | 每次点击**实时扫描**（增量解析亚毫秒级），零缓存零失效问题 |
| 5 | CM6 虚拟化高度估算误差（KaTeX display 块） | 只用 `EditorView.scrollIntoView`（rAF 精确测量），禁手动 `scrollTop` 定位 |
| 6 | 双滚动模型（页面滚 / 编辑器内滚） | fit 判定保证短文内容全可见 → 统一 `jumpToHeading`，无需分支 |
| 7 | ClientRouter 抢先冒泡处理 hash 链接 | 捕获阶段（`addEventListener(..., true)`）`preventDefault`（项目既有约定） |
| 8 | 首次跳转目标在极远处，渲染一帧后才准 | `scrollIntoView` effect 自身处理；如个别场景有残余偏差，补一次 `setTimeout(0)` 二次校正（可选保险） |
| 9 | 目录子树处于折叠态，目标项不可见 | 命中后展开其祖先 `.toc-node`（移除折叠态）再高亮（M2 增强） |
| 10 | KaTeX 富文本污染 `textContent` | 快照清洗：克隆后移除 `.katex-mathml` 再取文本 |
| 11 | 反向高亮监听污染写作台等共享使用方 | 联动做成可选 prop / handle 方法，不进默认扩展 |
| 12 | 退出编辑后阅读位置 | 维持现有语义（回到进入编辑时位置）；增强：记录最后跳转的目录项，退出时以 `#slug` hash 恢复阅读位置 |

## 5. 实施路线

**M1（核心跳转，改动 3 个文件，约 60–80 行）**
1. `MarkdownEditor` +`jumpToHeading(level, nth)`（语法树扫描 + 序列对齐 + 复用 jumpToLine）；
2. `DocInlineEditor` 采集 tocSnapshot + 桥接 `jumpToHeading`；
3. `doc/[id].astro` 捕获阶段点击委托（仅 `data-editing=true` 时接管，阅读模式行为不变）。

验收：长文进入编辑 → 点深层标题 → `.cm-scroller` 滚至目标行居中、光标落在标题行、编辑器聚焦；
短文进入编辑 → 点击 → 光标落点正确且页面不跳动；阅读模式 TOC 点击行为与现状完全一致。

**M2（体验增强，可独立排期）**
- 反向高亮联动（§3.5，`onViewportHeading` 可选 prop）；
- 折叠子树自动展开；编辑期间目录实时刷新（防抖重扫，用 M1 同款扫描器重建 `renderTocTreeHtml` 需要的
  纯文本 `TocItem`，注意 KaTeX 目录项此时退化为纯文本显示——可接受）；
- 退出编辑回到最后跳转的标题（hash 恢复阅读位置）。

## 6. 结论

- 技术栈不需要任何新依赖：CodeMirror 6 既有 API（语法树 + `scrollIntoView`）+
  现有 TOC DOM + 既有 `window` 桥即可闭环；最复杂的「slug→锚点」问题被
  **序列对齐**方案整体消解，剩余难点均有确定性对策。
- 与换用 Tiptap 的方案对比：PM 免去行映射但引入整包依赖与 Markdown 往返（本会话已验证并回退），
  CM 方案仅需一次性 60–80 行 glue code，**推荐在现有 CM 架构上实施 M1**。

## 7. 参考资料

- CM6 官方论坛：手动设 `scrollTop` 不可靠、`scrollIntoView` effect 是最佳方式
  （discuss.codemirror.net/t/setting-scrolltop-for-div-cm-scroller-element/4838；
  .../cursorscrollmargin-for-v6/7448，视口顶行计算 `lineBlockAtHeight` 用法）
- Astro View Transitions/ClientRouter：链接拦截与 SPA 导航
  （docs.astro.build/en/guides/view-transitions/）
- 项目内约定：`docs/TIPTAP-INLINE-EDIT-PLAN.md`（编辑器技术选型过程）、
  工作区 memory「Astro ClientRouter 交互约定」「文档 TOC 关键约定」
