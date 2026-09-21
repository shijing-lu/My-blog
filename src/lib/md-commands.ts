/**
 * md-commands.ts —— Markdown 编辑命令的**纯计算层**
 *
 * 设计原则：把"计算该改成什么"与"操作 CodeMirror 视图"分离 ——
 * 前者是纯函数（可单测，tests/md-commands.test.ts），后者只是薄封装。
 *
 * 语义与 Obsidian 对齐：
 * - 标题：Ctrl+N 设为 N 级；再按同级别 → 退回正文；按其他级别 → 直接切过去
 * - 加粗/斜体/删除线/行内代码：toggle —— 选区已带标记 → 去掉；未带 → 包上；
 *   无选区 → 插入空标记对并把光标放到中间
 * - 引用/列表：作用于选区涉及的每一行；整块都已带前缀 → 移除（toggle off）
 */

/** 行级标题计算：把 `line` 变成 N 级标题（0 = 退回正文；同级别退回正文） */
export function headingLine(line: string, level: number): string {
  // 容忍"#无空格"旧式写法（与原 md-keymap 行为一致）；输出统一为"# "带空格
  const m = line.match(/^(\s*)(#{1,6})\s?(.*)$/);
  // 非标题行：缩进提取自行首，正文=去掉缩进的整行（否则会丢内容）
  const lead = m?.[1] ?? (line.match(/^(\s*)/)?.[1] ?? '');
  const existing = m?.[2] ?? '';
  const body = (m ? (m[3] ?? '') : line.slice(lead.length)).trim();
  if (level <= 0) return `${lead}${body}`;
  const hashes = '#'.repeat(level);
  if (existing.length === level) return `${lead}${body}`; // 同级 → 退回正文
  return `${lead}${hashes} ${body}`.trimEnd();
}

/** 行前缀计算：加/去行首前缀（引用、列表）；`already` 检测由调用方聚合 */
export function withLinePrefix(line: string, prefix: string): string {
  if (line.trim() === '') return line; // 空行不动（引用/列表跳过空行）
  if (line.startsWith(prefix)) return line.slice(prefix.length);
  return `${prefix}${line}`;
}

/** 选区（或整行）是否已全部带前缀（用于 toggle off 判断） */
export function allLinesHavePrefix(lines: string[], prefix: string): boolean {
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every((l) => l.startsWith(prefix));
}

/** 行内标记包裹计算：
 * - 选中文本已处于 `pre…suf` 包裹中 → 返回去包裹结果（toggle off）
 * - 否则返回包裹结果
 * 输入为"包裹前的完整文本片段"，输出新文本与光标相对位置。 */
export function wrapText(
  text: string,
  pre: string,
  suf: string,
  /** 选区在 text 内的相对位置（无选区时 from=to=光标位） */
  selFrom: number,
  selTo: number,
): { text: string; from: number; to: number } {
  // toggle off：选区两端恰好是标记对
  if (
    selTo - selFrom >= pre.length + suf.length &&
    text.slice(selFrom, selFrom + pre.length) === pre &&
    text.slice(selTo - suf.length, selTo) === suf
  ) {
    return {
      text: text.slice(0, selFrom) + text.slice(selFrom + pre.length, selTo - suf.length) + text.slice(selTo),
      from: selFrom,
      to: selTo - pre.length - suf.length,
    };
  }
  // 无选区：插入空标记对，光标居中
  if (selFrom === selTo) {
    return {
      text: text.slice(0, selFrom) + pre + suf + text.slice(selFrom),
      from: selFrom + pre.length,
      to: selFrom + pre.length,
    };
  }
  // 常规包裹
  return {
    text: text.slice(0, selFrom) + pre + text.slice(selFrom, selTo) + suf + text.slice(selTo),
    from: selFrom + pre.length,
    to: selTo + pre.length,
  };
}

/** 有序列表行号渲染：把第 n 行的序号占位替换为 `n.` */
export function orderedPrefix(index: number): string {
  return `${index + 1}. `;
}

/** 代码块围栏：返回选中文本应变成的完整内容 */
export function fencedBlock(selected: string, lang = ''): string {
  const body = selected.trimEnd();
  const fence = '```';
  if (body === '') return `${fence}${lang}\n\n${fence}`;
  const inner = body.split('\n').map((l) => l).join('\n');
  return `${fence}${lang}\n${inner}\n${fence}`;
}
