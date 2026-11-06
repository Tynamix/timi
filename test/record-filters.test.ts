import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesRecordFilters, type RecordFilters } from '../src/renderer/record-filters';

const days = Array.from({ length: 7 }, (_, index) => Date.parse(`2026-10-${19 + index}T00:00:00+02:00`));
const weekEnd = Date.parse('2026-10-26T00:00:00+01:00');
const record = { start: days[0] + 3_600_000, end: days[0] + 7_200_000, kind: 'work' as const, projectId: 'archived-project' };
const all: RecordFilters = { project: '', kind: '', day: '' };
const matches = (item = record, filters = all, pending = false) => matchesRecordFilters(item, pending, filters, days, weekEnd);

test('record filters combine project, type and day without modifying records', () => {
  const before = { ...record };
  assert.equal(matches(), true);
  assert.equal(matches(record, { project: record.projectId, kind: 'work', day: '0' }), true);
  assert.equal(matches(record, { ...all, project: 'other' }), false);
  assert.equal(matches(record, { ...all, kind: 'break' }), false);
  assert.equal(matches(record, { ...all, day: '1' }), false);
  assert.deepEqual(record, before);
});

test('projectless breaks and unresolved time remain distinct from work', () => {
  const pause = { ...record, kind: 'break' as const, projectId: null };
  assert.equal(matchesRecordFilters(pause, false, { project: 'none', kind: 'break', day: '' }, days, weekEnd), true);
  assert.equal(matches(record, { ...all, project: 'none' }), false);
  assert.equal(matches(record, { ...all, kind: 'work' }, true), false);
  assert.equal(matches(record, { ...all, kind: 'pending' }, true), true);
  assert.equal(matches(record, { ...all, kind: 'pending' }), false);
  assert.equal(matches(record, { ...all, project: record.projectId }, true), true);
});

test('overnight entries match every overlapping day and exclude exact end boundaries', () => {
  const overnight = { ...record, start: days[0] - 3_600_000, end: days[1] + 3_600_000 };
  assert.equal(matches(overnight, { ...all, day: '0' }), true);
  assert.equal(matches(overnight, { ...all, day: '1' }), true);
  assert.equal(matches({ ...overnight, end: days[1] }, { ...all, day: '1' }), false);
  assert.equal(matches({ ...overnight, start: days[1], end: days[2] }, { ...all, day: '0' }), false);
});

test('day filters include the last hour of a 25-hour DST day and stop at local midnight', () => {
  const lateSunday = { ...record, start: Date.parse('2026-10-25T23:30:00+01:00'), end: weekEnd };
  assert.equal(matches(lateSunday, { ...all, day: '6' }), true);
  assert.equal(matches({ ...lateSunday, start: weekEnd, end: weekEnd + 3_600_000 }, { ...all, day: '6' }), false);
  const shortDays = [Date.parse('2026-03-29T00:00:00+01:00')];
  const shortEnd = Date.parse('2026-03-30T00:00:00+02:00');
  assert.equal(matchesRecordFilters({ ...record, start: shortEnd, end: shortEnd + 3_600_000 }, false, { ...all, day: '0' }, shortDays, shortEnd), false);
});
