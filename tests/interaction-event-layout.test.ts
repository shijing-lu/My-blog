import { describe, expect, it } from 'vitest';
import { eventLayout } from '../src/cadence/pages/schedule/ui/event-layout';

describe('minute event hit areas', () => {
  it('separates adjacent short events without altering their duration', () => {
    const events = [{ id: 'a', startMin: 547, endMin: 548 }, { id: 'b', startMin: 548, endMin: 549 }];
    const layout = eventLayout(events, 1.1);
    expect(layout.get('a')?.columns).toBe(2);
    expect(layout.get('b')?.lane).not.toBe(layout.get('a')?.lane);
    expect(layout.get('a')?.height).toBe(28);
    expect(events[0]?.endMin).toBe(548);
  });
  it('keeps the final minute inside the grid and releases unused lanes', () => {
    const layout = eventLayout([{ id: 'a', startMin: 547, endMin: 548 }, { id: 'b', startMin: 1439, endMin: 1440 }], 1.1);
    const last = layout.get('b')!;
    expect(last.top + last.height).toBeCloseTo(1440 * 1.1);
    expect(last.columns).toBe(1);
  });
});
