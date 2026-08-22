# My Blog

综合型个人博客：**技术教程（tech）· 学习笔记（note）· 随笔与摄影（photo）**。
基于 Astro 7（`output: 'server'`）+ React 岛 + Tailwind CSS v4 + shadcn/ui + Drizzle ORM + MDX（evaluate）+ CodeMirror 6 + Giscus。

> 当前进度：**Phase 1 已完成** —— 脚手架、主题体系、数据层、演示数据与最小可浏览首页。

## 环境要求

- Node.js ≥ 20.19（本机 22.x）
- pnpm ≥ 10（本机 11.x）

## 快速开始

```bash
pnpm install          # 安装依赖（已批准 better-sqlite3 / esbuild 构建脚本）
pnpm db:push:dev      # 初始化 SQLite（data/blog.db）
pnpm db:seed          # 灌入 3 篇演示文章（tech/note/photo 各一）
pnpm dev              # http://localhost:4321
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发服务器（含热更新） |
| `pnpm check` | `astro check` 类型检查（TS strict） |
| `pnpm build` | 生产构建（@astrojs/vercel，输出 `.vercel/output`） |
| `pnpm preview` | 预览生产构建 |
| `pnpm test` | vitest 单元测试 |
| `pnpm db:push:dev` | SQLite schema 推送（开发库） |
| `pnpm db:generate:pg` / `db:migrate:pg` | PostgreSQL 迁移生成/应用（生产） |
| `pnpm db:seed` | 重置演示数据（幂等） |

## 环境变量

复制 `.env.example` 为 `.env` 并填写（开发环境已内置一份 `.env`）。
生产部署（Vercel）需配置：`DATABASE_URL`（Neon 等 PostgreSQL）、`ADMIN_PASSWORD`、`AUTH_SECRET` 及后续阶段的 `GITHUB_*` / `PUBLIC_GISCUS_*`。

## 目录结构（Phase 1 现状）

```
db/                  # 数据层：schema.sqlite.ts / schema.pg.ts / index.ts（驱动选择）/ seed.ts / types.ts
drizzle.config.*.ts  # drizzle-kit 双方言配置
src/
  lib/               # env / tags（JSON 编解码）/ slugify（中文→拼音）/ articles（数据访问）/ utils（cn）
  styles/global.css  # Tailwind v4 + shadcn zinc 主题（亮/暗）+ prose 微调
  layouts/BaseLayout.astro   # 全站布局：ClientRouter（View Transitions）+ 页头 + 主题切换
  components/ThemeToggle.astro
  components/ui/     # shadcn：button/card/badge/input/label/select/separator/tabs/dialog/dropdown-menu/skeleton
  pages/index.astro  # 首页：文章卡片列表（来自数据库）
pnpm-workspace.yaml  # 独立工作区（隔离上级目录的 pnpm-workspace.yaml 干扰）
```

## 后续阶段预告

- Phase 2：MDX 渲染管线（GFM/指令/代码高亮+行号/TOC）与组件注册表
- Phase 3：tech/note/photo 三布局动态切换 + 文章详情页 + Giscus 评论
- Phase 4：认证（ADMIN_PASSWORD + GitHub OAuth）与 /admin 写作台（CodeMirror + 实时预览 + 防抖自动保存）
