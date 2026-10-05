# Material 3 技术设计

## 当前基础与选择

Astro 7 页面与 React 19 islands 共存，Tailwind 4、Radix、CodeMirror 6 已用于现有业务。通过共享 CSS 令牌、组件语义和 DOM 根属性实现双风格，不迁移框架，不以条件挂载两个编辑器实现换肤。

全站主题已有 my-blog-theme 持久化、ThemeHead 首帧脚本和 ClientRouter 转场恢复。日程还有独立 AppearanceProvider；统一改为订阅全站主题，避免写入根节点 data-theme。自定义主题、手动字体、Markdown CSS 和全站文字 CSS 按风格分组启停，保存值不删除。

## 状态与数据

- ThemeState 增加 uiStyle，值为 inherit/classic/material3；旧对象缺字段为 inherit。
- 解析优先级为设备明确选择、服务端注入的站点默认、classic。根节点 data-ui-style 是所有样式的共同出口；data-site-ui-style 保存服务端默认。
- GET /api/ui-style 公开只返回 defaultStyle；PUT 使用 settings 权限，只接受 classic/material3，返回同样字段。响应 no-store，失败不更新 UI 的已保存状态。
- 使用 settings 表 ui_style 键，通过 dbWrite upsert；SQLite/PG 现有 settings schema 和云同步注册均已支持 KV，不迁移表结构。
- 运行时订阅 storage、系统明暗、focus/visibility 和 Astro 页面事件。转场前将解析后的属性与旧样式启停状态写入 newDocument；当前编辑器实例不销毁。

## 视觉资源与组件

@material/material-color-utilities 仅构建时生成固定色彩令牌，客户端无需运行色阶算法。Roboto/Noto Sans SC 和按需 Material Symbols 子集随静态产物打包。组件以相同 DOM 和 CSS data-slot/语义类切换；Astro 与 React 的按钮、表单、菜单、dialog 和 portal 共用状态层及 token。

Material 导航使用 <600px 底栏、600–839px 80px 导航轨、>=840px 240px 抽屉；手机安全区计入底栏，主内容和浮层避让。原导航仅在现有模式显示，权限判定仍在服务端。

## 官方依据

- [Material 3](https://m3.material.io/)
- [官方颜色生成](https://github.com/material-foundation/material-color-utilities/blob/main/dev_guide/creating_color_scheme.md)
- [触控尺寸](https://support.google.com/accessibility/android/answer/7101858?hl=en-GB)

## 验证隔离

浏览器自动化使用本地数据库副本和独立端口；设置写入、临时文章、上传与编辑验证只在副本执行。正式站验证不写正文，切换仅设置当前测试浏览器的本地偏好。部署、桌面安装及 Android 真机分别报告。
