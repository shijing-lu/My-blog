import { describe, expect, it } from 'vitest';
import { selectAlivePhotoPage } from '../src/lib/photo-pagination';

describe('visible photo pagination', () => {
  it('keeps the collection total on each page, including the last page', async () => {
    const rows = Array.from({length:65}, (_,i)=>i);
    const pages = await Promise.all([0,30,60].map(offset=>selectAlivePhotoPage(rows,30,offset,async()=>true)));
    expect(pages.map(page=>page.total)).toEqual([65,65,65]);
    expect(pages.map(page=>page.photos.length)).toEqual([30,30,5]);
    expect(pages.flatMap(page=>page.photos)).toEqual(rows);
  });
  it('filters missing objects before applying offsets without duplicates or skipped photos', async () => {
    const rows = Array.from({length:75}, (_,i)=>i);
    const expected = rows.filter(i=>i%4!==0);
    const pages = await Promise.all([0,20,40].map(offset=>selectAlivePhotoPage(rows,20,offset,async i=>i%4!==0)));
    expect(pages.flatMap(page=>page.photos)).toEqual(expected);
    expect(pages.every(page=>page.total===expected.length)).toBe(true);
  });
  it('handles an empty collection and an offset after the end', async () => {
    expect(await selectAlivePhotoPage([],30,0,async()=>true)).toEqual({photos:[],visible:[],total:0});
    expect((await selectAlivePhotoPage([1,2],30,99,async()=>true)).photos).toEqual([]);
  });
  it('bounds concurrent storage probes while retaining input order', async () => {
    let active=0, peak=0;
    const rows=Array.from({length:50},(_,i)=>i);
    const result=await selectAlivePhotoPage(rows,50,0,async()=>{
      active++; peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,1)); active--; return true;
    });
    expect(peak).toBeLessThanOrEqual(16);
    expect(result.photos).toEqual(rows);
  });
});
