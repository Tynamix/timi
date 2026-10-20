/** Local date-time inputs need explicit handling for missing and repeated DST times. */
export function localDateInput(ms: number): string { const date = new Date(ms); const pad = (value: number, length = 2) => String(value).padStart(length, '0'); return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`; }
export function localMinuteInput(ms: number): string { return localDateInput(ms).slice(0, -7); }
export function normalizedLocalInput(value: string): string | null {
  const match = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}.${(match[7] ?? '').padEnd(3, '0')}`;
}
export function possibleLocalTimes(value: string): number[] {
  const normalized = normalizedLocalInput(value); if (!normalized) return [];
  const base = new Date(normalized).getTime();
  // Date normalizes a nonexistent spring-forward time; reject that normalization.
  if (!Number.isFinite(base) || localDateInput(base) !== normalized) return [];
  const baseOffset = new Date(base).getTimezoneOffset(); const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 2) offsets.add(new Date(base + hours * 3600_000).getTimezoneOffset());
  return [...offsets].map(offset => base + (offset - baseOffset) * 60_000).filter(candidate => localDateInput(candidate) === normalized).sort((a, b) => a - b);
}
export function correctionLocalTimes(value: string, original: number): number[] {
  return possibleLocalTimes(value).map(candidate =>
    value === localMinuteInput(original) && new Date(candidate).getTimezoneOffset() === new Date(original).getTimezoneOffset() ? original : candidate);
}
