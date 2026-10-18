import assert from 'node:assert/strict';
import test from 'node:test';
import { statusTime } from '../src/status-time.js';
import type { Settings } from '../src/shared.js';

const HOUR = 3_600_000;
const monday = new Date(2026, 9, 19, 12).getTime();
const settings = (showRemaining?: boolean): Settings => ({ idleMinutes: 5, reminderMinutes: 10,
  workGoals: { dailyHours: [7.6, 8, 8, 8, 8, 4, 0], notifyDaily: true, notifyWeekly: true,
    ...(showRemaining === undefined ? {} : { showRemaining }) },
});

test('menu-bar display switches between actual work and the selected weekday remainder', () => {
  const state = { now: monday, todayMs: 2 * HOUR, settings: settings() };
  assert.deepEqual(statusTime(state), { text: '2:00', remaining: false });
  assert.deepEqual(statusTime({ ...state, settings: settings(false) }), { text: '2:00', remaining: false });
  assert.deepEqual(statusTime({ ...state, settings: settings(true) }), { text: '5:36', remaining: true });
  assert.deepEqual(statusTime({ ...state, now: new Date(2026, 9, 20, 12).getTime(), settings: settings(true) }), { text: '6:00', remaining: true });
  assert.equal(state.todayMs, 2 * HOUR);
});

test('remaining display reaches zero at the target, shows negative overtime, and falls back on days off', () => {
  const state = { now: monday, todayMs: 456 * 60_000 - 1, settings: settings(true) };
  assert.deepEqual(statusTime(state), { text: '0:01', remaining: true });
  assert.deepEqual(statusTime({ ...state, todayMs: 456 * 60_000 }), { text: '0:00', remaining: true });
  assert.deepEqual(statusTime({ ...state, todayMs: 456 * 60_000 + 1 }), { text: '−0:00', remaining: true });
  assert.deepEqual(statusTime({ ...state, todayMs: 456 * 60_000 + 59_999 }), { text: '−0:00', remaining: true });
  assert.deepEqual(statusTime({ ...state, todayMs: 456 * 60_000 + 60_000 }), { text: '−0:01', remaining: true });
  assert.deepEqual(statusTime({ ...state, todayMs: 456 * 60_000 + 15 * 60_000 }), { text: '−0:15', remaining: true });
  assert.deepEqual(statusTime({ ...state, todayMs: 10 * HOUR }), { text: '−2:24', remaining: true });
  assert.deepEqual(statusTime({ ...state, todayMs: 10 * HOUR, settings: settings(false) }), { text: '10:00', remaining: false });
  assert.deepEqual(statusTime({ ...state, now: new Date(2026, 9, 25, 12).getTime(), todayMs: HOUR + 59_999 }), { text: '1:00', remaining: false });
});

test('menu-bar remainder follows local calendar changes around the Berlin DST weekend', t => {
  const previous = process.env.TZ; process.env.TZ = 'Europe/Berlin';
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  const state = { now: new Date(2026, 9, 24, 23, 59).getTime(), todayMs: 2 * HOUR, settings: settings(true) };
  assert.deepEqual(statusTime(state), { text: '2:00', remaining: true });
  assert.deepEqual(statusTime({ ...state, now: new Date(2026, 9, 25, 0).getTime(), todayMs: 0 }), { text: '0:00', remaining: false });
  assert.deepEqual(statusTime({ ...state, now: new Date(2026, 9, 26, 0).getTime(), todayMs: 0 }), { text: '7:36', remaining: true });
});
