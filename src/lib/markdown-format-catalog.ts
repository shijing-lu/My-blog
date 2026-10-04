/** Shared by the MDX renderer and the document editor menu. */
export const CALLOUT_TYPES = [
  'note', 'info', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export const MARK_VARIANTS = ['primary', 'secondary', 'tertiary', 'error', 'tip'] as const;
export type MarkVariant = (typeof MARK_VARIANTS)[number];

export const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: '笔记', info: '信息', tip: '提示', success: '成功', question: '疑问',
  warning: '警告', failure: '失败', danger: '危险', bug: '错误', example: '示例', quote: '引言',
};

export const MARK_LABELS: Record<MarkVariant, string> = {
  primary: '主色', secondary: '次色', tertiary: '第三色', error: '错误', tip: '提示',
};
