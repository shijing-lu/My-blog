/** Shared limits, independent of database and Node so the drop UI can import them. */
export const DOC_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const DOC_IMPORT_MAX_CHARS = 500000;
export const DOC_IMPORT_MAX_FILES = 20;
export function markdownFilename(name: string): boolean {
  return name.length > 0 && name.length <= 240 && !/[\\/\u0000-\u001f]/.test(name) && /\.(?:md|markdown)$/i.test(name);
}
