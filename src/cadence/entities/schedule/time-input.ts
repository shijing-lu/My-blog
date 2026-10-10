export function parseClockTime(value: string): number {
  if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hours, minutes] = value.split(':').map(Number);
  return hours! < 24 && minutes! < 60 ? hours! * 60 + minutes! : NaN;
}
export function clockTime(value: number): string {
  return Number.isInteger(value) && value >= 0 && value < 1440 ? `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : '';
}
export function validTimeSpan(start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < 1440 && end > start && end <= 1440;
}
