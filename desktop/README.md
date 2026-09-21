# 桌面端开发与运维手册

> 一句话：**一套源码，两条发布线**。桌面端与 Web 端共用同一份页面/组件/数据层，
> 区别只在构建产物形态与运行时环境。本文档说明"改什么、在哪改、怎么发"。

---

## 一、双端关系

| | Web 端 | 桌面端 |
|---|---|---|
| 适配器 | `vercel`（默认） | `@astrojs/node` standalone（构建时 `DESKTOP=1` 切换） |
| 运行位置 | Vercel 无服务器函数 | 用户机器本地进程 `127.0.0.1:43217`（Electron 窗口内加载） |
| 数据库 | 云端 PostgreSQL（主库 + 备库镜像写） | 本地 SQLite（local-first，读写全本地） |
| 环境变量来源 | Vercel 环境变量 / `.env` | 主进程从 `config.json` 注入（**桌面模式下 env 优先于 `.env`**） |
| 入口 | 浏览器 | Electron 窗口 + 托盘 |
| 专属代码 | 无 | `desktop/`、`src/sync/`、`scripts/` |

**关键结论**：改 Web 代码**不会**自动进桌面端（代码层面）；但**内容与配置**（文章、图片、设置、样式）会经同步引擎自动到达桌面端。

---

## 二、目录结构与职责

```
desktop/
  main.cjs             Electron 壳：配置、窗口、托盘、同步触发、对象拦截、本地库自愈
  preload.cjs          仅暴露版本号（不暴露 Node 能力）
  assets/template.db   空库模板（33 张表）
  desktop-builder.yml  electron-builder（NSIS）配置

src/sync/              同步引擎（四层，依赖只从外向内）
  core/                纯函数：三方合并规则 + 跨方言哈希归一（零 IO，单测主战场）
  adapters/            IO：SQLite 端点 / PG 端点（含备库镜像写）/ 本地对象缓存
  tables.ts            30 张表策略注册表（单一事实来源）
  engine.ts            编排：逐表串行、表级事务、镜像推进、断点续传、超时
  index.ts             对外 API + 进程内互斥状态

src/pages/api/desktop/sync.ts          同步 API（POST 启动 / GET 状态）
src/pages/api/desktop/object/[...key].ts  对象缓存路由（按需下载 R2）
```

---

## 三、改哪类代码，走哪条线

| 改动 | 影响面 | 需要的动作 |
|---|---|---|
| 页面 / 组件 / 样式 / `lib` | 双端共享 | Web 走发布线；桌面端需**重新构建 + 组装 + 分发新包** |
| `desktop/`（壳） | 仅桌面端 | 直接改 `main.cjs`，**无需重新构建 dist**（重启应用即生效） |
| `src/sync/`（引擎） | 仅桌面端（Web 无入口） | 需 `build:desktop` 重建 |
| `db/` schema | **双端共享** | sqlite + pg **两侧同时改**；再在 `src/sync/tables.ts` 登记策略 |
| `public/desktop-version.json` | Web 发布、桌面消费 | 发桌面新版时同步改版本号并 push |

### 双端一致性检查清单（很容易漏）

1. 布尔列 **必须**用 `booleanFlag`（`integer(mode:'boolean')` 会让 PG 静默存 false）
2. 新增表 → 在 `src/sync/tables.ts` 登记策略（否则**静默不参与同步**）
3. 新增 API → 在 `src/middleware.ts` 登记权限（白名单式，不登记 = 端点裸奔）
4. 云端 schema 变更 → 用**幂等 SQL** 手动迁移（`scripts/pg-add-updated-at.sql` 是范本）
5. 提交前：`astro check` + `vitest` 全绿；`astro check` 与 dev server **必须串行**

---

## 四、发布流程

### Web（分钟级）
```bash
node node_modules/astro/bin/astro.mjs check   # 0 error
node node_modules/vitest/vitest.mjs run       # 全绿
git push                                      # → Vercel 自动构建部署
```

### 桌面（发版级）
```bash
pnpm run build:desktop            # DESKTOP=1 构建 dist/
node scripts/make-desktop-bundle.mjs   # 组装自包含包 release/standalone/
# 分发：打包 release/standalone/ 为 zip（或先用 electron-builder 出 NSIS 安装包）
# 记得同步改 public/desktop-version.json 的版本号并 push
```

