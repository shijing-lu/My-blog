# 动效系统开发与接入说明

更新：2026-09-27。研究依据见 [技术调研](animation-system-research.md)，执行阶段见 [开发计划](animation-system-plan.md)，验证证据见 [走查清单](动效走查清单.md)。

## 1. 实现结构

| 层 | 文件 | 职责 |
|---|---|---|
| 设计令牌 | `src/styles/tokens-motion.css` | 90/160/240/360/520ms 时长、缓动、距离、控件反馈、面板和减少动效覆盖 |
| DOM 运行时 | `src/lib/motion.ts` | 可取消 WAAPI 反馈、视口入场、页面生命周期、毫秒/秒解析 |
| 主题 | `src/lib/theme.ts` | 状态持久化、触发点揭幕、快速操作竞争处理、导航和异常回退 |
| React 桥接 | `src/components/ui/use-motion-feedback.ts` | 按业务状态变化播放反馈，卸载时取消 |
| 兼容入口 | `src/lib/anim.ts` | 保留旧调用接口；计数直接显示，入场使用轻量运行时 |
| 基础接入 | `BaseLayout.astro`、`AdminLayout.astro` | 初始化一次；Astro 页面切换重建视口观察 |

没有新增运行时依赖。常规动效已移除 GSAP/ScrollTrigger 导入；依赖声明暂留，避免扩大锁文件改动。Astro ClientRouter 继续管理路由，不增加第二套路由转场。

## 2. 调用约定

先更新业务状态，再调用反馈，不等待动画完成才保存、关闭或导航：

```ts
import { feedback, revealWithin } from '@/lib/motion';

status.textContent = '保存完成';
void feedback(status, 'change');
list.append(newCard);
revealWithin(newCard);
```

`feedback` 支持 `enter/change/success/exit`，返回始终处理取消情况的 Promise。同一元素只保留本运行时的一段动画，不取消别的组件持有的动画。减少动效、页面隐藏、元素断开连接或没有 WAAPI 时直接结束。CSS 压缩后的 `.24s` 必须转换为 WAAPI 所需的 240ms，禁止直接 `parseFloat` 当毫秒。

列表使用一次性 IntersectionObserver，每批最多 6 项错开，最大延迟 120ms。内容默认可见，不预先隐藏等待观察器。新增列表项显式调用 `revealWithin`，不对整个 body 建立 MutationObserver。编辑器输入和 AI 流式内容不触发动效扫描。

## 3. 交互策略与接入位置

| 交互 | 已采用的反馈 | 关键位置 |
|---|---|---|
| 按钮/链接 | 短颜色过渡、按钮轻按压；禁用控件排除 | tokens-motion、ui/button |
| 页面导航 | 既有 Astro 转场；真实生命周期加载条，延迟出现 spinner | BaseLayout、global.css |
| 主题 | 鼠标触发点或键盘控件中心圆形揭幕 | theme、ThemeToggle、ThemeSettings |
| 卡片/热力图/随心录 | 少量视口淡入；统计值服务端直接输出 | motion、ActivityHeatmap、index |
| 搜索/标签/归档/日历 | 内容更新后的局部淡化 | SearchBox、index、archive、calendar |
| Tabs/details/代码折叠 | 展开内容短淡入；收起立即生效 | scripts/tabs、code-block-collapse、motion |
| 原生弹窗/Radix 菜单 | 面板进入；支持离散过渡时原生 dialog 短退出 | tokens-motion、confirm |
| 灯箱 | 原生 modal dialog；图片加载淡入，关闭短退出 | scripts/lightbox、LightboxImage |
| 复制/点赞 | 成功图标确认；点赞请求期间禁用并报告 busy | copy-button、callout-copy、LikeButton |
| 评论/保存/随心录 | 列表或状态文本变化反馈 | Comments、LiveEditor、DocInlineEditor、QuickNoteFloat |
| Toast | 单条替换、短进入退出、路由清理 | lib/toast |
| AI 面板 | 打开面板入场；流式文字直接显示 | AiChatFloat |
| 同步 | 后端真实 index/total 进度、阶段和结果文本 | SettingsForm |
| 锚点/工具栏/导图 | 保留定位高亮；减少动效时即时滚动 | RightToolbar、MindMapViewer、doc 等 |

React 条件面板关闭仍即时卸载；details 收起立即折叠。灯箱采用淡入，不实现跨布局共享元素缩放。上传保留真实业务状态，不伪造百分比。Electron 原生窗口启动与系统通知未增加装饰动画。

## 4. 生命周期与无障碍

- 主题初始化和系统状态恢复同步执行；只有明确的用户操作请求揭幕。旧转场的迟到回调不能覆盖新选择，也不能清理新转场的标记。
- 导航、页面隐藏、减少动效偏好变化取消持有动画；主题存储失败仍保留当前会话选择。
- 灯箱支持 Enter/Space 打开、左右切图、Esc 关闭、原生焦点限制和关闭后焦点恢复；保留之前的 body overflow。
- Toast 带 live 反馈；保存状态有 `role=status`，错误仍有文字，状态不靠动画表达。
- 减少动效关闭位移、缩放、揭幕和装饰循环，滚动直接定位。原有焦点与业务反馈仍保留。

## 5. 性能边界

移除了鼠标/点击/滚动粒子生成、全 body 抖动观察器、逐帧计数和热力图逐单元 GSAP 动画；加载条改为 transform，取消加载遮罩全屏模糊。主要动效使用 opacity/transform，主题 clip-path 是一次性例外。

没有用 headless 浏览器结果承诺所有设备 60fps。低端手机、Safari/Firefox、Electron 实机仍需帧时间与可访问性走查。远端相册图片在本地环境存在请求未完成情况，已确认不是动画隐藏，使用静态底色并在加载后反馈。

## 6. 后续开发与额度

普通跨文件开发建议 Sol / medium；已明确范围的样式或文档修订可用 Luna / low 或 medium。复杂竞争条件再提高推理强度。按文件和可复现问题提供上下文，复用本说明与走查清单，避免重复全仓扫描。模型建议来自调研，不代表已切换会话模型，也不把 API 价格换算为订阅额度。
