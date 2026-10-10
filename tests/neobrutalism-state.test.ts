import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeUiStylePreference, resolveUiStyle } from '../src/lib/ui-style';
import { heroQuoteLines } from '../src/lib/hero-quote-lines';
function surface() {
  const classes=new Set<string>();
  const root={ dataset:{siteUiStyle:'material3',theme:'graphite'} as Record<string,string>, classList:{contains:(k:string)=>classes.has(k),toggle:(k:string,on:boolean)=>on?classes.add(k):classes.delete(k)}, setAttribute(k:string,v:string){this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase())]=v;}, removeAttribute(k:string){delete this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase())];} };
  const sheets=['custom-theme-css','site-custom-css-live','md-custom-css','font-face-test'].map(id=>{const attrs=new Map<string,string>();return {id,media:'screen',hasAttribute:(k:string)=>attrs.has(k),getAttribute:(k:string)=>attrs.get(k)??null,setAttribute:(k:string,v:string)=>attrs.set(k,v)};});
  return {root,sheets,doc:Object.assign(new EventTarget(),{documentElement:root,hidden:false,querySelectorAll:()=>sheets})};
}
describe('neobrutalism state migration',()=>{
  let view:ReturnType<typeof surface>;let storage:Map<string,string>;let dark:EventTarget & {matches:boolean};let win:EventTarget;
  beforeEach(()=>{vi.resetModules();view=surface();storage=new Map();dark=Object.assign(new EventTarget(),{matches:false});const matchMedia=(q:string)=>q.includes('reduced-motion')?Object.assign(new EventTarget(),{matches:false}):dark;win=Object.assign(new EventTarget(),{matchMedia});vi.stubGlobal('window',win);vi.stubGlobal('document',view.doc);vi.stubGlobal('matchMedia',matchMedia);vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});});
  afterEach(()=>vi.unstubAllGlobals());
  it.each(['classic','material3','inherit','invalid',undefined])('ignores obsolete device/site appearance %s',legacy=>{expect(resolveUiStyle(legacy,legacy)).toBe('neobrutalism');expect(normalizeUiStylePreference(legacy)).toBe('inherit');});
  it('preserves an existing dark preference while removing legacy theme and global styles',async()=>{storage.set('my-blog-theme',JSON.stringify({themeId:'graphite',mode:'dark',uiStyle:'classic'}));const theme=await import('../src/lib/theme');expect(theme.readState()).toEqual({themeId:'',mode:'dark',uiStyle:'inherit'});theme.restoreTheme();expect(view.root.dataset.uiStyle).toBe('neobrutalism');expect(view.root.dataset.theme).toBeUndefined();expect(view.root.classList.contains('dark')).toBe(true);expect(view.sheets.map(s=>s.media)).toEqual(['not all','not all','screen','screen']);});
  it('follows system changes and cross-tab mode changes',async()=>{const theme=await import('../src/lib/theme');theme.initSystemThemeWatcher();dark.matches=true;dark.dispatchEvent(new Event('change'));expect(view.root.classList.contains('dark')).toBe(true);storage.set(theme.THEME_STORAGE_KEY,JSON.stringify({mode:'light',themeId:'terminal'}));win.dispatchEvent(Object.assign(new Event('storage'),{key:theme.THEME_STORAGE_KEY}));expect(view.root.classList.contains('dark')).toBe(false);expect(view.root.dataset.uiStyle).toBe('neobrutalism');});
  it('keeps mode through navigation when storage is denied',async()=>{vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});const theme=await import('../src/lib/theme');theme.writeState({themeId:'old',mode:'dark',uiStyle:'material3'});const incoming=surface();theme.applyThemeToDocument(incoming.doc as unknown as Document);expect(incoming.root.dataset.mode).toBe('dark');expect(incoming.root.dataset.uiStyle).toBe('neobrutalism');});
});
describe('whole-sentence quote layout',()=>{
  it.each(['无路请缨，等终军之弱冠。有怀投笔，慕宗悫之长风。','没有标点的长句'.repeat(20),'甲\n乙！丙？'])('preserves every configured character',text=>{expect(heroQuoteLines(text).join('')).toBe(text);});
});
