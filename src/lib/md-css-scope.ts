/**
 * 自定义 Markdown 样式——纯函数（同构：服务端 SSR 注入与设置页前端实时预览共用）
 *
 * - sanitizeMdCss：防 </style> HTML 逃逸 + 长度截断；
 * - scopeMdCss：用户 CSS 作用域化到 Markdown 渲染容器（默认 .prose），详见函数注释。
 * 独立成文件的原因：md-css.ts 顶层 import db（better-sqlite3/postgres.js），
 * 前端 bundle 不能连带，故纯函数零依赖。
 */

/** CSS 文本长度上限（字符数，近似 64KB） */
export const MAX_MD_CSS_CHARS = 64 * 1024;

/**
 * 安全净化：防 </style> 逃逸 + 截断超长。
 * CSS 文本注入 <style> 的唯一逃逸路径是 `</style` 序列（可闭合标签注入脚本），
 * 整个闭合序列（到 >）一起移除（正常 CSS 不会出现）。
 */
export function sanitizeMdCss(css: string): string {
  return css.replace(/<\/\s*style[^>]*>?/gi, '').slice(0, MAX_MD_CSS_CHARS);
}

/**
 * 作用域化用户 CSS：全部规则限定在 Markdown 渲染容器（默认 .prose）内，
 * 使「上传一份 CSS → 覆盖全站所有 Markdown 渲染处」且不污染站点非 Markdown 区域。
 *
 * 规则：
 * - 普通规则：选择器前缀 `html :is(.prose) `（unlayered + 源序靠后，可稳定覆盖
 *   typography 插件 :where(...) 零特异性规则与站点 unlayered 规则）；
 * - 顶层逗号分隔的多选择器逐个处理（括号/字符串内的逗号不拆分）；
 * - 选择器在字符串外已含 `.prose` → 原样（避免重复前缀）；
 * - `:root`/`html`/`body` 开头 → 映射为 `.prose`（变量与字体意图落到 Markdown 容器；
 *   余下复合片段 `./#/:/[` 紧贴拼接保持复合语义，其余空格拼接作后代）；
 * - `@media`/`@supports`/`@container`/`@layer` → 内层递归加前缀；
 *   `@keyframes`/`@font-face` 等自包含 at-rule → 原样保留；
 * - `@import`/`@charset` → 提到输出最前（浏览器仅样式表开头有效）；
 * - 注释剔除；`</style` 净化。
 */
