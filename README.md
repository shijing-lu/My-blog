<div align="center">

# My Blog · 白衣卿相

_一个功能完整的综合型个人博客 —— 技术教程 · 学习笔记 · 影集 · 数学讲义 · 学习管理_

![Astro](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-SQLite%20%2F%20PostgreSQL-C5F74F?logo=drizzle&logoColor=black)
![CodeMirror](https://img.shields.io/badge/CodeMirror-6-D3070C?logo=codemirror&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)

</div>

---

## 目录

- [功能特性](#-功能特性)
- [站点地图](#-站点地图)
- [快速开始](#-快速开始)
- [环境变量](#-环境变量)
- [数据与存储](#-数据与存储)
- [常用命令](#-常用命令)
- [目录结构](#-目录结构)
- [部署](#-部署)
- [路线图](#-路线图)
- [贡献](#-贡献)
- [许可证](#-许可证)

## ✨ 功能特性

### 📝 博客
- 首页卡片流：手动封面优先（无则取正文首图）、类型章、服务端分页与分页栏跳转、服务端全站搜索 / 类型筛选
- 文章页 `/blog/[slug]` 按类型动态切换三种布局：**Tech**（带目录）/ **Note**（简洁）/ **Photo**（杂志宽幅）
- 标签聚合 `/tags/[tag]` · RSS 订阅 · Twikoo 评论 · View Transitions · 亮暗主题

### 📖 数学讲义（`/doc`）
- 分类 → 分册 → 文章的树形结构，KaTeX 数学公式渲染，块级公式源码/渲染态切换
- 编辑态目录实时刷新、点击跳转、视口反向高亮联动

### ✍️ 写作台（`/edit/*`，仅管理员）
- CodeMirror 6 **Obsidian 式单栏所见即所得**：Markdown 标记隐藏，代码块/图片/公式实时渲染
- 500ms 防抖自动保存、`Ctrl/Cmd-S` 手动保存
- 图片支持本地上传 / 剪贴板粘贴 / 拖拽 / 网络 URL，封面图手动指定
- 左栏文章管理（新建/移动/删除）、右栏实时目录

### 🖼️ 影集（`/gallery`）
- 瀑布流照片墙 + 时间线（按展示日期倒序）、滚动分页、灯箱查看
- 上传页一次多张、每批统一日期、可选标题；URL 导入兼容 PicGo / GitHub 图床直链
- 照片字节存 Cloudflare R2，数据库只存元数据（未配置 R2 时自动降级为仅 URL 导入）

### 📚 学习系统（`/study`）
- 专注计时、任务管理、分心记录、每日打卡、热力图统计

### 🧩 更多模块
- 导航站 `/nav`（分类/子分类/网址收录与扫描）· 说说 `/moments` · 日历 `/calendar` · 思维导图 · 练字字帖 · 点赞（指纹去重）

### 🎨 主题系统
- 编译期 TS 插件 + 运行时 JSON 导入双轨机制，设置面板右上角调色盘即点即换
- 预置 4 套主题：Claude·像素 / 暗黑终端 / 极简奶油 / 石墨蓝，可下载黑客主题（`/themes/hacker.json`）

### 🔐 鉴权
- 双通道：`ADMIN_PASSWORD` 口令 + GitHub OAuth（`ADMIN_GITHUB_LOGIN` 白名单）
- HMAC 签名 Cookie 会话（7 天 TTL），`src/middleware.ts` 统一保护 `/admin`、`/edit`、`/gallery/upload` 及受保护 API

## 🗺️ 站点地图

| 路由 | 说明 | 访问 |
| --- | --- | --- |
| `/` | 首页卡片流 | 公开 |
| `/blog/[slug]` | 文章详情（三种布局） | 公开 |
| `/tags/[tag]` | 标签聚合 | 公开 |
| `/doc` · `/doc/[id]` | 数学讲义 | 公开 |
| `/gallery` | 影集 | 公开 |
| `/moments` | 说说 | 公开 |
| `/nav` | 导航站 | 公开 |
| `/calendar` | 日历 | 公开 |
| `/study` | 学习系统 | 公开 |
| `/rss.xml` | RSS 订阅 | 公开 |
| `/login` | 登录 | 公开 |
| `/edit/*` | 写作台 | 仅管理员 |
| `/admin/*` | 后台管理 | 仅管理员 |

## 🖥️ 快速开始

**环境要求**：Node.js ≥ 20.19 · pnpm ≥ 10

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量（开发默认值已内置，可按需修改）
cp .env.example .env

# 3. 初始化 SQLite 数据库（data/blog.db）
pnpm db:push:dev

# 4. 灌入演示数据（幂等）
pnpm db:seed

# 5. 启动开发服务器
pnpm dev
```

打开 http://localhost:4321 ，访问 `/login` 登录写作台（开发密码见 `.env` 的 `ADMIN_PASSWORD`，默认 `dev-admin-password`）。

## ⚙️ 环境变量

> 完整说明见 [.env.example](.env.example)，复制为 `.env` 后填写。`.env` 已被 gitignore，切勿提交真实密钥。

### 必填

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 后台登录口令（生产务必修改） | `change-me-please` |
| `DATABASE_URL` | 数据库连接串。生产以 `postgres://` 开头 | `file:./data/blog.db` |
| `PUBLIC_SITE_URL` | 站点完整地址（RSS 与 SEO canonical，生产必填） | `https://your-domain.com` |

### 可选

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL_FALLBACK` | 备用 PostgreSQL，主库故障自动切换（60s 冷却 + 自动回切；主 Neon 从 Supabase，需用连接池串） |
| `AUTH_SECRET` | 会话 Cookie 签名密钥（≥ 32 字节随机串，缺省由 ADMIN_PASSWORD 派生） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App（Callback: `https://你的域名/api/auth/github/callback`） |
| `ADMIN_GITHUB_LOGIN` | 允许登录后台的 GitHub 用户名白名单（不区分大小写） |
| `PUBLIC_TWIKOO_ENV_ID` | Twikoo 评论后端地址；未配置时评论区自动隐藏 |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL` | Cloudflare R2 对象存储（免费 10GB、零出网费）；未配置时图片自动上传降级为仅 URL 导入 |
| `R2_S3_ENDPOINT` | R2 S3 端点，默认按 ACCOUNT_ID 推导 |

## 🗄️ 数据与存储

- **数据库双方言**：开发 SQLite（`data/blog.db`，better-sqlite3）· 生产 PostgreSQL（postgres.js，推荐 Neon）。按 `DATABASE_URL` 前缀自动切换。
- **主备故障转移**：配置 `DATABASE_URL_FALLBACK` 后，主库查询出错自动冷却（60s）切换备用库，过期自动回切（`db/breaker.ts`）。
- **内容存数据库**：文章正文为 MDX 源码存 `articles` 表，服务端经 unified 管线渲染（remark-gfm + KaTeX 公式 + Prism 高亮 + 自定义插件）。
- **图片存对象存储**：文章内嵌图（`images` 表）与影集照片（`photos` 表）统一走 **Cloudflare R2**，数据库只存元数据。

## 🧰 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动开发服务器（http://localhost:4321） |
| `pnpm build` | 生产构建（含数据迁移脚本） |
| `pnpm preview` | 本地预览生产构建 |
| `pnpm check` | `astro check` 类型检查（TS strict） |
| `pnpm test` | vitest 单元测试 |
| `pnpm db:push:dev` | SQLite schema 推送 |
| `pnpm db:generate:pg` / `pnpm db:migrate:pg` | PostgreSQL 迁移生成 / 应用 |
| `pnpm db:seed` | 灌入演示数据（幂等） |
| `pnpm db:inspect` | 命令行查看数据库内容 |
| `pnpm exec drizzle-kit studio --config=drizzle.config.sqlite.ts` | Drizzle Studio 可视化编辑数据库 |

## 📁 目录结构

```
├── db/                    # Drizzle schema（sqlite/pg 成对）· 迁移 · seed · 熔断器
├── src/
│   ├── lib/               # 领域逻辑（一域一文件）：articles / mdx / auth / theme / photos ...
│   ├── themes/            # 主题注册表 + 4 套内置主题 + _template
│   ├── layouts/           # BaseLayout / AdminLayout / Tech·Note·PhotoLayout
│   ├── components/        # mdx 注册表 · article/* · ui/*(shadcn) · admin/*(编辑器)
│   ├── pages/             # 路由：首页 / blog / doc / gallery / study / api/* ...
│   ├── scripts/           # 客户端脚本
│   └── middleware.ts      # 鉴权守卫（/admin · /edit · /gallery/upload · 受保护 API）
├── docs/                  # 设计与部署文档
├── scripts/               # 构建迁移脚本
└── data/                  # SQLite 数据库文件（gitignore）
```

## 🚢 部署

部署到 Vercel（Serverless），详细步骤见 **[docs/DEPLOY.md](docs/DEPLOY.md)**：

1. Fork / 导入本仓库到 Vercel；
2. 创建 PostgreSQL 数据库（推荐 [Neon](https://neon.tech)），配置环境变量（见上表）；
3. （可选）部署 [Twikoo](https://vercel.com/new/clone?repository-url=https://github.com/twikoojs/twikoo-vercel) 评论后端、创建 Cloudflare R2 桶（见 [docs/R2-DEPLOY.md](docs/R2-DEPLOY.md)）；
4. 触发构建，`pnpm build` 会自动执行数据迁移脚本。

## 🗺️ 路线图

- [ ] TipTap 内联编辑器（计划详见 [docs/TIPTAP-INLINE-EDIT-PLAN.md](docs/TIPTAP-INLINE-EDIT-PLAN.md)）

## 🤝 贡献

个人项目，暂不接受外部 PR，欢迎通过 Issue 反馈问题与建议。开发前请阅读 [docs/DESIGN.md](docs/DESIGN.md)（设计决策记录）与 [CLAUDE.md](CLAUDE.md)（项目约定）。

## 📄 许可证

尚未附带开源许可证（个人项目）。如需引用代码请先提 Issue 沟通。

## 🙏 致谢

- [Astro](https://astro.build) · [React](https://react.dev) · [Tailwind CSS](https://tailwindcss.com) · [Drizzle ORM](https://orm.drizzle.team) · [CodeMirror](https://codemirror.net)
- [shadcn/ui](https://ui.shadcn.com) · [Twikoo](https://twikoo.js.org) · [KaTeX](https://katex.org)
- 页脚小鹿点阵互动背景致敬 [DeepSeek Harness](https://github.com/deepseek-ai)
