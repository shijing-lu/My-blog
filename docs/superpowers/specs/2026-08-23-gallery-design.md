# 影集（Gallery）子系统设计文档

> 日期：2026-08-23 · 状态：已批准（用户确认：每批统一日期、照片可选标题、Vercel Blob + URL 导入存储方案）

## 1. 背景与目标

为 My-Blog 增加**独立于博客文章**的影集子系统，用于收集"记录的好看的有意义"的照片。

- 在网站导航中跳转进入（与博客同一站点、同域名），视觉风格与博客一致（主题系统、像素风、亮暗模式、View Transitions）
- 相册主页三栏：**左侧留白**（预留，暂不放功能）｜ **中间瀑布流照片流**（按展示日期倒序）｜ **右侧时间线**（按日期从上往下，最上最新）
- 照片太多时，滚动到最底部出现**「更多」按钮**，点击加载下一页
- 上传页：**一次上传多张**，**每批统一自定义日期**（默认当日，可选择其他日期）

## 2. 用户角色与权限

| 角色 | 权限 |
| --- | --- |
| 访客 | 浏览 `/gallery`、时间线导航、灯箱查看 |
| 管理员（复用现有会话 Cookie 鉴权） | 上传照片、删除、修改日期/标题、URL 导入 |

## 3. 页面与路由

| 路由 | 类型 | 说明 |
| --- | --- | --- |
| `/gallery` | 公开 | 相册主页：瀑布流 + 右侧时间线 + 左侧留白；支持 `?offset` 加载更多 |
| `/gallery/upload` | 受保护（中间件） | 上传与管理页：多文件上传 + 日期/标题 + 管理列表（删除/改日期/改标题/URL 导入） |
| `GET /api/photos?limit=&offset=` | 公开 | 分页照片列表 + 总数 + 时间线聚合数据 |
| `POST /api/photos` | 受保护 | 上传单张（JSON：原图+缩略图 base64 + mime + takenAt + title） |
| `PATCH /api/photos/[id]` | 受保护 | 修改日期/标题 |
| `DELETE /api/photos/[id]` | 受保护 | 删除照片（DB + 存储对象） |

导航入口：`BaseLayout` 顶部导航新增「影集」链接；首页栏目区增加影集入口；登录态下相册页显示「上传」按钮。

## 4. 数据模型（`photos` 表，SQLite/PG 双方言一致）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text PK | UUID |
| url | text NOT NULL | 原图 URL（Blob 或外部 URL） |
| thumbUrl | text | 缩略图 URL（空则前端用原图） |
| title | text NOT NULL DEFAULT '' | 可选标题 |
| width / height | integer | 原图宽高（瀑布流占位防 CLS） |
| takenAt | timestamp NOT NULL | **展示日期**（用户自定义，默认当日；时间线按此排序） |
| createdAt | timestamp NOT NULL | 上传时间 |

`db/types.ts` 新增 `Photo` / `NewPhoto` 类型；`db/migrations/pg` 生成 0001 迁移。

## 5. 图片存储选型

**推荐：Vercel Blob（自动上传后端）+ URL 导入模式（兼容 PicGo/GitHub）**，理由：

