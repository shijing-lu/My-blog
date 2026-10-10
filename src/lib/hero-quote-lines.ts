/** Preserve every character while grouping punctuation for the paper-card layout. */
export function heroQuoteLines(text: string): string[] {
  return text.match(/[^，。！？；\n]+[，。！？；\n]?|[，。！？；\n]/gu) ?? [text];
}
