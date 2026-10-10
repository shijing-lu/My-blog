import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { draw, Board, motifs } from '../outputs/full-site-design-20261008/source/draw.mjs';
import { pages } from '../outputs/full-site-design-20261008/source/catalog.mjs';
const out=path.resolve('outputs/article-workspace/design');await fs.mkdir(out,{recursive:true});
const cat=async name=>`<image href="data:image/webp;base64,${(await fs.readFile('public/images/neobrutalism/'+name+'.webp')).toString('base64')}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`;
motifs.cat=await cat('cat-peek'); motifs.rest=await cat('cat-rest');
const oldFooter=Board.prototype.footer;
Board.prototype.footer=function(y){const peek=motifs.cat;motifs.cat=motifs.rest;const result=oldFooter.call(this,y);motifs.cat=peek;return result;};
const fontSource=await fs.readFile('outputs/full-site-design-20261008/artboards/03-doc-detail-desktop.svg','utf8');
const fontCss=fontSource.match(/<style>([\s\S]*?)text\{/)[1];
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage(); const outputs=[];
function readerReference(p,width){
 const b=new Board(p,width);b.header();const x=b.m,w=b.content,editing=p.kind==='editor',tree=p.kind==='doc-reader'||editing;let y=107;
 b.text(x,y,tree?'文档与写作 / '+p.route:'首页 / '+p.title,13,500,b.muted);y+=39;
 let cx=x,cw=w;if(tree&&width<1024){
  b.panel(x,y,w,270,b.paper,16,false);b.text(x+14,y+16,editing?'全部文章':'文档目录',14,800);b.button(x+w-57,y+8,'‹',42,false,40);
  for(let i=0;i<4;i++){if(i===0)b.rect(x+9,y+63,w-18,44,'#FFF0D7',6,'none',0);b.text(x+16+(i%3)*12,y+74+i*44,['当前文章：阅读与原地编辑','▾ 开发实践','▾ 工具与方法','文章标题与长标题示例'][i],13,500,i?b.muted:b.orange);}
  y+=286;
 }else if(tree){b.panel(x,y,220,890,b.paper,16,false);b.text(x+12,y+16,'文档目录',14,800);for(let i=0;i<18;i++)b.text(x+14+(i%4)*12,y+60+i*32,(i%4?'· ':'▾ ')+'知识记录 '+(i+1),13,500,b.muted);cx+=236;cw-=236;}
 if(width>=1320){cw-=256;const rx=cx+cw+16;b.panel(rx,y,240,650,b.paper,16,false);b.text(rx+14,y+17,'当前文章目录',14,800);for(let i=0;i<16;i++)b.text(rx+15+(i%3)*12,y+61+i*32,'章节 '+(i+1)+' · 实践与记录',13,500,b.muted);}
 else b.button(x+w-44,78,'☷',42,false,42);
 b.panel(cx,y,cw,890,b.paper,20);const px=cx+22,pw=cw-44;b.motif('cat',cx+cw-84,y+12,60);
 let yy=b.para(px,y+29,p.kind==='article-note'?'把知识写给未来的自己':p.kind==='article-photo'?'山野之间，慢慢看见':'阅读与写作：清晰的结构',pw-65,width<600?25:30,40,b.ink,850);
 b.text(px,yy+10,editing?'正文已保存 · 原地编辑':'2026-10-08 · 示例内容',12,500,b.muted);yy+=52;b.line(px,yy,px+pw,yy,b.ink,2);yy+=24;
 if(tree){b.button(px,yy,'全局搜索',109);b.button(px+123,yy,'文章搜索',109);yy+=69;}
 if(p.kind==='article-photo'){b.cover(px,yy,pw,200,0);yy+=223;}
 for(let i=0;i<2;i++){b.text(px,yy,'0'+(i+1)+'  '+(i?'实践与记录':'开始之前'),22,800);yy+=46;yy=b.para(px,yy,'正文保持舒适阅读行距。目录采用适度紧凑的行高，长标题最多两行，聚焦或悬停可以查看完整文字。',pw,16,29);yy+=25;if(i===0&&p.kind!=='article-photo'){b.rect(px,yy,pw,130,b.soft,10);b.text(px+14,yy+15,'NOTE / 阅读提示',13,800);b.para(px+14,yy+49,'切换阅读与编辑时保留正文位置。现有自动保存和编辑方式保持一致。',pw-28,15,26);yy+=157;}}
 return b.finish(Math.max(y+890,yy+40));
}
async function save(name,board,width){
 const svg=board.svg.replace('__FONTS__',fontCss);await fs.writeFile(path.join(out,name+'.svg'),svg);
 await page.setViewportSize({width,height:1000});await page.setContent('<style>body{margin:0}</style>'+svg);await page.evaluate(()=>document.fonts.ready);
 await page.locator('body > svg').screenshot({path:path.join(out,name+'.png')});outputs.push(name);
}
try{
 for(const p of pages.filter(p=>['02-doc','03-doc-detail','12-blog-tech','13-blog-note','14-blog-photo','15-blog-locked','16-edit-desk','17-edit-detail','18-edit-new','19-admin'].includes(p.id)))
  for(const width of [941,390]) await save(p.id+'-'+width,['doc-reader','editor','article-tech','article-note','article-photo'].includes(p.kind)?readerReference(p,width):draw(p,width),width);
 for(const width of [1440,941,390]){
  const p={id:'03-doc-detail',title:'紧凑目录与长标题',subtitle:'多层级与大量目录示例 · 正文保持舒适阅读行距',group:'文档',kind:'doc-reader',route:'/doc/:id'};
  const b=new Board(p,width),x=b.m,w=b.content;b.header();let y=b.title(),left=width<1024?0:220,right=width>=1320?240:0;
  const cx=x+(left?left+16:0),cw=w-left-right-(left?16:0)-(right?16:0);
  if(left){b.panel(x,y,220,780,b.paper,16,false);b.text(x+12,y+16,'文档目录',14,800);b.motif('cat',x+151,y-25,55);for(let i=0;i<20;i++){
   const depth=i<6?i:i%3;let yy=y+58+i*32;
   if(i===7)b.rect(x+8,yy-2,204,32,'#FFF0D7',6,'none',0);
   if(depth)b.line(x+11+depth*12,yy,x+11+depth*12,yy+31,b.soft,1);
   b.text(x+16+depth*12,yy,(i<6?'▾ ':'· ')+(i<6?'第 '+(i+1)+' 层目录':i===7?'长标题：编辑与保存…':'文章 '+String(i+1).padStart(3,'0')),13,500,i===7?b.orange:b.ink);
  }b.text(x+12,y+743,'300 个节点 · 独立滚动',12,500,b.muted);}
  if(right){const rx=cx+cw+16;b.panel(rx,y,right,780,b.paper,16,false);b.text(rx+13,y+17,'当前文章目录',14,800);for(let i=0;i<20;i++)b.text(rx+14+(i%3)*12,y+58+i*32,`${i%3?'  ':''}${String(i+1).padStart(2,'0')} ${i%3?'实践步骤':'章节与长标题示例'}`,13,500,i===3?b.orange:b.muted);b.text(rx+13,y+743,'200 个章节 · 独立滚动',12,500,b.muted);}
  if(width<1024){b.button(cx,y,'文档目录 ▾',132);b.button(cx+150,y,'本页目录',100);y+=62;}
  b.panel(cx,y,cw,780,b.paper,20);b.motif('cat',cx+cw-99,y-32,80);
  let yy=b.para(cx+22,y+27,'文档阅读与原地编辑',cw-44,28,40,b.ink,850);b.text(cx+22,yy+15,'阅读与编辑位置连续 · 示例内容',12,400,b.muted);yy+=63;b.line(cx+22,yy,cx+cw-22,yy);yy+=27;
  for(let i=0;i<3;i++){b.text(cx+22,yy,'0'+(i+1)+'  清晰的结构',22,800);yy+=45;yy=b.para(cx+22,yy,'目录行适度紧凑，每级缩进十二像素。长标题最多两行，聚焦或悬停可以查看完整文字。正文保留舒适行距。',cw-44,16,30);yy+=28;}
  await save('compact-directories-'+width,b.finish(y+800),width);
 }
}finally{await browser.close();}
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><title>文章文档设计校正版</title><style>body{background:#fbf7ee;font-family:system-ui;padding:24px;color:#151511}a{color:#c6370c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}img{width:100%;border:2px solid;border-radius:12px}h1{font-size:28px}</style><h1>文章与文档 · 同源猫咪与紧凑目录</h1><p>沿用首页探头猫和趴猫；以下为静态示例设计。最终界面以浏览器验收截图为准。</p><main>${outputs.map(name=>`<section><h2>${name}</h2><a href="${name}.png"><img src="${name}.png" loading="lazy" alt="${name}"></a><a href="${name}.svg">SVG 源图</a></section>`).join('')}</main></html>`);
console.log('Corrected designs: '+outputs.length);
