/**
 * editor-shortcut-defs.ts —— 快捷键定义与纯逻辑（**客户端安全**：不 import 数据库）
 *
 * 服务端存取在 src/lib/editor-shortcuts.ts（re-export 本模块的纯部分）。
 * 默认值与 Obsidian 对齐；浏览器保留键处有标注（Web 端提示改绑）。
 */

/** 单个快捷键定义 */
export interface ShortcutDef {
  /** 稳定 id（存储用） */
  id: string;
  /** 设置页显示名 */
  label: string;
  /** 默认绑定（CodeMirror `Mod-` 语法；Mod = Win 的 Ctrl / Mac 的 Cmd） */
  binding: string;
  /** 设置页分组 */
  group: '格式' | '标题' | '块结构' | '插入与扩展';
  /** 受浏览器保留键影响（Web 标签页中 Mod-1..8 = 切换标签，页面无法拦截） */
  browserReserved?: boolean;
}

/** 默认快捷键表（与 Obsidian 一致） */
export const EDITOR_SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'bold', label: '加粗 **文本**', binding: 'Mod-b', group: '格式' },
  { id: 'italic', label: '斜体 *文本*', binding: 'Mod-i', group: '格式' },
  { id: 'strike', label: '删除线 ~~文本~~', binding: 'Mod-Shift-x', group: '格式' },
  { id: 'inlineCode', label: '行内代码 `文本`', binding: 'Mod-e', group: '格式' },
  { id: 'link', label: '链接 [文本](url)', binding: 'Mod-k', group: '格式' },
  { id: 'codeBlock', label: '代码块 ``` 围栏', binding: 'Mod-Alt-c', group: '格式' },
  { id: 'heading1', label: '一级标题', binding: 'Mod-1', group: '标题', browserReserved: true },
  { id: 'heading2', label: '二级标题', binding: 'Mod-2', group: '标题', browserReserved: true },
  { id: 'heading3', label: '三级标题', binding: 'Mod-3', group: '标题', browserReserved: true },
  { id: 'heading4', label: '四级标题', binding: 'Mod-4', group: '标题', browserReserved: true },
  { id: 'heading5', label: '五级标题', binding: 'Mod-5', group: '标题', browserReserved: true },
  { id: 'heading6', label: '六级标题', binding: 'Mod-6', group: '标题', browserReserved: true },
  { id: 'quote', label: '引用 >', binding: 'Mod-Shift-.', group: '块结构' },
  { id: 'ul', label: '无序列表 -', binding: 'Mod-Shift-l', group: '块结构' },
  { id: 'ol', label: '有序列表 1.', binding: 'Mod-Shift-o', group: '块结构' },
  { id: 'task', label: '任务列表 - [ ]', binding: 'Mod-Shift-u', group: '块结构' },
  { id: 'underline', label: '下划线 <u>文本</u>', binding: '', group: '格式' },
  { id: 'highlight', label: '荧光高亮 ==文本==', binding: '', group: '格式' },
  { id: 'spoiler', label: '黑幕 :spoiler[文本]', binding: '', group: '格式' },
  { id: 'image', label: '图片 ![描述](地址)', binding: '', group: '插入与扩展' },
  { id: 'horizontalRule', label: '分隔线 ---', binding: '', group: '插入与扩展' },
  { id: 'table', label: '表格', binding: '', group: '插入与扩展' },
  { id: 'footnote', label: '脚注引用与定义', binding: '', group: '插入与扩展' },
  { id: 'inlineMath', label: '行内公式 $…$', binding: '', group: '插入与扩展' },
  { id: 'blockMath', label: '块级公式 $$…$$', binding: '', group: '插入与扩展' },
  { id: 'callout', label: 'Callout 引用', binding: '', group: '插入与扩展' },
  { id: 'admonition', label: '提示块', binding: '', group: '插入与扩展' },
  { id: 'inlineNote', label: '行内提示 :note[文本]', binding: '', group: '插入与扩展' },
  { id: 'tabs', label: '选项卡组', binding: '', group: '插入与扩展' },
  { id: 'collapse', label: '折叠面板', binding: '', group: '插入与扩展' },
  { id: 'gallery', label: '图片画廊', binding: '', group: '插入与扩展' },
  { id: 'columns2', label: '两栏', binding: '', group: '插入与扩展' },
  { id: 'columns3', label: '三栏', binding: '', group: '插入与扩展' },
];

