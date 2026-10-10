import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {renderMdx} from '../src/lib/mdx';
describe('stage4 reading fixture semantic baseline',()=>{
  it('renders all shipped extension families through the authoritative Web pipeline',async()=>{
    const result=await renderMdx(readFileSync('scripts/native-reading-fixture.md','utf8'));
    expect(result.toc.length).toBeGreaterThanOrEqual(5);
    for(const signature of ['katex','footnote','callout','collapse','tabs','columns','spoiler','grid'])expect(result.html.toLowerCase()).toContain(signature);
    expect(result.html).not.toContain('katex-error');
    expect(result.html).toContain('原生图片说明');
  });
});
