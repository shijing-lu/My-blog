# 白衣卿相 · 安卓原生

个人专用 Kotlin + Jetpack Compose 客户端。独立测试包 `com.byqx.blog.nativeapp`，与旧包共存。

当前第4阶段：保留前3阶段能力，新增首页诗词、文章筛选与正文搜索、密码解锁、Kotlin解析/Compose正文、原生公式、右侧目录、图片预览、阅读缓存与Markdown导出分享。完整编辑器、文档系统、随心录完整体验与其他模块按原计划交付。具体语法覆盖和待适配项见阶段4验收文档。

## Windows 构建

在仓库根目录执行（有 RTK 时加 `rtk` 前缀）：

```powershell
node scripts/setup-android-native.mjs
node scripts/build-android-native.mjs assembleDebug lintDebug --package
node scripts/build-android-native.mjs :app:connectedDebugAndroidTest
```

复用本地 `.android-tools/sdk` 及 JDK；setup 检查已接受的 SDK 许可，校验 SDK 与 Gradle 发布摘要。Gradle Wrapper 也可在已有 JDK/SDK 的机器使用；本机采用 JDK21执行、Java17源码目标。Version Catalog 锁定版本，不使用动态依赖。

测试前手机解锁并开启USB调试；多个设备时设置 `ANDROID_SERIAL`。debug签名仅供阶段验收，最终签名发布包在阶段16交付。

第2阶段隔离测试服务（只使用测试数据库与合成口令）：

```powershell
node scripts/native-auth-fixture.mjs
node scripts/verify-native-auth.mjs
```

等待服务打印ready后运行验证。真机新增测试需要ADB reverse 4322/4323，测试地址与口令见阶段2验收文档。Gradle connected任务可能清理目标APK与数据；已安装验收包的手机推荐更新两个APK后手动运行instrumentation，保留应用安装。发布服务需要部署新的移动端API及数据库迁移，APK不向旧API自动发送口令。

第3阶段隔离测试服务：

```powershell
$env:NATIVE_FIXTURE_STAGE='3'
node scripts/native-auth-fixture.mjs
```

服务ready后，另一终端运行`node scripts/verify-native-sync.mjs`。真机ADB reverse映射4332/4333，站点地址`http://127.0.0.1:4332`，合成口令与阶段2相同。测试库与AUTH_SECRET只存在`outputs/android-native/stage-03/`；不读取私人数据库。Room schema在`core/database/schemas/`，禁止使用破坏性升级或普通缓存清理删除该数据库。

第4阶段隔离测试服务：

```powershell
$env:NATIVE_FIXTURE_STAGE='4'
node scripts/native-auth-fixture.mjs
```

服务ready后运行`node scripts/verify-native-reading.mjs`。真机映射4342/4343，站点地址`http://127.0.0.1:4342`，站主合成口令`native-owner-fixture-only`，文章测试密码`reading-fixture-only`。服务导入真实API处理器，数据库仅含合成验收文章，不是私人生产资料。阅读元数据与正文在Room中加密，图片在应用私有目录中加密；升级使用显式Room v1→v2 Migration，保留随心录、草稿及outbox。

## 阶段门禁

每阶段交付后停下，用户明确测试通过并要求继续才进入下一阶段。计划、功能矩阵与验收位于 `docs/Android原生/`。未交付模块展示计划范围，不伪造数据或业务成功。
