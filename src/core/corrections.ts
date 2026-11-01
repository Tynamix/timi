import type { RecordInput } from '../shared.js';

export function overlapRange(record: Pick<RecordInput, 'start' | 'end'>, input: Pick<RecordInput, 'start' | 'end'>): { start: number; end: number } | null {
  const start = Math.max(record.start, input.start), end = Math.min(record.end, input.end);
  return end > start ? { start, end } : null;
}

export function needsOverwrite(record: RecordInput, input: RecordInput): boolean {
  return record.kind === 'work' && (input.kind !== 'work' || record.projectId !== input.projectId) && overlapRange(record, input) !== null;
}

/** Subtract the replacement intervals while preserving every untouched millisecond. */
export function remainingRanges(start: number, end: number, inputs: RecordInput[]): { start: number; end: number }[] {
  let ranges = [{ start, end }];
  for (const input of inputs) ranges = ranges.flatMap(range => {
    const overlap = overlapRange(range, input);
    if (!overlap) return [range];
    return [
      ...(range.start < overlap.start ? [{ start: range.start, end: overlap.start }] : []),
      ...(overlap.end < range.end ? [{ start: overlap.end, end: range.end }] : []),
    ];
  });
  return ranges;
}
