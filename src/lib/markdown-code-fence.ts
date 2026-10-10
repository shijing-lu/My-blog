/** Protect code verbatim, including fences inside one or more blockquote levels. */
export function codeFenceGuard(): (line: string) => boolean {
  let fence: { char: string; length: number; depth: number } | null = null;
  return (line: string): boolean => {
    const quote = /^((?:[ \t]{0,3}>[ \t]?)*)(.*)$/.exec(line);
    const depth = (quote?.[1]?.match(/>/g) ?? []).length;
    const content = quote?.[2] ?? line;
    // A nonblank line outside the quote ends its code container even without a fence.
    if (fence && depth < fence.depth && line.trim()) fence = null;
    if (fence) {
      const close = /^ {0,3}(`+|~+)[ \t\r]*$/.exec(content);
      if (depth === fence.depth && close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;
      return true;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
    if (!open || (open[1]![0] === '`' && open[2]!.includes('`'))) return false;
    fence = { char: open[1]![0]!, length: open[1]!.length, depth };
    return true;
  };
}