产物 `release/standalone/` 是**自包含**的（Electron 运行时 + `resources/app/{dist,desktop,node_modules}`），
拷到任何目录、甚至别的机器都能运行，**不依赖源码**。

---

## 四点五、发行目录说明（⚠️ 别开错文件）

`release/` 下可能同时存在多种产物，**开发期只用 `portable/`**：

| 目录 | 说明 | 用不用 |
|---|---|---|
| **`release/portable/白衣卿相.exe`** | `resources/app` 是指向**仓库**的目录联接 → **始终跑最新 `dist`**（重建后重启即是新版） | ✅ **开发期就用它** |
| `release/standalone-<版本>/` | **自包含**快照：把当时的 `dist` + 依赖**复制**进去，删掉源码也能跑；但代码**冻在复制那一刻**，之后的重建它不会更新 | 仅用于对外分发（打包流程完成前视为实验产物） |
| `release/standalone.old-*` | 旧产物改名留档（沙箱禁止批量删除，改用改名） | ❌ 可手动删 |

**判断你开的是哪一版**：看启动日志里的
`服务端 bundle 构建于：…` —— 它记录本次运行实际加载的构建时间。
若是 `portable/`，这个时间应等于最近一次 `build:desktop` 的时间。

**铁律**：`build:desktop` 之前先**退出正在运行的应用**并**杀掉所有从 dist 启动的验证服务**
（否则文件被锁会构建卡死；而运行中的实例会因资源被替换而 404 → 表现为"所有动效消失"）。
构建完成后**必须重启应用**（服务端 bundle 与前端资源只在启动时载入一次）。

## 五、更新机制

- 应用启动时 `checkVersion()` 拉取 `https://<站点>/desktop-version.json`；
  版本号不同 → 弹窗「有新版本」+「打开下载页」→ 用户**下载新包覆盖安装**。
- **数据不随包走**：本地库与配置在 `%APPDATA%\byqx-blog-desktop\` → 覆盖安装不丢数据。
- 尚未实现：electron-updater 自动增量更新（需要发布渠道 + 代码签名）。

---

## 六、排障对照表（症状 → 真因）

| 症状 | 常见真因 | 处理 |
|---|---|---|
| 双击没反应 | 已有实例在运行（单实例锁，新进程静默让位） | 托盘退出旧实例；或双击会把已有窗口前置 |
| 启动一会儿自动关闭 | `dist` 是半成品（构建被打断） | 重新完整构建（先清空 `dist`） |
| 页面空白 / 报 500 | 本地库缺列或损坏 | 应用会 `PRAGMA quick_check` + 自动隔离重建；也可删 `blog-local.db*` 重启 |
| 文章是空的 | 同步没跑成功（未登录 / 云端不可用 / CSRF） | 看 `launch.log` 里的 POST 响应码与同步报告 |
| 找不到同步按钮 | 入口在「登录后 → 设置 → 云端同步」；托盘也有「立即同步」 | 先用站主密码登录 |
| 图片不显示 / 想离线看图 | 对象缓存未命中且云端不可达 | 联网浏览一次即自动缓存到 `%APPDATA%\byqx-blog-desktop\files\` |

**统一入口**：`%APPDATA%\byqx-blog-desktop\logs\launch.log`
（记录单实例锁结果、服务就绪、窗口显示、同步 HTTP 响应与结果、未捕获异常）

---

## 七、云端数据库维护

```bash
# 主库补列（幂等，可重复执行）
node scripts/run-pg-sql.mjs --from-desktop-config scripts/pg-add-updated-at.sql
# 备库补列
node scripts/run-pg-sql.mjs --from-desktop-config --fallback scripts/pg-add-updated-at.sql
```
连接串从 `%APPDATA%\byqx-blog-desktop\config.json` 读取（不回显密码）。
⚠️ Supabase 直连主机 `db.<ref>.supabase.co` 在部分网络下不可解析，改用 pooler：
`aws-0-<region>.pooler.supabase.com:5432`，用户名需写成 `postgres.<项目ref>`。

---

## 八、用户数据位置

```
%APPDATA%\byqx-blog-desktop\
  config.json      配置（云端连接串、密钥、端口）
  blog-local.db    本地库（真正的主库；含 sync_mirror/sync_log/sync_conflicts）
  files\           R2 对象缓存（按 key 存放）
  logs\launch.log  启动与同步日志
```
