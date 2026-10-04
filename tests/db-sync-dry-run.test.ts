import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ next: 0, writes: [] as string[] }));
vi.mock('postgres', () => ({ default: () => {
  const endpoint = mock.next++;
  return {
    unsafe: async (query: string, params: unknown[] = []) => {
      if (query.includes('information_schema.columns')) return params[0] === 'settings' ? [{ column_name: 'key' }, { column_name: 'value' }, { column_name: 'updated_at' }] : [];
      if (query.startsWith('INSERT')) { mock.writes.push(query); return []; }
      if (!query.includes('FROM "settings"')) return [];
      if (query.includes(' IN (')) return [{ key: 'theme', value: 'fallback-new', updated_at: new Date('2026-10-04T00:00:00Z') }];
      return [{ id: 'theme', updated_at: new Date(endpoint === 0 ? '2026-10-03T00:00:00Z' : '2026-10-04T00:00:00Z') }];
    },
    end: async () => {},
  };
} }));
import { syncDatabases, SYNC_TABLES } from '../src/lib/db-sync';

beforeEach(() => { mock.next = 0; mock.writes.length = 0; });
describe('cloud database reconciliation', () => {
  it('dry-run reports newer fallback updates without issuing any write', async () => {
    const result = await syncDatabases({ primaryUrl: 'primary', fallbackUrl: 'fallback', apply: false });
    expect(result.find(row => row.table === 'settings')).toEqual({ table: 'settings', toPrimary: 1, toFallback: 0 });
    expect(mock.writes).toEqual([]);
  });
  it('apply uses the real primary key and copies newer fallback updates', async () => {
    await syncDatabases({ primaryUrl: 'primary', fallbackUrl: 'fallback', apply: true });
    expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0]).toContain('ON CONFLICT ("key")');
    expect(mock.writes[0]).toContain('("key", "value", "updated_at")');
  });
  it('covers all newly introduced features in cloud reconciliation', () => {
    for (const name of ['quick_notes', 'cadence_records', 'ai_conversations', 'admin_accounts', 'article_post_categories']) expect(SYNC_TABLES).toContain(name);
  });
});
