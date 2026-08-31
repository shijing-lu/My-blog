# 图片存储迁移到 Cloudflare R2 —— 上线指南（My Blog）

本指南说明如何把文章内嵌图（原 base64 存库）与影集照片（原 Vercel Blob）统一切到 **Cloudflare R2**，彻底摆脱 Vercel Blob / 读库的访问次数与流量限流。

> 本文档对应代码提交 `776ae4c`（`feat(images): 图片存储迁移到 Cloudflare R2`）。构建、迁移脚本均已随仓库推送。

---

## 1. 本次改动概览

| 项 | 旧 | 新 |
|---|---|---|
| 文章内嵌图 | `images` 表存 **base64**，`/api/images/[id]` 读库输出 | 字节存 **R2**，DB 只存元数据；`/api/images/[id]` **307 重定向**到 R2 |
| 影集照片 | `photos` 表存 **Vercel Blob** URL | 字节存 **R2**（`photos` 表记录 key/url） |
| 自定义字体 | `fonts` 表 base64 / Blob URL | 保持现状（小文件可留库） |
| 依赖 | `@vercel/blob` | 新增 `@aws-sdk/client-s3`（R2 S3 兼容） |

**关键文件**：
- `src/lib/object-storage.ts` —— R2 封装（`putObject` / `publicUrl` / `deleteObject`）。
- `src/lib/images.ts` —— `storeImage` 上传 R2（sharp 生成全尺寸 1920 + 缩略 600 两档 WebP），失败回落 base64。
- `src/pages/api/images/[id].ts` —— **双模式**：有 base64 就按需转换；R2 图就 307 重定向（`w≤600` 用缩略图、大/无 `w` 用全图）。
- `src/lib/photo-storage.ts` —— 照片上传/删除改走 R2。
- `scripts/migrate-images-to-r2.mjs`（SQLite，本机验证用）+ `scripts/migrate-images-to-r2-pg.mjs`（生产 Postgres/Supabase 用）。

> **双模式的意义**：部署新版后，**旧图片（仍为 base64）照常工作**，**新上传走 R2**。数据迁移可随后再做，不会产生空档。

---

## 2. R2 环境变量

### 2.1 需要哪些
| 变量 | 说明 |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare 账号 ID（32 位十六进制，控制台 API 面板可见） |
| `R2_ACCESS_KEY_ID` | R2 API Token 的 **Access Key ID** |
| `R2_SECRET_ACCESS_KEY` | R2 API Token 的 **Secret Access Key** |
| `R2_BUCKET` | R2 桶名（如 `byqxblog`） |
| `R2_PUBLIC_BASE_URL` | 公开访问地址：`https://<pub-xxx>.r2.dev` 或自定义域名 |

### 2.2 ⚠️ 正确映射（容易踩坑）
Code 里把 `R2_ACCESS_KEY_ID` 当作 S3 `accessKeyId`、`R2_SECRET_ACCESS_KEY` 当作 `secretAccessKey`。
Cloudflare R2 的规则是：

- **Access Key ID = 令牌的 `id`（32 位整数串）**
- **Secret Access Key = 令牌 `value` 的 SHA-256 哈希（64 位）**

即：你在 R2 创建 API Token 后，控制台会给你 `Access Key ID` 和 `Secret Access Key` 两栏。**不要把令牌本身的 `cfut_...` / `cfat_...`（那是 Cloudflare API 令牌 value）当密钥**。若你只有令牌 `value`，可用：
`Secret Access Key = sha256(令牌 value)`（如 `node -e "console.log(require('crypto').createHash('sha256').update('<令牌value>').digest('hex'))"`）。

**本地 `.env` 已写好正确映射**（`.env` 不入 git）；线上请把正确值填进 Vercel 环境变量。

---

## 3. 上线步骤

### 3.1 Vercel 环境变量
到 **Vercel → Project → Settings → Environment Variables**，按 2.1 加 5 个 `R2_*`（覆盖所有环境），并确认 `DATABASE_URL` 指向 Supabase（Postgres）。

> `.env` 不在 git 里，Vercel 看不到；这 5 个必须在 Vercel 平台配。

### 3.2 给生产库加列（Supabase）
代码会新增列，生产 `images`/`photos` 表需一致。连生产 `DATABASE_URL` 后执行：

```bash
pnpm db:generate:pg && pnpm db:migrate:pg
```

或用 Supabase 控制台 SQL 执行对应迁移。需新增列：
- `images`：`key`, `url`, `thumb_key`, `thumb_url`, `width`, `height`, `size`
- `photos`：`key`, `thumb_key`

> 若跳过这步，数据迁移脚本 `UPDATE ...` 会报缺列。

### 3.3 部署
代码已推 GitHub，若 Vercel 连了该仓库会自动触发部署；否则手动 Deploy。

部署完成后，**新上传的图片直接进 R2**；旧图片仍按 base64 路径显示，页面不坏。

### 3.4 迁生产存量数据到 R2（可选但推荐，做完才算彻底下线旧的 base64/Blob）
```bash
# 干跑预览（--database-url 填 Supabase 生产连接串，勿用本地 file: 的 SQLite）
node scripts/migrate-images-to-r2-pg.mjs --database-url "postgres://user:pass@host/db?sslmode=require"

# 确认数量无误后真正执行
node scripts/migrate-images-to-r2-pg.mjs --database-url "postgres://..." --apply
```
- 脚本会：`images.data`(base64) → 上传 `images/<id>` + `images/<id>_thumb` → 清空 `data` 并写入 `key/url/thumb/dims`；
  `photos.url`(Vercel Blob) → 下载 → 上传 `photos/<id>`(+thumb) → 写入 `key/thumb_key`。
- **幂等**：已有 `key` 的行跳过；默认干跑。
- 需能访问 Supabase + R2 + 下载旧的 Blob 图，且有网络。

> 生产库迁移前建议先备份一次 Supabase。

---

## 4. 验证清单

- [ ] `/api/images/<id>` 旧 base64 图仍可访问（未迁移期）
- [ ] 新上传一张图片 → DB 中 `images.data` 为空、`url` 指向 R2；浏览器访问 `/api/images/<id>` 返回 307 到 R2
- [ ] 首页 Hero 大图 `?w=1920` 走 R2 全图；卡片缩略图 `?w=600` 走 R2 缩略图
- [ ] 影集照片从 R2 加载、删除照片时 R2 对象一并删除（按 `key`）
- [ ] `pnpm check` 0 错误；`pnpm test` 全绿；`pnpm build` 成功

---

## 5. 安全提醒

- **轮换密钥**：本文档 & 对话中若曾出现 `cfut_...` / `cfat_...` / 令牌 id 等明文，**强烈建议到 Cloudflare 轮换/删除并重建 R2 API Token**，重建后更新本地 `.env` 和 Vercel 环境变量。
- `.env` 已被 `.gitignore` 忽略，切勿提交真实密钥。

---

## 6. 回滚

- 代码层面：`git revert 776ae4c`（或 checkout 前一提交）重新部署。
- 数据层面：迁移前备份的 Supabase / 本地 `data/blog.db.bak-*` 可恢复；R2 对象删除按 `key` 静默容忍，不影响页面降级显示。
