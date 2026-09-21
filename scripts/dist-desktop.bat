@echo off
REM ============================================================================
REM  桌面端打包脚本（Windows）：生成 NSIS 安装包 release\白衣卿相-*
REM
REM  前置：已执行 node scripts/make-desktop-template.mjs 与 node scripts/build-desktop.mjs
REM       （或用 pnpm run dist:desktop 串起全部步骤）
REM
REM  ⚠️ ELECTRON_RUN_AS_NODE 若被父进程（某些 IDE/终端）设为 1，electron 会以纯 Node 启动，
REM     必须清空，否则打包/运行都不对。
REM ============================================================================
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0\.."
node node_modules\electron-builder\cli.js --win nsis --config desktop-builder.yml --publish never
endlocal
