/** Source ranges shared by the reader and editor. All offsets refer to the input. */
export interface MarkdownColumn { from: number; to: number; content: string }
export interface MarkdownColumns {
  from: number;
  to: number;
  fence: string;
  columns: MarkdownColumn[];
}

interface Line { from: number; to: number; next: number; text: string }
function sourceLines(source: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const raw of source.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ from, to: from + text.length, next: Math.min(source.length, from + raw.length + 1), text });
    from += raw.length + 1;
  }
  return lines;
}

function codeOpening(text: string): string | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
  if (!match || (match[1]![0] === '`' && match[2]!.includes('`'))) return null;
  return match[1]!;
}
function codeClosing(text: string, fence: string): boolean {
  const match = /^ {0,3}(`+|~+)\s*$/.exec(text);
  return !!match && match[1]![0] === fence[0] && match[1]!.length >= fence.length;
}

/** Only complete top-level groups of 2/3 columns are editable. Malformed input is untouched. */
export function scanMarkdownColumns(source: string): MarkdownColumns[] {
  const lines = sourceLines(source);
  const blocks: MarkdownColumns[] = [];
  let code: string | null = null;
  let outsideMath = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (code) { if (codeClosing(line.text, code)) code = null; continue; }
    code = codeOpening(line.text);
    if (code) continue;
    if (/^ {0,3}\${2,}[ \t]*$/.test(line.text)) { outsideMath = !outsideMath; continue; }
    if (outsideMath) continue;
    const opening = /^ {0,3}(:{3,})columns[ \t]*$/.exec(line.text);
    if (!opening) continue;
    const fence = opening[1]!;
    const markers: Line[] = [];
    const nested: number[] = [];
    let innerCode: string | null = null;
    let math = false;
    let valid = true;
    let closing = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const current = lines[j]!;
      if (innerCode) { if (codeClosing(current.text, innerCode)) innerCode = null; continue; }
      innerCode = codeOpening(current.text);
      if (innerCode) continue;
      if (/^ {0,3}\${2,}[ \t]*$/.test(current.text)) { math = !math; continue; }
      if (math) continue;
      const end = /^ {0,3}(:{3,})[ \t]*$/.exec(current.text);
      if (end) {
        if (end[1]!.length >= fence.length) { closing = j; break; }
        if (nested.length && end[1]!.length >= nested[nested.length - 1]!) nested.pop();
        continue;
      }
      const start = /^ {0,3}(:{3,})([\w-]+)/.exec(current.text);
      if (start) {
        if (start[2] === 'columns' || start[1]!.length >= fence.length) valid = false;
        nested.push(start[1]!.length);
        continue;
      }
      if (nested.length === 0 && /^ {0,3}::column[ \t]*$/.test(current.text)) markers.push(current);
      else if (markers.length === 0 && current.text.trim()) valid = false;
    }
    if (closing < 0) break;
    if (valid && nested.length === 0 && (markers.length === 2 || markers.length === 3)) {
      const end = lines[closing]!;
      const columns = markers.map((marker, index) => {
        let from = marker.next;
        let to = (markers[index + 1] ?? end).from;
        // Blank framing lines belong to the container, not the editable column.
        if (source.slice(from, from + 2) === '\r\n') from += 2;
        else if (source[from] === '\n') from += 1;
        for (let framing = 0; framing < 2 && to > from; framing += 1) {
          if (source[to - 1] !== '\n') break;
          to -= 1;
          if (to > from && source[to - 1] === '\r') to -= 1;
        }
        return { from, to, content: source.slice(from, to) };
      });
      blocks.push({ from: line.from, to: end.to, fence, columns });
    }
    i = closing;
  }
  return blocks;
}

/** Choose a fence longer than any embedded directive, including examples in code. */
export function buildMarkdownColumns(columns: readonly string[]): string {
  return serializeMarkdownColumns(columns).source;
}

/** Known column boundaries stay available while an author types an unfinished code fence. */
export function serializeMarkdownColumns(columns: readonly string[]): { source: string; block: MarkdownColumns } {
  if (columns.length !== 2 && columns.length !== 3) throw new Error('多栏只支持两栏或三栏');
  let length = 3;
  for (const content of columns) {
    for (const match of content.matchAll(/^ {0,3}(:{3,})/gm)) length = Math.max(length, match[1]!.length + 1);
  }
  const fence = ':'.repeat(length);
  let source = `${fence}columns\n\n`;
  const ranges: MarkdownColumn[] = [];
  for (const content of columns) {
    source += '::column\n\n';
    const from = source.length;
    source += content;
    ranges.push({ from, to: source.length, content });
    source += '\n\n';
  }
  source += fence;
  return { source, block: { from: 0, to: source.length, fence, columns: ranges } };
}

/** Removing a nonempty column merges its Markdown into its neighbour in reading order. */
export function removeMarkdownColumn(columns: readonly string[], at: number): string[] {
  if (columns.length !== 3 || at < 0 || at >= columns.length) return [...columns];
  const next = [...columns];
  const removed = next.splice(at, 1)[0]!;
  if (removed.trim()) {
    const target = Math.max(0, at - 1);
    const pieces = at === 0 ? [removed, next[target]!] : [next[target]!, removed];
    next[target] = pieces.filter((piece) => piece.length > 0).join('\n\n');
  }
  return next;
}
