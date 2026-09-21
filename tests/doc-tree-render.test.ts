/**
 * 目录树同构模块契约测试
 *
 * 这些断言锁的是**服务端与客户端的共同约定**：客户端就地增删改后要拿
 * `buildDocTree` + `renderDocTree` 重绘 `[data-doc-tree-root]`，一旦标记
 * （data-* 属性 / 选择器 / 排序）与页面脚本的预期分叉，就地更新就会静默失效。
 */
import { describe, expect, it } from 'vitest';
import {
  DOC_TREE_EMPTY_HTML,
  buildDocTree,
  collectSubtreeIds,
  docFolderOptions,
  patchNodes,
  removeSubtree,
  renderDocTree,
  type DocTreeItem,
} from '../src/lib/doc-tree-render';
import { esc } from '../src/lib/html-escape';

/** 构造扁平节点 */
function node(over: Partial<DocTreeItem> & { id: string }): DocTreeItem {
  return {
    parentId: null,
    kind: 'article',
    title: over.id,
    sort: 0,
    ...over,
  };
}

describe('buildDocTree', () => {
  it('按 parentId 组装嵌套结构', () => {
    const tree = buildDocTree([
      node({ id: 'root', kind: 'folder', title: '根目录' }),
      node({ id: 'child', parentId: 'root', title: '子项' }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('root');
    expect(tree[0]!.children!.map((c) => c.id)).toEqual(['child']);
  });

  it('同级按 sort 升序', () => {
    const tree = buildDocTree([
      node({ id: 'c', sort: 3 }),
      node({ id: 'a', sort: 1 }),
      node({ id: 'b', sort: 2 }),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('sort 相同时按 createdAt 升序 —— 服务端 Date 与客户端 ISO 串必须同序', () => {
    const asDate = buildDocTree([
      node({ id: 'late', sort: 0, createdAt: new Date('2026-01-02T00:00:00Z') }),
      node({ id: 'early', sort: 0, createdAt: new Date('2026-01-01T00:00:00Z') }),
    ]);
    const asIso = buildDocTree([
      node({ id: 'late', sort: 0, createdAt: '2026-01-02T00:00:00.000Z' }),
      node({ id: 'early', sort: 0, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(asDate.map((n) => n.id)).toEqual(['early', 'late']);
    // 关键：两种形态得到**完全一致**的顺序（否则刷新后条目会跳位）
    expect(asIso.map((n) => n.id)).toEqual(asDate.map((n) => n.id));
  });

  it('父节点缺失时按根级处理（不丢节点）', () => {
    const tree = buildDocTree([node({ id: 'orphan', parentId: 'ghost' })]);
    expect(tree.map((n) => n.id)).toEqual(['orphan']);
  });

  it('自引用父节点不会造成无限递归', () => {
    const tree = buildDocTree([node({ id: 'self', parentId: 'self' })]);
    expect(tree.map((n) => n.id)).toEqual(['self']);
  });

  it('空输入返回空数组', () => {
    expect(buildDocTree([])).toEqual([]);
  });
});

describe('docFolderOptions', () => {
  it('只保留 folder，且保持传入顺序（与服务端 filter 语义一致）', () => {
    const flat = [
      node({ id: 'a', kind: 'article' }),
      node({ id: 'f2', kind: 'folder' }),
      node({ id: 'f1', kind: 'folder' }),
    ];
    expect(docFolderOptions(flat)).toEqual([
      { id: 'f2', title: 'f2' },
      { id: 'f1', title: 'f1' },
    ]);
  });
});

describe('collectSubtreeIds / removeSubtree', () => {
  const flat = [
    node({ id: 'f', kind: 'folder' }),
    node({ id: 'c1', parentId: 'f' }),
    node({ id: 'c2', parentId: 'f', kind: 'folder' }),
    node({ id: 'gc', parentId: 'c2' }),
    node({ id: 'keep' }),
  ];

  it('收集自身与全部子孙', () => {
    expect(collectSubtreeIds(flat, 'f').sort()).toEqual(['c1', 'c2', 'f', 'gc']);
  });

  it('叶子节点只收集自身', () => {
    expect(collectSubtreeIds(flat, 'keep')).toEqual(['keep']);
  });

  it('removeSubtree 移除整棵子树且不动入参', () => {
    const out = removeSubtree(flat, 'f');
    expect(out.map((n) => n.id)).toEqual(['keep']);
    expect(flat).toHaveLength(5); // 原数组未被修改
  });

  it('删除中间节点会连带其子孙（与服务端级联删除一致）', () => {
    const out = removeSubtree(flat, 'c2');
    expect(out.map((n) => n.id)).toEqual(['f', 'c1', 'keep']);
  });
});

describe('patchNodes', () => {
  it('按 id 应用部分字段更新，返回新数组', () => {
    const flat = [node({ id: 'a', title: '旧' }), node({ id: 'b' })];
    const out = patchNodes(flat, [{ id: 'a', patch: { title: '新', sort: 9 } }]);
    expect(out[0]).toMatchObject({ id: 'a', title: '新', sort: 9 });
    expect(out[1]).toBe(flat[1]); // 未命中的项保持同一引用
    expect(flat[0]!.title).toBe('旧'); // 入参未被修改
  });

  it('未知 id 不影响任何节点', () => {
    const flat = [node({ id: 'a' })];
    expect(patchNodes(flat, [{ id: 'nope', patch: { title: 'x' } }])[0]!.title).toBe('a');
  });
});

describe('renderDocTree', () => {
  const opts = { authed: true, bundleId: 'b1', activeId: 'art1' };

  it('空树输出空态（空态由渲染模块产出，不留在模板里）', () => {
    expect(renderDocTree([], opts)).toBe(DOC_TREE_EMPTY_HTML);
    expect(DOC_TREE_EMPTY_HTML).toContain('暂无内容');
  });

  it('目录渲染为 details[open][data-folder]，并带移入落点', () => {
    const html = renderDocTree(
      buildDocTree([node({ id: 'f', kind: 'folder', title: '目录' })]),
      opts,
    );
    expect(html).toContain('<details');
    expect(html).toContain('open');
    expect(html).toContain('data-folder="f"');
    expect(html).toContain('data-doc-folder-target="f"');
  });

  it('文章渲染为 a[data-article-switch]，href 带 bundleId 与 nodeId', () => {
    const html = renderDocTree(buildDocTree([node({ id: 'art1', title: '文章' })]), opts);
    expect(html).toContain('data-article-switch="art1"');
    expect(html).toContain('href="/doc/b1?article=art1"');
  });

  it('当前文章高亮（activeId 命中）', () => {
    const html = renderDocTree(buildDocTree([node({ id: 'art1' })]), opts);
    expect(html).toContain('bg-primary/10 text-primary');
  });

  it('未命中 activeId 的文章不高亮', () => {
    const html = renderDocTree(buildDocTree([node({ id: 'other' })]), opts);
    expect(html).not.toContain('bg-primary/10');
  });

  it('登录态渲染管理按钮与 draggable', () => {
    const html = renderDocTree(buildDocTree([node({ id: 'art1' })]), opts);
    for (const sel of ['data-node-edit', 'data-node-del', 'data-node-move']) {
      expect(html).toContain(sel);
    }
    expect(html).toContain('draggable="true"');
    expect(html).toContain('data-doc-node-id="art1"');
  });

  it('未登录不渲染管理按钮、draggable 与移入落点', () => {
    const html = renderDocTree(
      buildDocTree([node({ id: 'f', kind: 'folder' }), node({ id: 'art1' })]),
      { authed: false, bundleId: 'b1' },
    );
    expect(html).not.toContain('data-node-del');
    expect(html).not.toContain('data-node-edit');
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('data-doc-folder-target');
  });

  it('目录行渲染 ＋文 / ＋目，文章行不渲染', () => {
    const folderHtml = renderDocTree(buildDocTree([node({ id: 'f', kind: 'folder' })]), opts);
    expect(folderHtml).toContain('data-node-add-article="f"');
    expect(folderHtml).toContain('data-node-add-folder="f"');
    const artHtml = renderDocTree(buildDocTree([node({ id: 'art1' })]), opts);
    expect(artHtml).not.toContain('data-node-add-article');
  });

  it('标题被转义（防注入）', () => {
    const html = renderDocTree(
      buildDocTree([node({ id: 'x', title: '<img src=x onerror="alert(1)">' })]),
      opts,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('data-node-name 属性里的引号被转义（否则属性会被截断）', () => {
    const html = renderDocTree(buildDocTree([node({ id: 'x', title: 'a"b' })]), opts);
    expect(html).toContain('data-node-name="a&quot;b"');
  });

  it('嵌套层级渲染出缩进容器', () => {
    const html = renderDocTree(
      buildDocTree([
        node({ id: 'f', kind: 'folder' }),
        node({ id: 'c', parentId: 'f' }),
      ]),
      opts,
    );
    expect(html).toContain('class="ml-3 border-l border-border pl-2"');
  });
});

describe('esc', () => {
  it('转义全部五个危险字符', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('保持普通文本不变', () => {
    expect(esc('普通文本 ABC 123')).toBe('普通文本 ABC 123');
  });
});
