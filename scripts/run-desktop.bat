@echo off
REM ============================================================================
REM  桌面端启动器（便携版）
REM
REM  用途：双击本文件即可启动桌面端；若你双击 exe 没反应，用这个能看到原因。
REM  说明：
REM   - 清空 ELECTRON_RUN_AS_NODE（若父环境设置过，Electron 会退化成纯 Node 模式）
REM   - 先做一次快速健康检查日志，再启动主程序
REM ============================================================================
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0.."

echo [launcher] 启动桌面端…
echo [launcher] 应用目录：%CD%
echo [launcher] 启动日志：%APPDATA%\byqx-blog-desktop\logs\launch.log

if not exist "release\portable\白衣卿相.exe" (
  echo [launcher] 未找到 release\portable\白衣卿相.exe
  echo [launcher] 请先执行：node scripts/build-desktop.mjs 并组装便携目录
  pause
  exit /b 1
)

start "" "release\portable\白衣卿相.exe"
echo [launcher] 已发出启动命令。若窗口未出现，请查看上面那个启动日志文件。
timeout /t 3 >nul
endlocal
