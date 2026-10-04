import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({ clients: [] as Array<{ unsafe: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> }));
vi.mock('postgres', () => ({ default: vi.fn(() => fixtures.clients.shift()) }));
import { normalizePgValue, PgEndpoint } from '../src/sync/adapters/pg-endpoint';

const metadata = [
  { column_name: 'id', data_type: 'text' },
  { column_name: 'updated_at', data_type: 'timestamp with time zone' },
  { column_name: 'enabled', data_type: 'boolean' },
  { column_name: 'payload', data_type: 'jsonb' },
];
function client() {
  return { unsafe: vi.fn(async (sql: string) => sql.startsWith('SELECT column_name') ? metadata : []), end: vi.fn(async () => {}) };
}
beforeEach(() => { fixtures.clients.length = 0; });

describe('PostgreSQL desktop uploads', () => {
  it('round-trips legacy timestamps without a timezone offset', () => {
    const date = new Date('2026-10-04T05:00:00.123Z');
    const serialized = normalizePgValue(date, 'timestamp without time zone') as string;
    expect(new Date(serialized.slice(0, -1)).getTime()).toBe(date.getTime());
    expect(normalizePgValue(date, 'timestamp with time zone')).toBe(date.toISOString());
  });
  it('batches SQLite rows and sends identical typed values to both cloud databases', async () => {
    const primary = client(), backup = client();
    fixtures.clients.push(primary, backup);
    const endpoint = new PgEndpoint({ primaryUrl: 'primary', fallbackUrl: 'backup' });
    const stamp = Date.now();
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: String(i), updated_at: stamp, enabled: i % 2, payload: { items: [i] } }));
    expect(await endpoint.upsertRows('demo', rows, ['id'])).toBe(51);
    const writes = primary.unsafe.mock.calls.filter(call => call[0].startsWith('INSERT'));
    expect(writes).toHaveLength(2);
    const values = (writes[0] as unknown as [string, unknown[]])[1];
    expect(values.slice(0, 4)).toEqual(['0', new Date(stamp).toISOString(), false, '{"items":[0]}']);
    expect(backup.unsafe.mock.calls).toEqual(writes);
    await endpoint.close();
  });
  it('keeps omitted columns omitted across different row shapes', async () => {
    const primary = client();
    fixtures.clients.push(primary);
    const endpoint = new PgEndpoint({ primaryUrl: 'primary' });
    await endpoint.upsertRows('demo', [{ id: 'one' }, { id: 'two', enabled: 1 }], ['id']);
    const writes = primary.unsafe.mock.calls.filter(call => call[0].startsWith('INSERT'));
    expect(writes[0]![0]).toContain('("id") VALUES');
    expect(writes[1]![0]).toContain('("id", "enabled") VALUES');
  });
  it('surfaces backup write failures while retaining successful primary writes', async () => {
    const primary = client(), backup = client(), warning = vi.fn();
    backup.unsafe.mockRejectedValue(new Error('backup unavailable'));
    fixtures.clients.push(primary, backup);
    const endpoint = new PgEndpoint({ primaryUrl: 'primary', fallbackUrl: 'backup', onFallbackError: warning });
    expect(await endpoint.upsertRows('demo', [{ id: 'one', updated_at: Date.now() }], ['id'])).toBe(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('backup unavailable'));
  });
});
