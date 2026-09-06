# Project Instructions

综合型个人博客（白衣卿相）：技术教程 / 学习笔记 / 影集 / 数学讲义 / 学习计时打卡 / 导航站 / 思维导图。

## Tech Stack
- Astro 7 SSR（`output: 'server'` + Vercel adapter）+ React 19 岛 + TypeScript(strict)
- Tailwind CSS v4（CSS-first，`@tailwindcss/vite`，vite 插件配置在 astro.config.mjs）+ shadcn/ui 风格组件（`src/components/ui/`，radix + cva）
- Drizzle ORM 双方言：开发 better-sqlite3（`data/blog.db`）/ 生产 postgres（Vercel）；schema 成对维护 `db/schema.sqlite.ts` 与 `db/schema.pg.ts`
- 内容全部存数据库（无 src/content）；Markdown/MDX 服务端渲染：`src/lib/mdx.ts` 的 `renderMdx`（remark-gfm + remark-math/rehype-katex 数学公式 + rehype-prism-plus 高亮 + remark-directive + 自定义 `mdx-plugins.ts`、`rehype-table-math.ts`）
- ⚠️ katex 版本由 pnpm-workspace.yaml overrides 强制全仓统一 0.18.5：katex 0.18 重命名了内部 CSS 类（base→katex-base），若服务端 rehype-katex 用旧版生成 HTML 而页面加载新版 CSS，`\neq` 等覆盖构造符号会渲染错乱（"/="）。升级 katex 时 HTML 与 CSS 必须同源
- CodeMirror 6 所见即所得编辑器（`/edit/*`，Obsidian 式，500ms 防抖自动保存）
- 包管理 pnpm；Node ≥ 20.19

## Build & Run
- Dev: `pnpm dev`（http://localhost:4321）
- Build: `pnpm build`（先跑两个数据迁移脚本再 astro build）
- 类型检查: `pnpm check`（提交前必跑）
- 测试: `pnpm test`（vitest，`tests/*.test.ts`）
- DB: `pnpm db:push:dev`（SQLite 推送）/ `pnpm db:generate:pg` + `db:migrate:pg`（PG 迁移）/ `pnpm db:seed`（演示数据）

## Project Structure
- `src/pages/` — Astro 路由；`blog/[slug]`（按类型切 Tech/Note/Photo 三布局）、`doc/[id]`（数学讲义）、`edit/*`（仅管理员写作台）、`study`、`gallery`、`moments`、`nav`、`calendar`
- `src/pages/api/**` — REST 风格 API（约 70 个端点，按资源分目录）
- `src/lib/` — 领域逻辑，一域一文件（kebab-case）：`auth.ts` 会话、`api.ts` 响应助手、`mdx.ts` 渲染管线、`docs.ts` 讲义 CRUD、`articles.ts`、`photos.ts` 等
- `db/` — schema（sqlite/pg 成对）、迁移、seed、breaker（熔断）
- `src/themes/` — 主题系统（编译期 TS 插件 + 运行时 JSON，开发手册 `docs/THEME-DEV.md`）
- `docs/` — 设计与部署文档（DESIGN.md、DEPLOY.md、THEME-DEV.md 等）
- `scripts/` — 构建迁移脚本与一次性诊断脚本（diag-*、prod-*，用 playwright-core 截图验证）

## Conventions
- API 路由：`export const GET/POST: APIRoute`，显式 `export const prerender = false`；响应一律用 `@/lib/api` 的 `json()` / `jsonCached()`；错误信息用中文，形如 `json({ error: '缺少 id' }, 400)`
- 鉴权：HMAC 签名 cookie 会话，7 天 TTL，无会话表。管理员 `admin_session`（口令 ADMIN_PASSWORD 或 GitHub OAuth 白名单 ADMIN_GITHUB_LOGIN），普通用户 `user_session`；守卫用 `src/lib/auth.ts` 的 `verifyRequest(cookies)` / `getCurrentUserId(cookies)`
- 路径别名 `@` → `src`；文件名 kebab-case；注释、commit message 均用中文
- Commit 风格：`feat(scope): 中文描述`（scope 如 home/footer/settings/images/doc）
- 图片：文章内嵌图与影集照片统一存 Cloudflare R2（`object-storage.ts`），DB 只存元数据；未配置 R2 时自动上传降级为仅 URL 导入；评论系统为 Twikoo 自托管（`PUBLIC_TWIKOO_ENV_ID`）
- `pnpm check` TS strict 必须零错误；改 schema 后 sqlite 用 push、pg 用 generate+migrate，两份 schema 需同步
