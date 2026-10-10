import { useRef } from 'react';
import { clockTime, parseClockTime } from '@/cadence/entities/schedule/time-input';

export function TimeField({ label, value, onChange, allowDayEnd = false }: { label: string; value: number; onChange: (value: number) => void; allowDayEnd?: boolean }) {
  const lastClock = useRef(value < 1440 && Number.isInteger(value) ? value : 1439);
  if (Number.isInteger(value) && value < 1440) lastClock.current = value;
  return <div className="min-w-0">
    <label className="text-ink-2 block text-[12.5px]">{label}
      <input type="time" step="60" min="00:00" max="23:59" required disabled={value === 1440}
        value={clockTime(value === 1440 ? lastClock.current : value)}
        onChange={event => onChange(parseClockTime(event.target.value))}
        className="text-ink-1 surface-inset numeric mt-1 block min-h-12 w-full min-w-0 rounded-[var(--radius-hand-sm)] px-3 py-2 text-[13px]" />
    </label>
    {allowDayEnd && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={value === 1440} onChange={event => onChange(event.target.checked ? 1440 : lastClock.current)} />当天结束 24:00</label>}
  </div>;
}
