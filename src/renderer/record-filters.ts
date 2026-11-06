import type { RecordKind } from '../shared';

export interface RecordFilters {
  project: string;
  kind: '' | RecordKind | 'pending';
  day: string;
}

/** Match any overlap with the selected local calendar day, including overnight periods. */
export function matchesRecordFilters(
  record: { start: number; end: number; kind: RecordKind; projectId: string | null },
  pending: boolean,
  filters: RecordFilters,
  days: number[],
  weekEnd: number,
): boolean {
  if (filters.project && (filters.project === 'none' ? record.projectId !== null : record.projectId !== filters.project)) return false;
  if (filters.kind && filters.kind !== (pending ? 'pending' : record.kind)) return false;
  if (filters.day !== '') {
    const index = Number(filters.day);
    const start = days[index];
    const end = days[index + 1] ?? weekEnd;
    if (start === undefined || record.start >= end || record.end <= start) return false;
  }
  return true;
}
