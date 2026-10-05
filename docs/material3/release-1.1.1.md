# Material 3 修复版 1.1.1 发布清单

日期：2026-10-05。开发和验证范围见 [显示修复验收](display-repair-verification.md)，Android 真机按用户安排后续补验。

## 更新包

| 平台 | 文件 | 字节数 | 校验/版本 |
| --- | --- | --- | --- |
| Windows x64 NSIS | `release/白衣卿相 Setup 1.1.1.exe` | 300155508 | 包内 package.json 1.1.1，62 个 CSS 与验收构建哈希一致；Escape 修正存在，临时窗口验收钩子不存在 |
| Android Release | `release/android/白衣卿相-Android-1.1.1.apk` | 96564133 | versionName 1.1.1、versionCode 6；APK v2 签名通过，与 1.1.0 签名者一致；内嵌运行载荷含最终设置修复 |

SHA256：

```text
fc8b8b2d73d4783798a7a2210d22ecf22051a98bd7c037a84341b0c5c4dfeae6  白衣卿相 Setup 1.1.1.exe
23d4a2612c5781100d48b080cac27cf67439b81876b67ae8b5911de5f36813a4  android/白衣卿相-Android-1.1.1.apk
```

校验文件：`release/material3-1.1.1.sha256`。解包验证记录：`outputs/material3-review/repair-1.1.1/artifacts/verification.json`。更新包在本地交付，不纳入源码仓库，未上传至公共下载服务器。

## 安装及网站

真实使用中的 Windows 便携客户端已替换到 1.1.1，并完成窗口验收、恢复原偏好、移除临时验收钩子与正常重启。旧程序备份 `release/material3-before-1.1.1/app`；用户配置、密钥和数据库没有替换。实际窗口 appVersion 1.1.1，Electron 44.3.0，两个风格与 22 个设置分区通过。

正式网站：[白衣卿相](https://www.byqx-blog.online/)；Material 可在当前设备外观面板切换，站点默认保持原值。应用源码部署 `dpl_F26koeNYBFAAipZpLQDgUGk9djWc` 已 Ready 和 promote；正式访客 12 组合与管理员设置 30 次验证通过。`public/desktop-version.json` 更新为 1.1.1，避免新版客户端收到旧清单的错误更新提示；清单沿用现有站点入口 URL。

Android ADB 检查没有连接设备，本轮不计真机通过。包保持原签名，供后续覆盖安装验收。