1. **Vercel Serverless 函数体上限 4.5MB**（[FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/function_payload_too_large)）：现有 DB base64 方案上传 >3.3MB 照片就会失败，而"记录好看的照片"多为高清大图 —— 这正是**现有 `images` 表不适合承载相册**的原因（博客插图保持现状不动）
2. Vercel Blob 已 GA（[changelog](https://vercel.com/changelog/vercel-blob-is-now-generally-available)），Hobby 免费约 500MB 存储 + CDN 分发，[Server Uploads](https://vercel.com/docs/vercel-blob/server-upload) 支持客户端直传绕开函数体限制；与 Astro/Vercel 部署同生态，接入成本低（[使用指南](https://vercel.com/kb/guide/vercel-blob)）
3. **PicGo + GitHub 图床**：Contents API 的 token 必须保密 → 只能服务器中转 → 同样撞 4.5MB 限制，且 raw.githubusercontent.com 国内访问不稳定。**因此不推荐作为自动上传后端**，但保留用户工作流：PicGo 传好后在相册页**粘贴 URL 导入**（URL 模式），两边互不冲突
4. **缩略图**：不引入服务端图像库（serverless 冷启动/包体积成本），改为**上传时浏览器 canvas 生成**（原图宽 ≤2048px 压缩到 <4MB 服务端中转，缩略图宽 800px），瀑布流加载快且占位稳定

**存储抽象**：`src/lib/photo-storage.ts` 提供 `uploadPhoto(buffer, mime) → {url, thumbUrl}` / `deletePhoto(url)`；默认 Blob 实现（`@vercel/blob`），**未配置 `BLOB_READ_WRITE_TOKEN` 时自动降级**：上传页隐藏"选择文件上传"，仅保留 URL 导入模式，保证开发环境无 token 也能完整开发/验收其余功能。

## 6. 页面设计

### 6.1 `/gallery` 相册主页（BaseLayout + 原生 JS，公开页保持轻量、零 React 岛）

- 布局：`grid lg:grid-cols-[240px_1fr_200px]`，左栏留白容器（占位文案淡化处理），中间瀑布流，右侧时间线（sticky）
- **瀑布流**：自研轻量 JS（~60 行，多列 flex 追加，照片顺序分配至最短列），响应式列数（<640px 2 列 / <1024px 3 列 / ≥1024px 4 列）。不引库、不用 CSS columns（顺序错乱），原生 CSS masonry 浏览器支持差（[对比参考](https://www.sitepoint.com/css-masonry-layout-native-grid/)）
- **加载更多**：首屏 30 张；滚动到底部出现「更多」按钮（`data-load-more`），点击 `GET /api/photos?offset=` 追加渲染；全部加载完隐藏按钮
- **时间线**：数据来自列表接口的 `timeline` 字段（按 takenAt 聚合 `{date, count}`，上最新下最旧）；点击日期 → 若该日期照片已加载则平滑滚动定位到首个匹配项，未加载则自动逐页拉取直到定位（`data-date` 锚点标记）
- **灯箱**：复用现有 `lightbox.ts`（document 委托，BaseLayout 已引入），照片挂 `data-lightbox`
- 空状态 / 加载失败重试 / 图片 `loading="lazy"` + `width/height` 占位

### 6.2 `/gallery/upload` 上传与管理页（管理员，原生 JS）

- 上传区：**日期选择器（默认当日，可选其他日期）+ 多选文件（`multiple`）+ 拖拽区 + 整批标题（可选）**；逐张 canvas 生成缩略图 → 逐张 `POST /api/photos`（进度条、失败重试）
- 管理列表：缩略图网格，每张可**修改日期/标题（PATCH）/ 删除（DELETE，confirm）**
- **URL 导入**：输入图片 URL + 日期 + 标题，客户端 `<img>` 预加载读取宽高后提交入库（PicGo 工作流）
- 复用 AdminLayout 或独立布局，样式与博客管理端一致

## 7. API 与中间件

- `GET /api/photos`：`{ photos: [{id,url,thumbUrl,title,takenAt,width,height}], total, timeline }`；`takenAt` 聚合在 JS 层完成（拉取 takenAt 列 + count，照片量级无性能问题，避免 SQLite/PG 日期函数方言差异）
- `POST /api/photos`：校验 base64/mime/大小（单张 ≤4MB 原图 + 缩略图）、日期合法性 → Blob 存储 → DB 写入
- `PATCH/DELETE /api/photos/[id]`：改元数据 / 删存储对象 + 行
- `src/middleware.ts`：`PROTECTED_API_PREFIXES` 追加 `'/api/photos'` 的**写方法**（POST/PATCH/DELETE 受保护，GET 公开；与现有 `/api/images` 同模式）

## 8. 主题与风格

- 复用 `BaseLayout`（ThemeHead/ThemeToggle/ThemeSettings/RightToolbar/ClientRouter/lightbox/copy-button 脚本全部继承）
- 像素标题、`pixel-divider`、`post-card` 风格照片卡、亮暗主题令牌自动生效

## 9. 测试与验证

- **单测**（vitest）：时间线聚合纯函数、分页参数解析、日期校验、照片存储抽象（mock）
- `pnpm check` + `pnpm test` + `pnpm build` 全绿
- 无头浏览器（playwright-core + 系统 Chrome）：相册页瀑布流渲染、更多按钮分页加载、时间线定位、上传流程（mock 存储）、未配置 token 时 URL 导入降级

## 10. 里程碑

- **M1 数据层 + 存储抽象 + API**：photos 表（双方言 + PG 迁移）、photo-storage（Blob + 降级）、photos 数据访问、3 个 API、中间件
- **M2 相册主页**：瀑布流、更多按钮、时间线、灯箱、导航入口
- **M3 上传与管理页**：多文件/日期/标题/缩略图/URL 导入/删除/编辑
- **M4 收尾**：首页入口、README/docs、测试补充、check/test/build 全量验证

## 11. 明确决策与预留

- ✅ 已确认（用户选择）：每批统一日期（默认当日，可自定义）；照片带可选标题
- ✅ 存储：Vercel Blob 自动上传 + URL 导入兼容 PicGo/GitHub
- 预留：左侧留白（未来：随机照片/标签筛选/统计）；时间线点击 = 滚动定位（未来可加日期过滤模式）；未来可升级 EXIF 拍摄时间自动填充、客户端直传保留原始分辨率
