/** Opens the existing isolated acceptance profile, not the installed desktop data. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = process.cwd(), out = path.join(root, 'outputs/toolchain-desktop-review'), wrapper = path.join(out, 'wrapper');
if (!fs.existsSync(path.join(wrapper, 'main.cjs'))) throw Error('请先运行工具链桌面验收脚本，生成隔离预览');
const info = JSON.parse(fs.readFileSync(path.join(out, 'preview-info.json'), 'utf8'));
const launchLog = path.join(info.appData, 'byqx-blog-desktop/logs/launch.log');
const previousLog = fs.existsSync(launchLog) ? fs.readFileSync(launchLog, 'utf8').length : 0;
const log = fs.openSync(path.join(out, 'preview.log'), 'a');
const env = { ...process.env, BYQX_TOOLCHAIN_PREVIEW: '1', BYQX_START_PATH: '/toolchain', BYQX_PI_AUTH_PATH: path.join(out, 'isolated-pi.json'), BYQX_CONFIG_PATH: path.join(out, 'isolated-ai.json'), DATABASE_URL_FALLBACK: '', SYNC_DATABASE_URL_FALLBACK: '' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [wrapper], { detached: true, stdio: ['ignore', log, log], env });
fs.closeSync(log); child.unref();
for (let i = 0; i < 60; i++) {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (fs.existsSync(launchLog) && fs.readFileSync(launchLog, 'utf8').slice(previousLog).includes('页面加载完成')) { console.log('已打开“工具链 · 隔离预览”桌面窗口，示例登记与正式数据分开保存。'); break; }
  if (i === 59) throw Error('预览窗口未完成加载，请查看隔离预览日志');
}
