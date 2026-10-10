import { createHash } from "node:crypto";
export const contentVersion = (source: string) =>
  createHash("sha256").update(source).digest("hex");
export class ArticleConflictError extends Error {
  constructor() {
    super("正文已在其他窗口修改，当前改动已保留，请重新读取并处理冲突");
  }
}
