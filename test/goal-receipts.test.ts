import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GoalReceiptQueue } from '../src/goal-receipts.js';
import { TrackingApplication } from '../src/core/application.js';
import { SqliteStore } from '../src/core/store.js';
import type { WorkGoalNotice } from '../src/shared.js';

const day: WorkGoalNotice = { kind: 'day', period: '2026-10-19', targetMs: 60_000, workedMs: 60_000 };
const week: WorkGoalNotice = { ...day, kind: 'week' };

test('receipt retries back off after failure, including additional show events, then drain once', () => {
  let now = 0, attempts = 0, fail = true;
  const errors: unknown[] = [], saved: WorkGoalNotice[] = [];
  const failure = new Error('database locked');
  const queue = new GoalReceiptQueue(notice => {
    attempts++;
    if (fail) { now += 3_000; throw failure; }
    saved.push(notice);
  }, error => errors.push(error), () => now);
  queue.recordShown(day);
  assert.equal(attempts, 1); assert.deepEqual(errors, [failure]); assert.equal(queue.has(day), true);
  queue.recordShown(week);
  for (let tick = 4_000; tick < 63_000; tick += 1_000) { now = tick; queue.flush(); }
  assert.equal(attempts, 1); assert.equal(queue.has(week), true);
  fail = false; now = 62_999; queue.flush(); assert.equal(attempts, 1);
  now = 63_000; queue.flush();
  assert.deepEqual(saved, [day, week]); assert.equal(queue.has(day), false); assert.equal(queue.has(week), false);
  queue.flush(); assert.equal(attempts, 3);
});

test('partial success keeps only unsaved receipts; repeated failure starts a fresh retry delay', () => {
  let now = 0, blocked: WorkGoalNotice | null = day;
  const calls: WorkGoalNotice[] = [], errors: unknown[] = [];
  const queue = new GoalReceiptQueue(notice => {
    calls.push(notice);
    if (notice === blocked) throw new Error('failure');
  }, error => errors.push(error), () => now);
  queue.recordShown(day); queue.recordShown(week);
  blocked = week; now = 60_000; queue.flush();
  assert.equal(queue.has(day), false); assert.equal(queue.has(week), true); assert.equal(errors.length, 2);
  blocked = null; now = 119_999; queue.flush(); assert.deepEqual(calls, [day, day, week]);
  now = 120_000; queue.flush(); queue.flush();
  assert.deepEqual(calls, [day, day, week, week]); assert.equal(queue.has(week), false);
  // New successful receipts are written immediately once the database has recovered.
  queue.recordShown({ ...day, period: '2026-10-20' }); assert.equal(calls.length, 5);
});

test('a real competing SQLite writer leaves receipts retryable and tracking/checkpoints unchanged', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timi-receipts-'));
  const path = join(directory, 'tracking.sqlite');
  const store = new SqliteStore(path);
  const lock = new DatabaseSync(path);
  t.after(() => { lock.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  let now = new Date(2026, 9, 19, 12).getTime(), monotonic = 0, attempts = 0;
  const app = new TrackingApplication(store, () => now);
  app.execute({ type: 'settings', idleMinutes: 5, reminderMinutes: 10,
    workGoals: { dailyHours: [1 / 60, 0, 0, 0, 0, 0, 0], notifyDaily: true, notifyWeekly: true } });
  app.execute({ type: 'start', name: 'Alpha' });
  now += 30_000; app.sample({ idleMs: 0, locked: false, sleeping: false }); app.checkpoint();
  const durable = store.load();
  now += 30_000; app.sample({ idleMs: 0, locked: false, sleeping: false });
  const snapshot = app.getSnapshot(), notice = app.getWorkGoalNotices()[0]!;
  const errors: unknown[] = [];
  const queue = new GoalReceiptQueue(receipt => { attempts++; app.acknowledgeWorkGoalNotice(receipt); }, error => errors.push(error), () => monotonic);
  // Use a real lock, without spending three wall-clock seconds in this controlled test.
  store.db.exec('PRAGMA busy_timeout = 0'); lock.exec('BEGIN IMMEDIATE');
  try {
    queue.recordShown(notice);
    assert.equal(errors.length, 1); assert.equal(queue.has(notice), true);
    assert.equal(store.hasWorkGoalNotice(notice), false);
    assert.deepEqual(app.getSnapshot(), snapshot); assert.deepEqual(store.load(), durable);
    for (monotonic = 1_000; monotonic < 60_000; monotonic += 1_000) queue.flush();
    assert.equal(attempts, 1);
  } finally { lock.exec('ROLLBACK'); }
  monotonic = 60_000; queue.flush(); queue.flush();
  assert.equal(attempts, 2); assert.equal(queue.has(notice), false); assert.equal(store.hasWorkGoalNotice(notice), true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM timi_goal_notices').get()!.count, 1);
  assert.deepEqual(app.getSnapshot(), snapshot); assert.deepEqual(store.load(), durable);
});
