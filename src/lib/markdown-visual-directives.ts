/** Conservative source scanner for visual directive editors. Offsets are absolute. */
export interface SourcePart { from: number; to: number; text: string }
export interface VisualItem { heading: SourcePart; body?: SourcePart; active?: boolean; state?: '' | '+' | '-'; url?: SourcePart; alt?: SourcePart; caption?: SourcePart }
export interface VisualBlock {
  kind: 'tabs' | 'grid' | 'collapse' | 'admonition'; from: number; to: number; raw: string;
  opening: SourcePart; closing: SourcePart; items: VisualItem[];
  stableId?: string; columns?: number; aspect?: string; fit?: 'cover' | 'contain';
  accordion?: boolean; expand?: boolean;
  admonitionType?: 'note' | 'tip' | 'warning' | 'danger' | 'info';
}
interface Line { from: number; to: number; text: string }
function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const text of source.split('\n')) { lines.push({ from, to: from + text.length, text }); from += text.length + 1; }
  return lines;
}
const part = (source: string, from: number, to: number): SourcePart => ({ from, to, text: source.slice(from, to) });
function bodyPart(source: string, start: number, end: number): SourcePart {
  let from = start, to = end;
  while (from < to && source[from] === '\n') from++;
  while (to > from && source[to - 1] === '\n') to--;
  return part(source, from, to);
}
function params(text: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  const trimmed = text.trim();
  const rest = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1).trim() : trimmed;
  if (!rest) return result;
  let read = '';
  for (const match of rest.matchAll(/(?:^|\s+)(columns|aspect|fit)=(?:"([^"]+)"|([^\s]+))/g)) {
    read += match[0]; result[match[1]!] = match[2] ?? match[3]!;
  }
  return read.trim() === rest ? result : null;
}
function parse(source: string, lines: Line[], open: number, close: number, kind: VisualBlock['kind'], admonitionType?: VisualBlock['admonitionType']): VisualBlock | null {
  const first = lines[open]!, last = lines[close]!;
  const opening = part(source, first.from, first.to), closing = part(source, last.from, last.to);
  const block: VisualBlock = { kind, from: first.from, to: last.to, raw: source.slice(first.from, last.to), opening, closing, items: [] };
  if (kind === 'admonition') {
    if (!admonitionType || !new RegExp(`^:{3,}${admonitionType}\\s*$`).test(first.text)) return null;
    block.admonitionType = admonitionType;
    block.items = [{ heading: opening, body: bodyPart(source, first.to, last.from) }];
    return block;
  }
  if (kind === 'tabs') {
    const header = /^(:{3,})tabs(?:#([\w-]+))?\s*$/.exec(first.text);
    if (!header) return null;
    block.stableId = header[2] ?? '';
    const markers: Array<{ line: number; head: SourcePart; active: boolean }> = [];
    let fence: { char: string; length: number } | null = null;
    let nested = 0;
    for (let j = open + 1; j < close; j++) {
      const line = lines[j]!;
      if (fence) { const ending = /^ {0,3}(`+|~+)\s*$/.exec(line.text); if (ending && ending[1]![0] === fence.char && ending[1]!.length >= fence.length) fence = null; continue; }
      const code = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
      if (code) { fence = { char: code[1]![0]!, length: code[1]!.length }; continue; }
      if (/^:{3,}[\w-]+/.test(line.text)) { nested++; continue; }
      if (/^:{3,}\s*$/.test(line.text) && nested) { nested--; continue; }
      if (nested) continue;
      const marker = /^@tab(?::(active))?\s+(.+)$/.exec(line.text);
      if (marker) markers.push({ line: j, head: part(source, line.to - marker[2]!.length, line.to), active: !!marker[1] });
      else if (!markers.length && line.text.trim()) return null;
    }
    if (markers.length < 2 || markers.filter((m) => m.active).length > 1) return null;
    block.items = markers.map((m, index) => ({ heading: m.head, active: m.active,
      body: bodyPart(source, lines[m.line]!.to, (markers[index + 1] ? lines[markers[index + 1]!.line] : last)!.from) }));
    return block;
  }
  if (kind === 'grid') {
    const args = /^:{3,}grid\b(.*)$/.exec(first.text);
    const p = args && params(args[1]!);
    if (!p) return null;
    const columns = Number(p.columns ?? 3);
    if (!Number.isInteger(columns) || columns < 1 || columns > 6) return null;
    const aspect = p.aspect ?? '16/10';
    if (!/^\d{1,3}[/:]\d{1,3}$/.test(aspect) || aspect.split(/[/:]/).some((n) => Number(n) <= 0)) return null;
    const fit = p.fit ?? 'cover'; if (fit !== 'cover' && fit !== 'contain') return null;
    block.columns = columns; block.aspect = aspect.replace(':', '/'); block.fit = fit;
    for (let j = open + 1; j < close; j++) {
      const line = lines[j]!;
      if (!line.text.trim()) continue;
      const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(line.text);
      if (!image) return null;
      const altFrom = line.from + 2;
      const urlFrom = line.from + line.text.indexOf('](') + 2;
      const captionMatch = /\s+"([^"]*)"\)$/.exec(line.text);
      const caption = captionMatch ? part(source, line.to - captionMatch[1]!.length - 2, line.to - 2) : undefined;
      block.items.push({ heading: part(source, line.from, line.to), alt: part(source, altFrom, altFrom + image[1]!.length),
        url: part(source, urlFrom, urlFrom + image[2]!.length), caption });
    }
    return block.items.length ? block : null;
  }
  const flags = /^:{3,}collapse(?:\s+(accordion|expand))?(?:\s+(accordion|expand))?\s*$/.exec(first.text);
  if (!flags || (flags[1] && flags[1] === flags[2])) return null;
  block.accordion = flags[1] === 'accordion' || flags[2] === 'accordion';
  block.expand = flags[1] === 'expand' || flags[2] === 'expand';
  const markers: Array<{ line: number; head: SourcePart; state: '' | '+' | '-' }> = [];
  let innerFence: { char: string; length: number } | null = null;
  for (let j = open + 1; j < close; j++) {
    const line = lines[j]!;
    if (innerFence) { const ending = /^ {0,3}(`+|~+)\s*$/.exec(line.text); if (ending && ending[1]![0] === innerFence.char && ending[1]!.length >= innerFence.length) innerFence = null; continue; }
    const code = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (code) { if (!markers.length) return null; innerFence = { char: code[1]![0]!, length: code[1]!.length }; continue; }
    const marker = /^- (?:(:([+-]) )?)(.+)$/.exec(line.text);
    if (marker) markers.push({ line: j, head: part(source, line.to - marker[3]!.length, line.to), state: (marker[2] ?? '') as '' | '+' | '-' });
    else if (!markers.length && line.text.trim()) return null;
    else if (line.text.trim() && !/^  |^\t/.test(line.text)) return null;
  }
  if (!markers.length) return null;
  block.items = markers.map((m, index) => {
    const end = (markers[index + 1] ? lines[markers[index + 1]!.line] : last)!.from;
    const raw = bodyPart(source, lines[m.line]!.to, end);
    return { heading: m.head, state: m.state, body: raw };
  });
  return block;
}

export function scanVisualDirectives(source: string): VisualBlock[] {
  const lines = linesOf(source), found: VisualBlock[] = [];
  let code: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (code) { const m = /^ {0,3}(`+|~+)\s*$/.exec(line.text); if (m && m[1]![0] === code.char && m[1]!.length >= code.length) code = null; continue; }
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence) { code = { char: fence[1]![0]!, length: fence[1]!.length }; continue; }
    const match = /^(:{3,})(tabs|grid|collapse|note|tip|warning|danger|info)(?:\b|#)/.exec(line.text);
    if (!match) continue;
    const length = match[1]!.length;
    let nested = 0, close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const inner = lines[j]!.text;
      if (/^ {0,3}(`{3,}|~{3,})/.test(inner)) {
        const f = /^ {0,3}(`{3,}|~{3,})/.exec(inner)![1]!;
        j++;
        while (j < lines.length && !new RegExp(`^ {0,3}${f[0]}{${f.length},}\\s*$`).test(lines[j]!.text)) j++;
        continue;
      }
      if (/^:{3,}[\w-]+/.test(inner)) { nested++; continue; }
      const ending = /^(:{3,})\s*$/.exec(inner);
      if (ending) { if (nested) nested--; else if (ending[1]!.length >= length) { close = j; break; } }
    }
    if (close < 0) continue;
    const type = match[2]!;
    const admonitionType = /^(note|tip|warning|danger|info)$/.test(type) ? type as VisualBlock['admonitionType'] : undefined;
    const block = parse(source, lines, i, close, admonitionType ? 'admonition' : type as VisualBlock['kind'], admonitionType);
    if (block) found.push(block);
    i = close;
  }
  return found;
}