export const SHORTCUT_IDS = new Set(EDITOR_SHORTCUT_DEFS.map((def) => def.id));

/** id → 默认绑定 */
export const DEFAULT_BINDINGS: Record<string, string> = Object.fromEntries(
  EDITOR_SHORTCUT_DEFS.filter((d) => d.binding).map((d) => [d.id, d.binding]),
);

/** 规范化绑定串：小写化；ctrl/cmd/meta → Mod；修饰键统一 Mod/Alt/Shift 顺序；非法返回 null */
export function normalizeBinding(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const parts = raw.split(/[-+]/).map((p) => p.trim()).filter(Boolean);
  const keyParts: string[] = [];
  const modSet = new Set<string>();
  for (const p of parts) {
    if (['mod', 'ctrl', 'cmd', 'meta', 'alt', 'shift'].includes(p)) {
      modSet.add(p === 'ctrl' || p === 'cmd' || p === 'meta' ? 'mod' : p);
    } else {
      keyParts.push(p);
    }
  }
  if (keyParts.length === 0) return null;
  const order = ['mod', 'alt', 'shift'];
  return [...order.filter((m) => modSet.has(m)), ...keyParts].join('-');
}

/** 从 KeyboardEvent 生成绑定串（设置页录制用）；仅修饰键按下时返回 null */
export function bindingFromEvent(e: KeyboardEvent): string | null {
  const key = e.key;
  if (!key || ['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  if (!e.ctrlKey && !e.metaKey && !e.altKey) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // Shift+Period reports ">" on Windows, while CodeMirror expects "Shift-.".
  const physical = /^(Period|Comma|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Backquote)$/.test(e.code)
    ? ({ Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`' } as Record<string, string>)[e.code]
    : undefined;
  parts.push(physical ?? (/^[a-z0-9]$/i.test(key) ? key.toLowerCase() : key));
  return normalizeBinding(parts.join('-'));
}

/** 合并默认与自定义（自定义优先），并检测冲突（同一绑定被多个命令占用） */
export function resolveBindings(custom: Record<string, string>): {
  bindings: Record<string, string>;
  conflicts: Array<{ binding: string; ids: string[] }>;
} {
  // 自定义值统一规范化（大小写/修饰键顺序），保证冲突检测的准确性
  const normalized: Record<string, string> = {};
  for (const [id, b] of Object.entries(custom)) {
    const n = normalizeBinding(b);
    if (n && SHORTCUT_IDS.has(id)) normalized[id] = n;
  }
  // 默认表同样规范化，避免 'Mod-i' 与自定义 'mod-i' 因大小写差异漏判冲突
  const defaultNormalized: Record<string, string> = {};
  for (const [id, b] of Object.entries(DEFAULT_BINDINGS)) {
    const n = normalizeBinding(b);
    if (n) defaultNormalized[id] = n;
  }
  const bindings: Record<string, string> = { ...defaultNormalized, ...normalized };
  const byBinding = new Map<string, string[]>();
  for (const [id, b] of Object.entries(bindings)) {
    const list = byBinding.get(b) ?? [];
    list.push(id);
    byBinding.set(b, list);
  }
  const conflicts: Array<{ binding: string; ids: string[] }> = [];
  for (const [binding, ids] of byBinding) {
    if (ids.length > 1) conflicts.push({ binding, ids: [...ids].sort() });
  }
  return { bindings, conflicts };
}
