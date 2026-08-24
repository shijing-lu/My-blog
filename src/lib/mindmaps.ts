/**
 * 思维导图数据访问层（文章绑定 / 独立导图）
 *
 * - data 存 simple-mind-map 全量 JSON（layout/root/theme/view + 节点锚点扩展）；
 * - 文章 → 导图：articleId 一对多；articleId 为 null 表示独立导图；
 * - 自动生成骨架：解析文章 Markdown 标题层级 → 树。
 */
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mindmaps } from '../../db/schema.sqlite';
import { db } from '../../db';
import type { Mindmap, MindmapMeta } from '../../db/types';

/** 解析导图 data（JSON 字符串 → 对象；损坏返回 null） */
export function parseMindmapData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 序列化导图 data（对象 → JSON 字符串） */
export function stringifyMindmapData(data: unknown): string {
  return JSON.stringify(data ?? emptyMindmapData('思维导图'));
}

/** 默认空导图（根节点 + 逻辑结构图布局） */
export function emptyMindmapData(title: string): unknown {
  return {
    layout: 'logicalStructure',
    root: { data: { text: title || '思维导图', expand: true }, children: [] },
    theme: { template: 'default', config: {} },
  };
}

/** 全部导图（按更新时间倒序），可按文章过滤；includeData 时附带 data 字段 */
export async function listMindmaps(
  articleId?: string,
  includeData = false,
): Promise<(MindmapMeta & { data?: string })[]> {
  const cols = {
    id: mindmaps.id,
    title: mindmaps.title,
    articleId: mindmaps.articleId,
    createdAt: mindmaps.createdAt,
    updatedAt: mindmaps.updatedAt,
    ...(includeData ? { data: mindmaps.data } : {}),
  };
  const rows = articleId
    ? await db.select(cols).from(mindmaps).where(eq(mindmaps.articleId, articleId)).orderBy(desc(mindmaps.updatedAt))
    : await db.select(cols).from(mindmaps).orderBy(desc(mindmaps.updatedAt));
  return rows as (MindmapMeta & { data?: string })[];
}

/** 按 id 取导图（含 data） */
export async function getMindmap(id: string): Promise<Mindmap | null> {
  const rows = await db.select().from(mindmaps).where(eq(mindmaps.id, id)).limit(1);
  return (rows[0] as Mindmap | undefined) ?? null;
}

/** 创建导图 */
export async function createMindmap(input: {
  title: string;
  articleId: string | null;
  data: string;
}): Promise<Mindmap> {
  const now = new Date();
  const rows = await db
    .insert(mindmaps)
    .values({
      id: randomUUID(),
      title: input.title,
      articleId: input.articleId,
      data: input.data,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0] as Mindmap;
}

/** 更新导图（标题/绑定/数据；更新 updatedAt） */
export async function updateMindmap(
  id: string,
  input: { title?: string; articleId?: string | null; data?: string },
): Promise<Mindmap | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.articleId !== undefined) patch.articleId = input.articleId;
  if (input.data !== undefined) patch.data = input.data;
  const rows = await db.update(mindmaps).set(patch).where(eq(mindmaps.id, id)).returning();
  return (rows[0] as Mindmap | undefined) ?? null;
}

/**
 * 在导图数据中追加「片段引用」节点（文章选中文本 → 导图）
 *
 * parentId 为空 → 追加到根节点下；否则追加到指定节点下。
 * 返回修改后的完整 data（调用方负责落库）。
 */
interface RefNode {
  data: Record<string, unknown>;
  children?: RefNode[];
}

export function addMindmapRefNode(
  data: unknown,
  input: { parentId: string | null; text: string; anchorId: string; snippet: string },
): unknown {
  const tree = data as { root?: RefNode } | null;
  const root = tree?.root;
  if (!root) return data;

  const newNode: RefNode = {
    data: {
      text: input.text.slice(0, 80),
      anchorId: input.anchorId,
      snippet: input.snippet.slice(0, 500),
      expand: true,
    },
    children: [],
  };

  // 查找目标父节点（按节点 uid/id；simple-mind-map 节点 uid 存在 data 内）
  const target = input.parentId ? findMindmapNode(root, input.parentId) : root;
  if (!target) return data;
  if (!Array.isArray(target.children)) target.children = [];
  target.children.push(newNode);
  return data;
}

/** 在导图树中按节点 id 查找（深度优先） */
function findMindmapNode(node: RefNode, id: string): RefNode | null {
  if (node.data && (node.data.uid === id || node.data.id === id)) return node;
  for (const child of node.children ?? []) {
    const hit = findMindmapNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/** 删除导图 */
export async function deleteMindmap(id: string): Promise<void> {
  await db.delete(mindmaps).where(eq(mindmaps.id, id));
}

/**
 * 从文章 Markdown 生成导图骨架（标题层级 → 分支树）
 *
 * # 一级 → 根分支；## 二级 → 子分支；更深层级递归。标题去 markdown 符号，
 * 前 3 层展开、更深折叠（保持首屏清爽）。
 */
export function generateFromArticleMarkdown(title: string, markdown: string): string {
  interface TreeNode {
    data: { text: string; expand: boolean };
    children: TreeNode[];
  }
  const root: TreeNode = { data: { text: title || '思维导图', expand: true }, children: [] };
  const stack: { level: number; node: TreeNode }[] = [{ level: 0, node: root }];

  for (const line of markdown.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (!m) continue;
    const level = m[1]!.length;
    const text = m[2]!.trim().replace(/[#*`>]/g, '').trim().slice(0, 80);
    if (!text) continue;
    // 回到正确层级：栈顶层级 >= 当前层级时弹出
    while (stack.length > 1 && stack[stack.length - 1]!.level >= level) stack.pop();
    const node: TreeNode = { data: { text, expand: level < 4 }, children: [] };
    stack[stack.length - 1]!.node.children.push(node);
    stack.push({ level, node });
  }

  return stringifyMindmapData({
    layout: 'logicalStructure',
    root,
    theme: { template: 'default', config: {} },
  });
}