export function scopeMdCss(css: string, host = '.prose'): string {
  const PREFIX = `html :is(${host}) `;
  const out: string[] = [];
  const imports: string[] = [];
  /** 去注释（字符串内的 /* 不当注释——CSS 字符串内注释符号罕见，可接受） */
  const src = sanitizeMdCss(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const n = src.length;
  let i = 0;

  /** 从 i 读到下一个顶层 '{' 或 ';'；返回 {head, ch, next} */
  const readHead = (): { head: string; ch: string; next: number } => {
    let j = i;
    let depth = 0;
    let quote = '';
    while (j < n) {
      const c = src[j];
      if (quote !== '') {
        if (c === quote && src[j - 1] !== '\\') quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '(' || c === '[') {
        depth += 1;
      } else if (c === ')' || c === ']') {
        depth -= 1;
      } else if (depth === 0 && (c === '{' || c === ';')) {
        return { head: src.slice(i, j).trim(), ch: c, next: j + 1 };
      }
      j += 1;
    }
    return { head: src.slice(i, j).trim(), ch: '', next: j };
  };

  /** 从 start（'{' 处）读到匹配的 '}'，返回 body 与 '}' 后位置（不平衡读到末尾） */
  const readBlock = (start: number): { body: string; next: number } => {
    let j = start;
    let depth = 0;
    let quote = '';
    while (j < n) {
      const c = src[j];
      if (quote !== '') {
        if (c === quote && src[j - 1] !== '\\') quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
        if (depth === 0) return { body: src.slice(start + 1, j), next: j + 1 };
      }
      j += 1;
    }
    return { body: src.slice(start + 1), next: n };
  };

  /** 顶层逗号拆分选择器组（跳过括号与字符串内逗号） */
  const splitSelectors = (head: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let quote = '';
    let start = 0;
    for (let j = 0; j < head.length; j += 1) {
      const c = head[j];
      if (quote !== '') {
        if (c === quote && head[j - 1] !== '\\') quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '(' || c === '[') {
        depth += 1;
      } else if (c === ')' || c === ']') {
        depth -= 1;
      } else if (c === ',' && depth === 0) {
        parts.push(head.slice(start, j));
        start = j + 1;
      }
    }
    parts.push(head.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p !== '');
  };

  /** 检测选择器是否在「字符串外」包含 host 类（字符串内的 ".prose" 不算） */
  const containsHostOutsideString = (sel: string): boolean => {
    let quote = '';
    for (let j = 0; j < sel.length; j += 1) {
      const c = sel[j];
      if (quote !== '') {
        if (c === quote && sel[j - 1] !== '\\') quote = '';
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '.' && sel.startsWith(host, j)) {
        const after: string = sel[j + host.length] ?? '';
        const before: string = j > 0 ? (sel[j - 1] ?? '') : '';
        // 类名边界：前后不能是单词字符/连字符（如 .prose-sm 不算命中 .prose）
        if (!/[\w-]/.test(after) && !/[\w-]/.test(before)) return true;
      }
    }
    return false;
  };

  /** 单个选择器作用域化 */
  const scopeSelector = (sel: string): string => {
    // 已含 host 类 → 用户自己写了作用域，原样保留（含 `.dark .prose …` 形态，语义本就正确）
    if (containsHostOutsideString(sel)) return sel;
    // .dark / html.dark / :is(.dark) 开头（站点暗色主题分支，dark 类挂 html 上）→
    // 映射为 `.dark :is(.prose) …`（默认前缀会破坏 .dark 与 html 同元素关系）
    const dm = sel.match(/^(\.dark\b|html\.dark\b|:is\(\.dark\))/i);
    if (dm && dm[1]) {
      const rest = sel.slice(dm[1].length).trim();
      return rest === '' ? `.dark :is(${host})` : `.dark :is(${host}) ${rest}`;
    }
    // :root / html / body 开头（含 html:root、body.dark 等复合形态）→ 映射为 host 容器；
    // 余下复合片段（./#/:/[ 开头）紧贴拼接保持复合语义，其余（后代）空格拼接
    const m = sel.match(/^(:(root)\b|html\b(?::root\b)?|body\b)/i);
    if (m && m[0]) {
      const rest = sel.slice(m[0].length).trim();
      if (rest === '') return host;
      return /^[.#[]|:/.test(rest) ? `${host}${rest}` : `${host} ${rest}`;
    }
    // & 开头（CSS nesting 引用）→ 保留，嵌套上下文已在 host 内
    if (sel.startsWith('&')) return sel;
    return `${PREFIX}${sel}`;
  };

  /** 处理一段样式文本（@media 内复用，仅顶层收集 @import） */
  const processChunk = (chunk: string, topLevel: boolean): void => {
    let pi = 0;
    const pn = chunk.length;
    while (pi < pn) {
      // 跳过空白、杂散分号与多余闭括号
      const c0: string = chunk[pi] ?? '';
      if (/\s/.test(c0) || c0 === ';' || c0 === '}') {
        pi += 1;
        continue;
      }
      i = pi;
      const { head, ch, next } = readHead();
      if (ch === ';' || ch === '') {
        // 无块声明（@import / @charset 等）
        if (topLevel && head !== '' && /^@import\b/i.test(head)) imports.push(`${head};`);
        else if (head !== '') out.push(head + (ch === ';' ? ';' : ''));
        pi = next;
        continue;
      }
      // ch === '{'
      const { body, next: after } = readBlock(next - 1);
      pi = after;
      if (/^@(keyframes|font-face|property|counter-style|font-feature-values|page|scope)\b/i.test(head)) {
        // 内容自包含的 at-rule：整体原样（keyframes 百分比/字体声明不加前缀）
        out.push(`${head}{${body}}`);
        continue;
      }
      if (/^@(media|supports|container|layer)\b/i.test(head)) {
        // 嵌套上下文：内层规则递归加前缀（@layer 内规则同样前缀，保证覆盖力）
        out.push(`${head}{${scopeMdCss(body, host)}}`);
        continue;
      }
      if (head.startsWith('@')) {
        // 其他未知 at-rule：原样保留（保守不破坏）
        out.push(`${head}{${body}}`);
        continue;
      }
      // 普通规则：选择器逐个加前缀，声明体原样（CSS nesting 嵌套体相对前缀宿主解析，语义不变）
      const sels = splitSelectors(head).map(scopeSelector);
      if (sels.length > 0) out.push(`${sels.join(',')}{${body}}`);
    }
  };

  processChunk(src, true);
  return [...imports, ...out].join('\n');
}
