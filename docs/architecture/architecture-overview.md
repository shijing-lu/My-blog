# My-Blog 架构总览（system-modeler + c4model/graphviz）

- 生成日期：2026-09-19；状态：**当前态**（全部来自源码/配置直接证据，除标注推断外）
- 读者：需要理解或修改本仓库的开发者 / AI agent
- 配套图：`system-architecture.dsl`（C4 上下文+容器）、`module-deps.dot`（模块依赖，Graphviz）

## 一句话架构

Astro 7 **纯 SSR**（`output:'server'`，无内容集合，文章正文存数据库文本列）+ React 19 岛屿编辑器，
一套代码**双形态分发**：Vercel Web 版（PG 主库）与 Electron 桌面版（Node standalone + 本地 SQLite），
二者由自研 **Git 式三方合并同步引擎**（`src/sync/`）打通数据。

## 分层与边界（证据）

| 层 | 位置 | 关键事实 |
| --- | --- | --- |
| 路由/页面 | `src/pages/**` | 公共页（blog/doc/moments/gallery/nav/calendar）+ admin 后台 + `settings/*` 子页 |
| API | `src/pages/api/**` | ~120 端点，逐个显式 `prerender=false`；组：内容 CRUD、doc 服务端渲染、认证、网盘、AI、desktop |
| 鉴权 | `src/middleware.ts` | 三层身份（顶级 admin_session → GitHub 授权管理员 → 访客），白名单式权限映射；API 401 / 页面 302 |
| 内容管线 | `src/lib/mdx.ts` 等 | @mdx-js evaluate + SHA-1 键 LRU 渲染缓存(100)；remark/rehype 插件链；`mdx/registry.tsx` 映射 Callout/Collapse/Tabs/Spoiler |
| 编辑器 | `src/components/admin/` | CodeMirror 6：`cm-wysiwyg.ts`(KaTeX/表格/任务)、`cm-live-preview.ts`、`LiveEditor.tsx`(500ms 防抖存草稿) |
| 数据层 | `db/` | `dialect.ts` 按 `DATABASE_URL` 前缀判 PG/SQLite；`index.ts` Proxy 动态路由 + 断路器(60s冷却) + **写操作双写镜像**；31 表双方言严格对齐 |
| 同步 | `src/sync/` | core(纯函数三方合并,LWW 按 updated_at) → adapters(SyncEndpoint 契约) → engine(逐表串行/表级断点续传/15min 上限)；30 条表策略(lww/union/remote-only/local-only/skip) |
| 对象存储 | `src/lib/object-storage.ts` | Cloudflare R2（S3 API，惰性 import）；DB 只存 key；另：Vercel Blob 仅字体、GitHub 图床 |
| 桌面 | `desktop/main.cjs` | 读 %APPDATA% 配置→注入 env→`import('dist/server/entry.mjs')` 起本地服务（仅 127.0.0.1）；preload 不暴露 Node 能力 |
| 部署 | `astro.config.mjs:27-30` | `DESKTOP=1` → `@astrojs/node` standalone；默认 `@astrojs/vercel`。**无 Cloudflare Pages/wrangler 配置**，CF 仅作 R2 |

## 关键跨边界流

1. **写作**：LiveEditor(岛) →500ms 防抖→ `api/save-draft` → db →（Web 侧）双写镜像到备库 PG。
2. **阅读**：请求 → middleware 判权限 → 页面 SSR → mdx.ts（缓存命中则跳过渲染）→ registry 组件。
3. **桌面同步**：`api/desktop/sync` 触发 → engine 逐表：本地 SQLite(ours) vs 镜像快照(base) vs 云端 PG(theirs) → 冲突表 `sync_conflicts`。

## 假设与未知

- [I] `mdx.ts → registry.tsx` 的组件绑定发生在客户端 hydration 侧（未见单点直接证据）。
- [?] `scripts/diag-*`、`prod-*` 一次性排障脚本是否仍在维护。
- [?] 桌面端口 43217 仅见于 `desktop/README.md`，`main.cjs` 实为动态探测。
- 主题系统（`src/themes/` + `theme.ts` localStorage）为纯客户端，不参与服务端渲染分支。

## 维护提示

改动后请同步更新两份图源：新增 API 组 → 更新 `module-deps.dot` 聚类；新增表 → 检查 `src/sync/tables.ts` 策略注册表是否登记。
