import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import ts from 'typescript';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="zone" tabindex="0" style="width:400px;height:100px">Paste</div><input id="title"><div id="outside">Outside</div>');
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/image-paste.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await page.addScriptTag({ type: 'module', content: source + '\nwindow.received=[]; window.unbind=bindImagePaste(document.getElementById("zone"), files=>window.received.push(files.map(f=>f.name)));' });
  await page.waitForFunction(() => typeof window.unbind === 'function');
  const paste = async (target = 'zone', textOnly = false) => page.evaluate(({ target, textOnly }) => {
    const data = new DataTransfer();
    if (textOnly) data.setData('text/plain', 'ordinary text');
    else { data.items.add(new File(['png'], 'shot.png', { type: 'image/png' })); data.items.add(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' })); }
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
    document.getElementById(target).dispatchEvent(event);
    return event.defaultPrevented;
  }, { target, textOnly });
  await page.locator('#zone').hover();
  assert.equal(await paste('outside'), true, 'hovering is enough, even if picker is not focused');
  assert.deepEqual(await page.evaluate(() => window.received), [['shot.png', 'photo.jpg']]);
  await page.locator('#title').focus();
  assert.equal(await paste('title'), false, 'text inputs keep their paste');
  assert.equal(await page.evaluate(() => window.received.length), 1);
  await page.locator('#outside').hover();
  await page.locator('#zone').focus();
  assert.equal(await paste(), true, 'keyboard focus also enables paste');
  assert.equal(await paste('zone', true), false, 'text is not swallowed');
  assert.deepEqual(await page.evaluate(() => window.received.at(-1)), []);
  await page.evaluate(() => window.unbind());
  assert.equal(await paste(), false, 'cleanup removes the listener');
  console.log('GALLERY_PASTE_OK hover/focus/multi-image/text-input/text/cleanup');
} finally { await browser.close(); }
