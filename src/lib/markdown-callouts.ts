/** Strip exactly one explicit quote level. Blank quoted lines belong to the body. */
export function quotePrefix(line: string): string | null {
  return /^ {0,3}>[ \t]?/.exec(line)?.[0] ?? null;
}

export interface MarkdownCallout {
  from: number;
  to: number;
  raw: string;
  heading: string;
  type: string;
  fold: string;
  title: string;
  body: string;
}

interface SourceLine { text: string; from: number; to: number }
function sourceLines(source: string): SourceLine[] {
  let from = 0;
  return source.split('\n').map((text) => {
    const line = { text, from, to: from + text.length };
    from += text.length + 1;
    return line;
  });
}

/** Quoted regions outside fenced examples, with offsets back into the original source. */
export function quotedMarkdownSegments(source: string): Array<{ source: string; originalOffset: (offset: number) => number }> {
  const lines = sourceLines(source);
  const result: Array<{ source: string; originalOffset: (offset: number) => number }> = [];
  let fence: string | null = null;
  let math = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line.text)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.text.trim() === marker) fence = null;
      continue;
    }
    if (marker) { fence = marker; continue; }
    if (/^\s*\$\$\s*$/.test(line.text)) { math = !math; continue; }
    if (math || !quotePrefix(line.text)) continue;
    const parts: string[] = [];
    const offsets: Array<{ projected: number; original: number }> = [];
    let length = 0;
    while (i < lines.length) {
      const current = lines[i]!;
      const prefix = quotePrefix(current.text);
      if (!prefix) break;
      const text = current.text.slice(prefix.length);
      offsets.push({ projected: length, original: current.from + prefix.length });
      parts.push(text);
      length += text.length + 1;
      i += 1;
    }
    i -= 1;
    result.push({ source: parts.join('\n'), originalOffset: (offset) => {
      let low = 0, high = offsets.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (offsets[mid]!.projected <= offset) low = mid;
        else high = mid - 1;
      }
      const entry = offsets[low]!;
      return entry.original + offset - entry.projected;
    } });
  }
  return result;
}

export function scanMarkdownCallouts(source: string): MarkdownCallout[] {
  const result: MarkdownCallout[] = [];
  for (const segment of quotedMarkdownSegments(source)) {
    const lines = sourceLines(segment.source);
    // A Callout header belongs at the start of its blockquote, not inside a code example.
    const first = lines[0]!;
    const header = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/.exec(first.text.trimEnd());
    if (!header) continue;
    const from = source.lastIndexOf('\n', Math.max(0, segment.originalOffset(0) - 1)) + 1;
    const last = lines[lines.length - 1]!;
    const to = segment.originalOffset(last.to);
    result.push({ from, to, raw: source.slice(from, to), heading: source.slice(from, source.indexOf('\n', from) < 0 ? to : source.indexOf('\n', from)),
      type: header[1]!.toLowerCase(), fold: header[2]!, title: header[3]!, body: lines.slice(1).map(line => line.text).join('\n') });
  }
  return result;
}

export function serializeCalloutBody(heading: string, body: string): string {
  return `${heading}\n${body.split('\n').map(line => `> ${line}`).join('\n')}`;
}
