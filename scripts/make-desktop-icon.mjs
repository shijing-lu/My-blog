/** 生成桌面端应用/托盘图标（像素风「白」字徽标，512×512） */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`
<body style='margin:0;background:#17130f;display:flex;align-items:center;justify-content:center;height:100vh;'>
  <div style='position:relative;width:360px;height:360px;background:#e07b54;display:flex;align-items:center;justify-content:center;'>
    <span style="font-family:'Microsoft YaHei';font-weight:800;font-size:230px;color:#17130f;line-height:1;">白</span>
    <div style='position:absolute;left:18px;top:18px;width:26px;height:26px;background:#17130f;'></div>
    <div style='position:absolute;right:18px;bottom:18px;width:26px;height:26px;background:#17130f;'></div>
    <div style='position:absolute;left:18px;bottom:18px;width:12px;height:12px;background:#faf9f5;'></div>
    <div style='position:absolute;right:18px;top:18px;width:12px;height:12px;background:#faf9f5;'></div>
  </div>
</body>`);
await page.screenshot({ path: 'build/icon.png' });
await page.screenshot({ path: 'desktop/tray-icon.png' });
await browser.close();
console.log('[icon] build/icon.png + desktop/tray-icon.png 已生成');
