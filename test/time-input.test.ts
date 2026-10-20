import assert from 'node:assert/strict';
import test from 'node:test';
import { correctionLocalTimes, localDateInput, localMinuteInput, normalizedLocalInput, possibleLocalTimes } from '../src/renderer/time-input.js';

test('minute inputs omit seconds and milliseconds without rounding the displayed minute', () => {
  assert.equal(localMinuteInput(new Date(2026, 9, 20, 20, 40, 26, 431).getTime()), '2026-10-20T20:40');
  assert.equal(localMinuteInput(new Date(2026, 11, 31, 23, 59, 59, 999).getTime()), '2026-12-31T23:59');
});

test('minute corrections preserve untouched timestamps and set changed boundaries to whole minutes', () => {
  const original = new Date(2026, 9, 20, 20, 40, 26, 431).getTime();
  assert.deepEqual(correctionLocalTimes('2026-10-20T20:40', original), [original]);
  assert.deepEqual(correctionLocalTimes('2026-10-20T20:41', original), [new Date(2026, 9, 20, 20, 41).getTime()]);
  assert.deepEqual(correctionLocalTimes('2026-10-21T20:40', original), [new Date(2026, 9, 21, 20, 40).getTime()]);
  assert.deepEqual(correctionLocalTimes('', original), []);
  assert.deepEqual(correctionLocalTimes('2026-02-30T20:40', original), []);
  const end = original + 1_234;
  assert.equal(correctionLocalTimes(localMinuteInput(end), end)[0]! - correctionLocalTimes(localMinuteInput(original), original)[0]!, 1_234);
});

test('minute corrections preserve the original DST occurrence without hiding the other choice', t => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
  const value = '2026-10-25T02:30';
  const repeated = possibleLocalTimes(value);
  for (const index of [0, 1]) {
    const original = repeated[index]! + 14_321;
    const expected = [...repeated]; expected[index] = original;
    assert.equal(localMinuteInput(original), value);
    assert.deepEqual(correctionLocalTimes(value, original), expected);
    assert.deepEqual(correctionLocalTimes('2026-10-25T02:31', original), repeated.map(candidate => candidate + 60_000));
    assert.deepEqual(correctionLocalTimes('2026-03-29T02:30', original), []);
  }
});

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
