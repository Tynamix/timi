import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateInput, normalizedLocalInput, possibleLocalTimes } from '../src/renderer/time-input.js';

test('correction inputs reject invalid calendar times and preserve seconds and milliseconds', () => {
  assert.equal(normalizedLocalInput('2026-10-12T12:30'), '2026-10-12T12:30:00.000');
  assert.equal(normalizedLocalInput('2026-10-12T12:30:01.7'), '2026-10-12T12:30:01.700');
  for (const invalid of ['', 'tomorrow', '2026-02-30T12:00', '2026-13-12T12:00', '2026-10-12T25:00', '2026-10-12T12:00:00.1234']) {
    assert.deepEqual(possibleLocalTimes(invalid), [], invalid);
  }
});

test('German correction inputs reject the spring gap and expose both autumn occurrences', t => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
  assert.deepEqual(possibleLocalTimes('2026-03-29T02:30'), []);
  const repeated = possibleLocalTimes('2026-10-25T02:30:14.321');
  assert.equal(repeated.length, 2);
  assert.equal(repeated[1]! - repeated[0]!, 3_600_000);
  assert.deepEqual(repeated.map(localDateInput), ['2026-10-25T02:30:14.321', '2026-10-25T02:30:14.321']);
  assert.deepEqual(possibleLocalTimes('2026-10-25T03:30'), [new Date(2026, 9, 25, 3, 30).getTime()]);
});

test('correction inputs handle the half-hour DST fold on Lord Howe Island', t => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Australia/Lord_Howe';
  t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
  const repeated = possibleLocalTimes('2026-04-05T01:45');
  assert.equal(repeated.length, 2);
  assert.equal(repeated[1]! - repeated[0]!, 30 * 60_000);
  assert.deepEqual(possibleLocalTimes('2026-10-04T02:15'), []);
});
