/** Redact allowed startup text before serialization, including quoted examples. */
export function sanitizeToolchainMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[已省略]';
  if (typeof value === 'string') return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [已隐藏]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|token|password|secret|authorization)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]')
    .replace(/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[已隐藏]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[已隐藏]@');
  if (Array.isArray(value)) return value.map(item => sanitizeToolchainMetadata(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:api[_-]?key|access[_-]?token|token|password|secret|authorization)$/i.test(key) ? '[已隐藏]' : sanitizeToolchainMetadata(item, depth + 1)]));
  return value;
}
