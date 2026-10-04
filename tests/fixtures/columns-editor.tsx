import { createRoot } from 'react-dom/client';
import MarkdownEditor from '../../src/components/admin/MarkdownEditor';
import { buildMarkdownColumns } from '../../src/lib/markdown-columns';
import '../../src/styles/global.css';

const params = new URLSearchParams(location.search);
const block = params.has('manual') ? ':::columns\n::column\n手写内容\n::column\n第二栏\n:::' : buildMarkdownColumns([
  params.has('rich') ? '| A | B |\n| --- | --- |\n| x | y |\n\n$$\nx^2\n$$' : '**左栏**\n\n第一段',
  '## 右栏\n\n- 项目一\n- 项目二',
]);
const content = `## 多栏编辑\n\n${block}\n\n尾部正文${params.has('large') ? '\n\n普通段落 **内容**，用于长文输入检查。'.repeat(4000) : ''}`;
const harness = { content, ready: false, saves: 0 };
(window as unknown as { columnHarness: typeof harness }).columnHarness = harness;
document.body.style.cssText = 'padding:24px;background:var(--color-background);color:var(--color-foreground)';
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 1000, margin: '0 auto', height: 700 }}>
    <MarkdownEditor initialContent={content} wysiwyg={!params.has('light')} variant={params.has('panel') ? 'panel' : 'ghost'}
      className="h-full" onReady={() => { harness.ready = true; }} onChange={(value) => { harness.content = value; }} onSave={() => { harness.saves += 1; }} />
  </main>,
);
