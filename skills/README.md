# 项目技能（agent skills）

这里放**给 AI Agent 使用的技能**（DSH / Claude Code 等按 `SKILL.md` 发现）。
与 `src/ai-skills/` 的区别：`src/ai-skills/` 是**博客内置 AI 助手**的随包技能，
桌面端启动时会优先挂载本目录（通过 `~/.agents/skills/<id>` 的目录联接）。

| 技能 | 作用 | 触发场景 |
| --- | --- | --- |
| `note-normalizer` | 判定笔记类型 + 选整理强度 + 路由 | 「整理笔记」「这篇是什么类型」「TXT 转笔记」 |
| `my-blog-structured-notes` | 五种模式的骨架、扩展语法、排错与自检 | 「写笔记」「知识手册」「例题题解」「复习笔记」 |
| `my-blog-interactive-html` | 生成 `html-interactive` 演示页 | 「做个交互演示」「公式滑块」 |

## 组合用法

```text
任意 TXT / Markdown
  → note-normalizer        判类型、定强度、决定路由
  → my-blog-structured-notes  按模式套骨架、写语法、跑自检
  → 规范化笔记 + 整理说明
```

## 安装到当前用户（Windows）

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\note-normalizer" `
  -Target "$PWD\skills\note-normalizer"
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\my-blog-structured-notes" `
  -Target "$PWD\skills\my-blog-structured-notes"
```

桌面端会自动读取 `~/.agents/skills/<id>/SKILL.md` 作为挂载技能（设置 → AI 助手可见）。
挂载优先于内置副本；没有挂载时回落到 `src/ai-skills/` 的随包版本。

## 自检脚本

```powershell
node skills/my-blog-structured-notes/scripts/check-math-delims.mjs .diag/<笔记>.md
```

专门抓「漏写 `$` 但不报错」的公式：退出码 1 表示有裸露 LaTeX，并给出行号。
