/** Expanded hit areas use separate columns; display geometry never changes stored time. */
export function eventLayout(events: readonly { id: string; startMin: number; endMin: number }[], pixelsPerMinute: number) {
  const rows = events.map(event => {
    const height = Math.max((event.endMin - event.startMin) * pixelsPerMinute, 28);
    const top = Math.min(event.startMin * pixelsPerMinute, 1440 * pixelsPerMinute - height);
    return { id: event.id, top, height, lane: 0, columns: 1 };
  }).sort((a, b) => a.top - b.top || a.id.localeCompare(b.id));
  let group: typeof rows = [], ends: number[] = [], groupEnd = -1;
  const finish = () => { group.forEach(row => row.columns = ends.length); group = []; ends = []; };
  for (const row of rows) {
    if (row.top >= groupEnd) finish();
    let lane = ends.findIndex(end => end <= row.top);
    if (lane === -1) lane = ends.length;
    row.lane = lane; ends[lane] = row.top + row.height;
    group.push(row); groupEnd = Math.max(groupEnd, ends[lane]!);
  }
  finish();
  return new Map(rows.map(row => [row.id, row]));
}
