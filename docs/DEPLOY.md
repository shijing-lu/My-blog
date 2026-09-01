# Vercel 部署指南（My Blog）

本指南覆盖：数据库（**主备双库**：Vercel/Neon 主库 + Supabase 从库）→ 环境变量 → Giscus 配置 → Vercel 导入与构建 → 验证。

## 1. 数据库（主备双库）

- **主库**：Vercel/Neon Postgres（或你现有的 Vercel Postgres），免费档即可。
- **从库（推荐）**：Supabase 免费档，主库查询出错时自动切换（见 2 的说明）。
- 两库 schema 与数据需保持一致（建表/迁移/图片迁移都要对两个库各执行一次）。
- 图片字节存 **Cloudflare R2**（见 `docs/R2-DEPLOY.md`），DB 只存元数据。

## 2. 环境变量（Vercel → Project → Settings → Environment Variables）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | **主库**连接串（Vercel/Neon，`postgres://` 开头即走 PG） |
| `DATABASE_URL_FALLBACK` | 可选（推荐） | **从库**连接串（Supabase）。主库查询出错自动冷却 60s 并切换到本库，冷却过期自动回切主库——对限流/断连自愈，无需改代码 |
| `ADMIN_PASSWORD` | ✅ | 后台口令（务必改强密码） |
| `AUTH_SECRET` | 建议 | 会话签名密钥（随机 32+ 字符；缺省由口令派生） |
| `PUBLIC_SITE_URL` | ✅ | 你的域名，如 `https://your-blog.vercel.app` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `ADMIN_GITHUB_LOGIN` | 可选 | GitHub OAuth 登录（不配则隐藏按钮） |
| `PUBLIC_GISCUS_REPO` / `PUBLIC_GISCUS_REPO_ID` / `PUBLIC_GISCUS_CATEGORY` / `PUBLIC_GISCUS_CATEGORY_ID` | 可选 | Giscus 评论（不配则评论区隐藏） |
| `PUBLIC_GISCUS_MAPPING` / `PUBLIC_GISCUS_THEME` | 可选 | 默认 `title` / `preferred_color_scheme` |

> **Supabase 必须用「连接池」串**：`postgresql://postgres.<ref>:密码@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`
> 不要用 `db.<ref>.supabase.co` 直连串——它只有 IPv6，Vercel Serverless（IPv4-only）会 `getaddrinfo ENOTFOUND`。
> 主备一致性：应用只写当前活跃库，`settings`/`images` 等需在两库保持一致；图片字节在 R2，两库只存元数据。

## 3. Giscus 配置（想用评论则做）

1. 仓库设为**公开**并开启 **Discussions**。
2. 到 [giscus.app](https://giscus.app) 填入仓库 → 生成四项（repo / repoId / category / categoryId）→ 填进上面的环境变量。
3. 建议到 GitHub → Settings → Developer settings → OAuth Apps 建一个 OAuth App（如需 GitHub 登录）：
   - Homepage URL：`https://你的域名`
   - Callback URL：`https://你的域名/api/auth/github/callback`

## 4. 导入并部署

1. 把代码推到 GitHub。
2. Vercel → **Add New → Project** → 导入该仓库。
3. Framework Preset 会自动识别 **Astro**；Build Command `pnpm build`、Output 由 adapter 生成（无需改）。
4. 在 Vercel 项目里配置第 2 节的环境变量（所有环境）。
5. **首次部署前先建表**（**主库和从库都要建**；任选其一）：
   - 本机：`pnpm db:generate:pg && pnpm db:migrate:pg`（`DATABASE_URL` 分别指向主库、再指向从库各跑一次），或
   - 在 Vercel 构建脚本里加 `"prebuild": "drizzle-kit push --config=drizzle.config.pg.ts --force"`（简单粗暴，生产慎用），或
   - 用 Supabase 控制台 **SQL Editor** / Neon 控制台执行 `db/migrations/pg/*.sql`。
6. 点击 **Deploy**。

> 构建期建议：`pnpm build` 前无需数据库（页面为服务端运行时取数）；只有 `db:migrate`/`push` 才连库。

## 5. 部署后验证清单

- [ ] 首页正常渲染文章卡片（含封面）
- [ ] `/blog/[slug]` 三布局正常（Tech 目录 / Note 简洁 / Photo 宽幅）
- [ ] `/login` 口令登录 → `/edit/*` 写作台可用（新建/编辑/上传图片/防抖保存）
- [ ] 图片 `/api/images/[id]` 可访问
- [ ] Giscus 评论区出现（若配置）
- [ ] `/rss.xml`、`/tags/[tag]` 正常
- [ ] 换主题即时生效且刷新不闪白

## 6. 性能与体验（Lighthouse > 95 建议）

公开页保持轻量（无 React 岛；搜索/评论均为原生 JS + 自托管字体）：
- 图片加 `width/height` 或 `aspect-ratio`（封面已用 16:9 占位防 CLS）
- 走 Vercel 边缘缓存：`/api/images/[id]` 已带 `cache-control: public, max-age=31536000`
- 如需更极致：首页/详情页可加 ISR（`export const experimental_ttl`），或把大图迁移到 Vercel Blob（只改 `lib/images.ts`）

## 7. 本地调试生产行为

```bash
pnpm build
pnpm preview --port 4325   # 用生产构建跑本地服务
```
