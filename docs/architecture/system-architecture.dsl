# Structurizr DSL — My-Blog 系统架构（L1 上下文 + L2 容器）

视图源码。模型语义与 sourceRefs 见同目录 `architecture-overview.md` 与 `module-deps.dot`。
Qoder 中可直接用插件的 DSL 格式查看器打开本文件。

```dsl
workspace "My-Blog" "个人博客「白衣卿相」：Astro 7 SSR + 双数据库 + Electron 桌面端" {

    model {
        reader = person "访客" "浏览文章/文档/瞬间/相册/导航站"
        author = person "站主 / 授权管理员" "写作台、后台管理、网盘、设置；三级身份"
        desktopUser = person "桌面端用户" "离线运行本地博客实例"

        blog = softwareSystem "My-Blog 博客系统" {

            webApp = softwareSystem "Web 应用 (Astro SSR)" "output:'server'，Vercel 部署" {
                pages = container "页面路由" "src/pages：公共页 + admin 后台 + doc/moments/gallery 等"
                api = container "API 路由 (~120)" "src/pages/api/**：内容 CRUD、认证、网盘、AI、desktop/sync"
                mw = container "鉴权中间件" "src/middleware.ts：三层身份 + 白名单式权限 + 缓存策略"
                mdxLib = container "MDX 渲染管线" "src/lib/mdx*.ts：unified/remark/rehype + LRU 渲染缓存"
                dbLayer = container "数据访问层" "db/index.ts：方言路由 + 断路器 + 写操作双写镜像"
                syncEngine = container "同步引擎" "src/sync/：Git 式三方合并，SQLite↔PG，LWW/union 表策略"
                editorIslands = container "编辑器 React 岛" "src/components/admin：CodeMirror6 WYSIWYG/实时预览"
                storageLib = container "对象存储客户端" "src/lib/object-storage.ts：Cloudflare R2 (S3 兼容)"
            }

            desktop = container "Electron 桌面壳" "desktop/main.cjs：动态加载 dist/server/entry.mjs，仅绑 127.0.0.1" {
                localSqlite = container "本地 SQLite" "better-sqlite3，data/blog.db + sync_mirror/log/conflicts"
            }

            vercel = softwareSystem "Vercel" "Web 版主路径托管 (@astrojs/vercel)" {
                pgPrimary = softwareSystem "PostgreSQL 主库" "Neon/Supabase（docs/DEPLOY.md）"
                blob = softwareSystem "Vercel Blob" "仅大字体上传使用 (src/lib/blob.ts)"
            }
            pgStandby = softwareSystem "PostgreSQL 备库" "SYNC_DATABASE_URL，同步引擎镜像写入目标"
            r2 = softwareSystem "Cloudflare R2" "图片/对象统一存取，r2.dev 域名"
            github = softwareSystem "GitHub" "OAuth 授权管理员登录 + GitHub 图床"
        }
    }

    views {
        systemContext blog "L1Context" {
            include *
            autolayout lr
        }

        container webApp "L2Web" {
            include *
            autolayout lr
        }

        container blog "L2Desktop" {
            include *
            autolayout tb
        }

        theme default
    }
}
```

关系边（容器级，与 DSL 简写对应，完整带置信度的边见 `module-deps.dot`）：

- reader/author -> webApp -> vercel(托管)；api -> dbLayer -> pgPrimary
- desktopUser -> desktop -> localSqlite；desktop -> (内嵌) webApp 全部容器（standalone 构建）
- syncEngine -> localSqlite / pgStandby（读写）；dbLayer -> pgPrimary（双写镜像到备库）
- storageLib -> r2；api -> github（OAuth、图床）
