# My Blog

综合型个人博客：**技术教程（tech）· 学习笔记（note）· 随笔与摄影（photo）**。
基于 Astro 7（`output: 'server'`）+ React 岛 + Tailwind CSS v4 + shadcn/ui + Drizzle ORM（SQLite/PostgreSQL）+ MDX（evaluate）+ CodeMirror 6（Obsidian 式所见即所得）+ Giscus。

## 功能总览

- **公开面**：首页卡片流（**手动封面**优先、无则取正文首图 + 类型章 + **服务端分页与分页栏跳转**、**服务端全站搜索**/类型筛选）、`/blog/[slug]` 按类型**动态切换三种布局**（Tech 带目录 / Note 简洁 / Photo 杂志宽幅）、标签聚合 `/tags/[tag]`、RSS、Giscus 评论、View Transitions、亮暗主题。
- **影集**（`/gallery`，独立子系统）：**瀑布流**照片墙 + 右侧**时间线**（按展示日期，最新在上）+ 左侧预留区；滚动到底部「更多」按钮分页加载；灯箱查看；上传页一次多张、**每批统一日期**（默认当日）、可选标题、URL 导入（兼容 PicGo/GitHub 图床）；照片存 Vercel Blob（未配置 token 时自动上传降级，仅 URL 导入）。
- **主题系统**：编译期 TS 插件 + 运行时 JSON 导入（设置面板右上角调色盘），预置 Claude·像素 / 暗黑终端 / 极简奶油 / 石墨蓝，可下载黑客主题（`/themes/hacker.json`）。开发手册见 `docs/THEME-DEV.md`。
- **写作台**（`/edit/*`，仅管理员）：Obsidian 式**单栏所见即所得**（Markdown 标记隐藏 + 代码块/图片实时渲染），500ms 防抖自动保存、Ctrl/Cmd-S、本地图片上传（DB 持久化）+ **剪贴板粘贴 / 拖拽上传 / 网络图片 URL**、**封面图手动指定**、文章左栏管理（新建/移动/删除）、右栏实时目录。
- **鉴权**：`ADMIN_PASSWORD` 口令 + GitHub OAuth（`ADMIN_GITHUB_LOGIN` 白名单），会话 7 天；首页右上角登录/写作入口，右侧边栏「+ 新建文章」。

## 环境要求

- Node.js ≥ 20.19，pnpm ≥ 10

## 影集照片存储（Vercel Blob）

- **自动上传**（上传页「选择文件」）：需配置 `BLOB_READ_WRITE_TOKEN`。
  1. 到 Vercel 控制台 **Storage → Create Database → Blob** 新建一个 Blob store，复制其 `BLOB_READ_WRITE_TOKEN`；
  2. 填入项目环境变量（Vercel → Project → Settings → Environment Variables）与本地 `.env`；
  3. 重启开发/部署后生效。
- **未配置 token**：上传页自动隐藏「选择文件」，仅保留 **URL 导入**（PicGo/GitHub 图床直链）——无需任何配置。
- **URL 导入**：粘贴图片**直链**即可（`raw.githubusercontent.com` 或 `cdn.jsdelivr.net/gh/...`；自动把 `github.com/.../blob/...` 网页链接改写成 raw 直链）。跨域/防盗链导致读不到宽高时会按 4:3 占位导入，不影响入库。

## 快速开始（开发）

```bash
pnpm install          # 安装依赖
pnpm db:push:dev      # 初始化 SQLite（data/blog.db）
pnpm db:seed          # 灌入 3 篇演示文章（幂等）
cp .env.example .env  # 按需填写（开发默认值已内置 .env）
pnpm dev              # http://localhost:4321
```

登录写作台：`/login`（开发密码见 `.env` 的 `ADMIN_PASSWORD`，默认 `dev-admin-password`）。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm preview` | 开发 / 构建 / 预览 |
| `pnpm check` | `astro check` 类型检查（TS strict） |
| `pnpm test` | vitest 单元测试 |
| `pnpm db:push:dev` | SQLite schema 推送 |
| `pnpm db:generate:pg` / `db:migrate:pg` | PostgreSQL 迁移生成 / 应用 |
| `pnpm db:seed` | 灌演示数据（幂等） |
| `pnpm db:inspect` | 命令行查看数据库内容 |
| `pnpm exec drizzle-kit studio --config=drizzle.config.sqlite.ts` | Drizzle Studio 网页查看/编辑数据库 |

## 数据库

- 开发：SQLite（`data/blog.db`，better-sqlite3）；生产：PostgreSQL（postgres.js，推荐 Neon）。
- 按 `DATABASE_URL` 前缀自动切换（`postgres://` → PG，其余 → SQLite）。
- 文章存 `articles` 表（正文为 MDX 源码）；**图片以 base64 存 `images` 表**（兼容 Vercel Serverless 无磁盘），经 `/api/images/[id]` 公开输出。
- 影集照片存 `photos` 表（元数据） + **Vercel Blob**（原图/缩略图，需 `BLOB_READ_WRITE_TOKEN`；未配置时仅 URL 导入可用）。

## 目录结构（要点）

```
db/                    # schema.sqlite.ts / schema.pg.ts / index.ts（驱动选择）/ seed.ts / types.ts
src/
  lib/                 # articles / mdx(+plugins) / auth / theme / custom-theme / images / photos / photo-storage / reading / env / api / utils / pagination
  themes/              # 主题注册表 + 4 套内置主题 + _template
  layouts/             # BaseLayout / AdminLayout / Tech·Note·PhotoLayout
  components/          # mdx 注册表、article/*、ui/*(shadcn)、admin/*(LiveEditor、cm-live-preview)
  pages/               # 首页 / blog/[slug] / tags/[tag] / gallery(/upload) / edit/* / admin / login / rss.xml / api/*
  middleware.ts        # 鉴权：保护 /admin、/edit、/gallery/upload、受保护 API
docs/                  # DESIGN.md（设计决策）· THEME-DEV.md（主题开发手册）· DEPLOY.md（部署）
```

## 文档

- `docs/DEPLOY.md` —— Vercel 部署指南（环境变量 / Neon / Giscus / 构建配置）
- `docs/THEME-DEV.md` —— 主题插件开发手册（TS 模块 + 运行时 JSON 导入）
- `docs/DESIGN.md` —— 设计决策记录（像素规则、角色模型、编辑交互等）
