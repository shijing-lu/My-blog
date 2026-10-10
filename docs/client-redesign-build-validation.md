# 全站改造客户端构建记录（2026-10-08）

## 产物

- 桌面便携版：release/portable/白衣卿相.exe，应用版本 1.1.3；整个 portable 目录约 729 MB，移动时需携带完整目录。
- Android：release/android/白衣卿相-Android-1.1.3.apk，versionCode 8，使用原有签名；minSdk 26、targetSdk 36，arm64-v8a 和 x86_64。
- APK SHA256：3c803aa3d69c62c2eba7db14ef12d14f4bb03605552d8a8e0aa9518e92b9e098。

## 构建与运行

用户明确确认“已保存并完全退出，开始构建”后，检查无白衣卿相进程，再执行 build-desktop.mjs 和 make-desktop-bundle.mjs。没有使用会先执行数据库迁移的总构建命令。

桌面依赖闭包组装完成；打包载荷在 Windows Electron 中采用独立 appData／userData、SQLite 副本运行。11 组检查通过：密码错误反馈和 next 跳转，随心录、授权、网盘、导图列表、导图详情、归档、文档、日历、日程九个页面，暗色偏好恢复。Electron 原生下载事件确认 SVG 文件保存并包含实际内容，JS 错误为 0。运行时与便携 EXE 的 SHA256 一致。

随后 build-android.mjs 构建成功，签名 v2 验证通过、一个签名者。APK 中有 Astro server entry、首页小猫、导图导出分块及两种 ABI 的 Node／SQLite 原生库。内嵌 runtime.zip 共 20395 项，唯一数据库为初始 template.db；文章、文档、随心录、导图、动态、管理员、申请和用户均零条。桌面初始模板也为空。

保留已有大分块提醒及 Gradle 8.13 的弃用提醒；没有构建错误。证据：outputs/completion-desktop-build.log、completion-desktop-bundle.log、completion-desktop-verify.log、completion-android-build.log，以及 completion-desktop/report.json。

## 测试数据清理与预览

按用户后续要求，精确删除本地正式库中三条遗留测试记录（同一 E2E 申请在网站库、桌面库各一条，网站库“发布验收”一条）。真实文章和正式账号未批量删除。移除 61 个测试库／附属文件／fixture 清单／示例导出文件，八个预览库换成清理后的正式桌面数据副本，并清除其中远程图床和网盘配置。四个独立测试浏览器资料目录通过 Electron clearStorageData／clearCache 清理，测试配置置空。

预览 43221、43223、43224、43225、43226、43227、43228、43230 的归档均返回正常，未出现归档验收示例。当前推荐 http://127.0.0.1:43230/ 。清理统计见 outputs/test-data-cleanup.json。历史截图及日志保留作为验收证据。

## 仍需人工验收

adb devices -l 没有连接设备。APK 的签名和包内容已验证，实际 Android 安装、启动、触控、键盘和云端同步尚未真机验证。桌面实际个人库、真实网盘及云端服务也需用户验收；自动运行使用隔离数据，没有测试真实云端。
