/**
 * 主备数据库对账同步（双写失败自愈 / 熔断窗口回填）
 *
 * - 方向：主→备（主库权威）+ 备→主（熔断窗口内仅落备库的行回填，数据不丢）
 * - 性能：先轻量 diff（仅 id + updated_at/created_at），再只拉取需同步行的全量数据，批量 upsert
 * - 判定：有 updated_at 用 updated_at 新旧；无则 created_at；再无可全行比较
 * - 删除不传播（无墓碑表）——已知局限，文档化
 * - 供 scripts/sync-databases.mts 与受保护 API /api/sync-databases 共用
 */
import postgres from 'postgres';

/** 需要同步的表（应用侧全部业务表） */
export const SYNC_TABLES = [
  'articles',
  'images',
  'photos',
  'moments',
  'doc_nodes',
  'doc_categories',
  'doc_bundles',
  'doc_articles',
  'settings',
  'fonts',
  'mindmaps',
  'web_categories',
  'websites',
  'study_sessions',
  'study_tasks',
  'study_distractions',
  'checkin_tasks',
  'checkin_records',
  'todos',
  'diary_entries',
  'calendar_events',
  'comments',
  'likes',
  'github_users',
];

export interface SyncTableResult {
  table: string;
  toFallback: number;
  toPrimary: number;
  skipped?: string;
}

const CHUNK = 50;

/** 批量 upsert（多行 VALUES + ON CONFLICT，参数化） */
async function upsertRows(
  sql: ReturnType<typeof postgres>,
  table: string,
  colNames: string[],
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const idCol = 'id';
  const cols = colNames.filter((c) => c !== idCol);
  const insertCols = [`"${idCol}"`, ...cols.map((c) => `"${c}"`)].join(', ');
  const setClause = cols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const valueTuples = chunk
      .map((_, r) => `(${Array.from({ length: colNames.length }, (_, c) => `$${r * colNames.length + c + 1}`).join(', ')})`)
      .join(', ');
    const values = chunk.flatMap((row) => colNames.map((c) => row[c] ?? null));
    await sql.unsafe(
      `INSERT INTO "${table}" (${insertCols}) VALUES ${valueTuples} ON CONFLICT ("${idCol}") DO UPDATE SET ${setClause}`,
      values as unknown as Parameters<typeof sql.unsafe>[1],
    );
  }
}

/** 轻量拉取 id + 时间列（无时间列则仅 id） */
async function lightRows(
  sql: ReturnType<typeof postgres>,
  table: string,
  timeCol: string | null,
): Promise<Array<Record<string, unknown>>> {
  const cols = timeCol ? `id, "${timeCol}"` : 'id';
  return (await sql.unsafe(`SELECT ${cols} FROM "${table}"`)) as Record<string, unknown>[];
}

/** 按 id 批量拉全量行 */
async function fullRows(
  sql: ReturnType<typeof postgres>,
  table: string,
  colNames: string[],
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const selectCols = colNames.map((c) => `"${c}"`).join(', ');
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const ph = chunk.map((_, k) => `$${k + 1}`).join(', ');
    const rows = (await sql.unsafe(`SELECT ${selectCols} FROM "${table}" WHERE id IN (${ph})`, chunk)) as Record<string, unknown>[];
    for (const r of rows) map.set(String(r.id), r);
  }
  return map;
}

/** 对账一个表，返回统计 */
async function syncTable(
  p: ReturnType<typeof postgres>,
  f: ReturnType<typeof postgres>,
  table: string,
): Promise<SyncTableResult> {
  const base = { table, toFallback: 0, toPrimary: 0 };
  try {
    const cols = await p.unsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    if (cols.length === 0) return { ...base, skipped: '主库无此表' };
    const colNames = cols.map((c) => c.column_name as string);
    if (!colNames.includes('id')) return { ...base, skipped: '无 id 主键' };
    const timeCol = colNames.includes('updated_at')
      ? 'updated_at'
      : colNames.includes('created_at')
        ? 'created_at'
        : null;

    const pLight = await lightRows(p, table, timeCol);
    const fLight = await lightRows(f, table, timeCol);
    const pById = new Map(pLight.map((r) => [String(r.id), r]));
    const fById = new Map(fLight.map((r) => [String(r.id), r]));

    const newer = (a: unknown, b: unknown): boolean => {
      if (!timeCol) return false;
      const ta = new Date(String(a)).getTime();
      const tb = new Date(String(b)).getTime();
      return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb;
    };

    // diff（轻量）
    const needToFallback = pLight.filter((r) => {
      const ex = fById.get(String(r.id));
      if (!ex) return true;
      if (timeCol) return newer(r[timeCol], ex[timeCol]);
      return true; // 无时间列：保守地全量同步（数据量小）
    });
    const needToPrimary = fLight.filter((r) => !pById.has(String(r.id)));

    if (needToFallback.length === 0 && needToPrimary.length === 0) return base;

    // 拉全量（仅需要的行）
    const pFull = await fullRows(p, table, colNames, needToFallback.map((r) => String(r.id)));
    const fFull = await fullRows(f, table, colNames, needToPrimary.map((r) => String(r.id)));
    const fbRows = needToFallback
      .map((r) => pFull.get(String(r.id)))
      .filter((r): r is Record<string, unknown> => !!r);
    const prRows = needToPrimary
      .map((r) => fFull.get(String(r.id)))
      .filter((r): r is Record<string, unknown> => !!r);

    console.log(`[${table}] 主→备 ${fbRows.length} 行 · 备→主 ${prRows.length} 行`);
    await upsertRows(f, table, colNames, fbRows);
    await upsertRows(p, table, colNames, prRows);
    return { table, toFallback: fbRows.length, toPrimary: prRows.length };
  } catch (e) {
    return { ...base, skipped: (e as Error).message };
  }
}

/** 全表对账 */
export async function syncDatabases(opts: {
  primaryUrl: string;
  fallbackUrl: string;
  apply: boolean;
}): Promise<SyncTableResult[]> {
  const p = postgres(opts.primaryUrl, { max: 1, connect_timeout: 10 });
  const f = postgres(opts.fallbackUrl, { max: 1, connect_timeout: 10 });
  try {
    const results: SyncTableResult[] = [];
    for (const table of SYNC_TABLES) {
      const r = await syncTable(p, f, table);
      results.push(r);
      if (r.toFallback > 0 || r.toPrimary > 0) console.log(`  已完成 ${table}`);
    }
    return results;
  } finally {
    await p.end().catch(() => {});
    await f.end().catch(() => {});
  }
}
