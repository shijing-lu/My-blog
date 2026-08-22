/**
 * shadcn/ui 工具函数
 *
 * `cn`：合并 Tailwind 类名（clsx + tailwind-merge 去重冲突类）。
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并类名：支持条件类与冲突类去重 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
