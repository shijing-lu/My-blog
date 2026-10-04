# Android APK 构建计划

更新日期：2026-10-01

## 1. 目标与现状

为“白衣卿相”生成可安装的 Android APK，沿用网站现有界面、账号权限和 Markdown 功能。

当前项目为 Astro SSR + React，桌面端依靠 Electron 启动 Node 服务并读写 SQLite。调查时项目没有 Android 工程。Windows 的 Electron、better-sqlite3 和 sharp 二进制无法直接用于 Android；仅打包网页静态资源不能提供现有服务端功能。

本机已发现 JDK 21、Gradle 8.13 和 Android Gradle Plugin 8.11.1 缓存；旧 Android 工程记录的 SDK 路径目前不存在，需要补齐 SDK。

## 2. 已确认的架构（2026-10-01）

用户确认：与桌面版一致，本地可用、联网可同步，将当前桌面数据放到 Android。

采用原生 WebView + Node.js Mobile 24.20.0-0 完整运行时 + Astro standalone + SQLite。Node.js Mobile 原项目只有 Node 18 发布，与 Astro 7 不兼容，改用 digidem 维护分支。SQLite 使用 better-sqlite3 13.0.3 Android N-API 预编译库，图片处理采用 sharp wasm32。页面、服务端接口与云端同步继续复用。

实施顺序：

1. 保存计划与技术文档，补齐 SDK 36 / NDK / Gradle。
2. 创建 Android 原生工程、本地运行线程与 WebView 导航。
3. 独立构建 Astro standalone 与精简依赖闭包，不加载根目录 .env，不运行生产迁移。
4. 实现系统文件上传、外部链接、启动错误和后台恢复，保留站主鉴权。
5. 桌面 SQLite 在线备份，生成独立的加密数据迁移包，手机首次启动导入。APK 不包含个人数据和凭据。
6. 构建签名 APK 至 release/android，附迁移说明和已完成/待真机确认的检查结果。

Android 代码与用户数据分目录，升级不覆盖数据；手机会话密钥独立生成。SQLite backup 包含已提交 WAL 内容，不直接复制活动数据库。当前已缓存媒体随迁移包导入；未缓存远端图片、AI、图床上传与同步需联网。日程中尚未同步的浏览器 IndexedDB 记录需先在桌面完成日程同步。

## 3. 开发顺序

按上节实施顺序执行；Android 工程位于 `android`，最低 Android 8，支持 arm64-v8a 和 x86_64。构建入口为 `setup:android`、`build:android`；独立迁移入口为 `export:android-data`。

## 4. 交付与检查边界

- 交付 Android 工程、可重复执行的构建入口、技术文档、APK 和首次使用说明。
- 构建成功及包结构/签名检查只证明安装包已产生；真机安装、软键盘、文件选择、登录回调和手机 Markdown 编辑体验需要设备确认。
- 连接真机或模拟器后再进行交互验收；未执行的验收应明确列为待确认。
- 不运行现有 Web 生产构建的数据库迁移，不覆盖桌面便携版，不改动用户文章与私密数据。

## 5. 技术依据

- [Android WebView 官方指南](https://developer.android.com/develop/ui/views/layout/webapps/webview)
- [Android 命令行构建](https://developer.android.com/studio/build/building-cmdline)
- [Android SDK 管理工具](https://developer.android.com/tools/sdkmanager)
- [AGP 8.11 兼容性说明](https://developer.android.com/build/releases/agp-8-11-0-release-notes)

## 6. 当前状态

已完成 Android 工程、本地服务载荷、加密迁移工具和 release 构建。构建与签名结果、待真机确认项见 `03-开发手册.md`。
