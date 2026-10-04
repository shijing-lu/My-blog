import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rows: [new Map(), new Map()], next: 0, offline: new Set<number>() }));
vi.mock('postgres', () => ({ default: () => {
  const index = mock.next++;
  const query = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (mock.offline.has(index)) throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
    const text = parts.join('?');
    if (text.includes('SELECT * FROM cadence_records')) return [...mock.rows[index]!.values()];
    if (text.includes('INSERT INTO cadence_records')) {
      mock.rows[index]!.set(values[0], { id: values[0], kind: values[1], record_id: values[2], payload: values[3], revision: values[4], updated_at: values[5] });
    }
    return [];
  });
  return Object.assign(query, { begin: (callback: (tx: unknown) => unknown) => callback(query), end: async () => {} });
} }));
import { createPgCadenceStore } from '../src/lib/cadence-store';

beforeEach(() => { mock.rows.forEach(rows => rows.clear()); mock.next = 0; mock.offline.clear(); });
const change = (value: string, revision: string | null = null) => ({ table: 'settings' as const, recordId: 'app', payload: { key: 'app', value }, baseRevision: revision });

describe('Cadence primary/fallback', () => {
  it('mirrors accepted data with identical CAS revisions, including updates', async () => {
    const store = createPgCadenceStore('postgres://primary', 'postgres://fallback');
    const first = await store.sync([change('one')]);
    expect(mock.rows[0]!.get('settings:app').revision).toBe(first.records[0]!.revision);
    expect(mock.rows[1]!.get('settings:app')).toEqual(mock.rows[0]!.get('settings:app'));
    const updated = await store.sync([change('two', first.records[0]!.revision)]);
    expect(mock.rows[1]!.get('settings:app').revision).toBe(updated.records[0]!.revision);
    expect(updated.conflicts).toEqual([]);
  });
  it('preserves a divergent replica record and returns it as a conflict', async () => {
    const store = createPgCadenceStore('postgres://primary', 'postgres://fallback');
    const first = await store.sync([change('one')]);
    mock.rows[1]!.set('settings:app', { ...mock.rows[1]!.get('settings:app'), payload: JSON.stringify({ key: 'app', value: 'divergent' }), revision: 'fallback-branch' });
    const result = await store.sync([change('two', first.records[0]!.revision)]);
    expect(result.conflicts[0]?.revision).toBe('fallback-branch');
    expect(mock.rows[1]!.get('settings:app').revision).toBe('fallback-branch');
  });
  it('reads/writes the fallback during a primary outage', async () => {
    const store = createPgCadenceStore('postgres://primary', 'postgres://fallback');
    mock.offline.add(0);
    const result = await store.sync([change('fallback value')]);
    expect(result.records).toHaveLength(1);
    expect(mock.rows[1]!.get('settings:app').revision).toBe(result.records[0]!.revision);
    expect((await store.list())[0]?.payload).toEqual({ key: 'app', value: 'fallback value' });
  });
});
