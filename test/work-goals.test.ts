import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TrackingApplication } from '../src/core/application.js';
import { SqliteStore } from '../src/core/store.js';
import { DEFAULT_SETTINGS } from '../src/core/model.js';
import { dailyTargetMs, weeklyTargetMs } from '../src/core/work-goals.js';
import { parseWorkHours } from '../src/renderer/work-hours.js';
import { isCommand } from '../src/validation.js';
import type { WorkGoals } from '../src/shared.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const goals = (dailyHours = [1, 0, 0, 0, 0, 0, 0]): WorkGoals => ({ dailyHours, notifyDaily: true, notifyWeekly: true });
function fixture(t: TestContext, start = new Date(2026, 9, 12, 12).getTime()) {
  const directory = mkdtempSync(join(tmpdir(), 'timi-goals-'));
  const path = join(directory, 'tracking.sqlite');
  const stores: SqliteStore[] = [];
  let now = start;
  const open = () => {
    const store = new SqliteStore(path); stores.push(store);
    return { store, app: new TrackingApplication(store, () => now) };
  };
  const initial = open();
  t.after(() => { for (const store of stores) { try { store.close(); } catch {} } rmSync(directory, { recursive: true, force: true }); });
  return { ...initial, open, path, get now() { return now; }, advance(ms: number) { now += ms; },
    configure(workGoals = goals()) { return initial.app.execute({ type: 'settings', idleMinutes: 5, reminderMinutes: 10, workGoals }); },
    sample(idleMs = 0) { initial.app.sample({ idleMs, locked: false, sleeping: false }); },
  };
}

test('decimal hours accept comma and dot, zero days off, and exact 7.6-hour targets', () => {
  for (const input of ['7,6', '7.6', ' 7,6 ']) assert.equal(parseWorkHours(input), 7.6);
  assert.equal(parseWorkHours('0'), 0); assert.equal(parseWorkHours('24'), 24);
  for (const input of ['', '-1', '24.1', 'Infinity', 'NaN', '7h', '7,6.0', '1e2']) assert.equal(parseWorkHours(input), null);
  const plan = goals([7.6, 8, 8, 8, 8, 4, 0]);
  assert.equal(dailyTargetMs(plan, new Date(2026, 9, 12).getTime()), 456 * MINUTE);
  assert.equal(weeklyTargetMs(plan), 43.6 * HOUR);
  assert.equal(dailyTargetMs(plan, new Date(2026, 9, 18).getTime()), 0);
});

test('IPC and application reject malformed goals without changing saved settings', t => {
  const f = fixture(t); f.configure();
  const before = f.app.getSnapshot();
  const malformed: unknown[] = [null, {}, { ...goals(), extra: true }, { ...goals(), notifyDaily: 'yes' },
    ...[[], [8], Array(8).fill(8), [NaN, 0, 0, 0, 0, 0, 0], [Infinity, 0, 0, 0, 0, 0, 0], [-1, 0, 0, 0, 0, 0, 0], [25, 0, 0, 0, 0, 0, 0], ['8', 0, 0, 0, 0, 0, 0], Array(7)].map(dailyHours => ({ ...goals(), dailyHours }))];
  for (const workGoals of malformed) {
    const command = { type: 'settings' as const, idleMinutes: 5, reminderMinutes: 10, workGoals: workGoals as WorkGoals };
    assert.equal(isCommand(command), false);
    assert.throws(() => f.app.execute(command)); assert.deepEqual(f.app.getSnapshot(), before);
  }
  assert.equal(isCommand({ type: 'settings', idleMinutes: 5, reminderMinutes: 10, workGoals: goals() }), true);
});

test('goals persist atomically; failed settings save can be retried and old commands preserve the schedule', t => {
  const f = fixture(t); const before = f.app.getSnapshot(); const durable = f.store.load();
  f.store.db.exec("CREATE TRIGGER fail_settings BEFORE UPDATE ON timi_runtime BEGIN SELECT RAISE(ABORT, 'failure'); END");
  assert.throws(() => f.configure(goals([7.6, 8, 0, 0, 0, 4, 0])));
  assert.deepEqual(f.app.getSnapshot(), before); assert.deepEqual(f.store.load(), durable);
  f.store.db.exec('DROP TRIGGER fail_settings');
  f.configure(goals([7.6, 8, 0, 0, 0, 4, 0]));
  const settings = f.app.getSnapshot().settings;
  f.app.execute({ type: 'settings', idleMinutes: 5, reminderMinutes: 10 });
  f.app.quit(); f.store.close();
  const reopened = f.open(); assert.deepEqual(reopened.app.getSnapshot().settings, settings);
  assert.equal(reopened.app.getSnapshot().mode, 'untracked');
});

test('thresholds use confirmed milliseconds, exclude idle tails, and resolve to work or break correctly', t => {
  const f = fixture(t); f.configure(goals([1 / 60, 0, 0, 0, 0, 0, 0]));
  f.app.execute({ type: 'start', name: 'Alpha' }); f.sample();
  f.advance(MINUTE - 1); f.sample(); assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.advance(1); f.sample(MINUTE); assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.advance(5 * MINUTE); f.sample(5 * MINUTE); assert.equal(f.app.getSnapshot().mode, 'pending');
  assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.app.execute({ type: 'resolve', choice: 'break' }); assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.advance(MINUTE); f.sample();
  assert.deepEqual(f.app.getWorkGoalNotices().map(notice => notice.kind), ['day', 'week']);
});

test('clarified work and corrections can reach targets; shown notices survive restart and corrections without repeating', t => {
  const f = fixture(t); f.configure(goals([1 / 60, 0, 0, 0, 0, 0, 0]));
  const id = f.app.execute({ type: 'start', name: 'Alpha' }).active!.projectId!;
  f.advance(5 * MINUTE); f.sample(5 * MINUTE);
  f.app.execute({ type: 'resolve', choice: 'work' }); f.app.execute({ type: 'stop' });
  const notices = f.app.getWorkGoalNotices(); assert.equal(notices.length, 2);
  for (const notice of notices) f.app.acknowledgeWorkGoalNotice(notice);
  assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.app.execute({ type: 'correct', removeIds: f.app.getSnapshot().records.map(record => record.id), records: [] });
  f.app.execute({ type: 'correct', removeIds: [], records: [{ start: f.now - MINUTE, end: f.now, kind: 'work', projectId: id }] });
  assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.app.quit(); f.store.close();
  assert.deepEqual(f.open().app.getWorkGoalNotices(), []);
});

test('day and week switches are independent; no target means no notification', t => {
  const f = fixture(t); const id = f.app.execute({ type: 'createProject', name: 'Alpha' }).projects[0]!.id;
  f.app.execute({ type: 'correct', removeIds: [], records: [{ start: f.now - HOUR, end: f.now, kind: 'work', projectId: id }] });
  assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.configure({ ...goals(), notifyDaily: false }); assert.deepEqual(f.app.getWorkGoalNotices().map(n => n.kind), ['week']);
  f.configure({ ...goals(), notifyWeekly: false }); assert.deepEqual(f.app.getWorkGoalNotices().map(n => n.kind), ['day']);
  f.configure({ ...goals(), notifyDaily: false, notifyWeekly: false }); assert.deepEqual(f.app.getWorkGoalNotices(), []);
});

test('future correction endpoints cannot trigger a notification before elapsed time reaches the target', t => {
  const f = fixture(t); f.configure();
  const id = f.app.execute({ type: 'createProject', name: 'Alpha' }).projects[0]!.id;
  f.app.execute({ type: 'correct', removeIds: [], records: [{ start: f.now, end: f.now + 2 * HOUR, kind: 'work', projectId: id }] });
  assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.advance(HOUR - 1); assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.advance(1); assert.deepEqual(f.app.getWorkGoalNotices().map(n => n.workedMs), [HOUR, HOUR]);
  f.app.sample({ idleMs: 0, locked: true, sleeping: false }); assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.app.sample({ idleMs: 0, locked: false, sleeping: true }); assert.deepEqual(f.app.getWorkGoalNotices(), []);
  f.app.sample({ idleMs: 0, locked: false, sleeping: false }); assert.equal(f.app.getWorkGoalNotices().length, 2);
});

test('notification receipt failure preserves tracking and retry does not extend the durable checkpoint', t => {
  const f = fixture(t); f.configure(goals([1 / 60, 0, 0, 0, 0, 0, 0]));
  f.app.execute({ type: 'start', name: 'Alpha' });
  f.advance(30_000); f.sample(); f.app.checkpoint();
  const durable = f.store.load(); f.advance(30_000); f.sample();
  const before = f.app.getSnapshot(), notice = f.app.getWorkGoalNotices()[0]!;
  f.store.db.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON timi_goal_notices BEGIN SELECT RAISE(ABORT, 'failure'); END");
  assert.throws(() => f.app.acknowledgeWorkGoalNotice(notice));
  assert.deepEqual(f.app.getSnapshot(), before); assert.deepEqual(f.store.load(), durable);
  assert.equal(f.app.getWorkGoalNotices().length, 2);
  f.store.db.exec('DROP TRIGGER fail_notice'); f.app.acknowledgeWorkGoalNotice(notice);
  assert.deepEqual(f.store.load(), durable);
  f.store.close(); f.advance(HOUR);
  const recovered = f.open().app.getSnapshot();
  assert.equal(recovered.mode, 'untracked'); assert.equal(recovered.todayMs, 30_000); assert.equal(recovered.active, null);
});

test('local midnight and Monday reset notification periods and use only work in the new week', t => {
  const f = fixture(t, new Date(2026, 9, 18, 23).getTime());
  f.configure(goals([1, 0, 0, 0, 0, 0, 1]));
  const id = f.app.execute({ type: 'createProject', name: 'Alpha' }).projects[0]!.id;
  f.app.execute({ type: 'correct', removeIds: [], records: [{ start: f.now - HOUR, end: f.now, kind: 'work', projectId: id }] });
  const sunday = f.app.getWorkGoalNotices()[0]!; assert.equal(sunday.period, '2026-10-18'); f.app.acknowledgeWorkGoalNotice(sunday);
  f.advance(2 * HOUR);
  f.app.execute({ type: 'correct', removeIds: [], records: [{ start: f.now - 2 * HOUR, end: f.now, kind: 'work', projectId: id }] });
  const monday = f.app.getWorkGoalNotices(); assert.equal(monday.length, 1); assert.equal(monday[0]!.period, '2026-10-19');
  assert.equal(monday[0]!.workedMs, HOUR);
  f.app.acknowledgeWorkGoalNotice(monday[0]!);
  f.advance(HOUR); f.app.execute({ type: 'correct', removeIds: [], records: [{ start: f.now - HOUR, end: f.now, kind: 'work', projectId: id }] });
  assert.deepEqual(f.app.getWorkGoalNotices().map(n => [n.kind, n.period]), [['week', '2026-10-19']]);
});

test('daily thresholds use elapsed time across both DST transitions in Berlin', t => {
  const previous = process.env.TZ; process.env.TZ = 'Europe/Berlin';
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  for (const [month, date, elapsed] of [[2, 29, 2], [9, 25, 4]]) {
    const end = new Date(2026, month!, date!, 3).getTime();
    const f = fixture(t, end); f.configure(goals([0, 0, 0, 0, 0, 0, elapsed!]));
    const id = f.app.execute({ type: 'createProject', name: 'Alpha' }).projects[0]!.id;
    f.app.execute({ type: 'correct', removeIds: [], records: [{ start: new Date(2026, month!, date!).getTime(), end: end - 1, kind: 'work', projectId: id }] });
    assert.deepEqual(f.app.getWorkGoalNotices(), []);
    f.app.execute({ type: 'correct', removeIds: [], records: [{ start: end - 1, end, kind: 'work', projectId: id }] });
    assert.deepEqual(f.app.getWorkGoalNotices().map(n => n.workedMs), [elapsed! * HOUR, elapsed! * HOUR]);
  }
});

test('v1 upgrade backs up and preserves records, settings, and runtime; malformed v1 rolls back DDL', t => {
  for (const malformed of [false, true]) {
    const f = fixture(t); f.app.execute({ type: 'start', name: 'Alpha' }); f.advance(MINUTE); f.sample(); f.app.checkpoint();
    const before = f.store.load();
    f.store.db.exec('ALTER TABLE timi_settings DROP COLUMN work_goals_json; DROP TABLE timi_goal_notices; PRAGMA user_version = 1');
    if (malformed) f.store.db.exec('UPDATE timi_settings SET idle_minutes = 0');
    f.store.close();
    if (malformed) {
      assert.throws(() => new SqliteStore(f.path));
      const inspect = new DatabaseSync(f.path);
      try {
        assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version, 1);
        assert.equal(inspect.prepare('PRAGMA table_info(timi_settings)').all().some(row => row.name === 'work_goals_json'), false);
      } finally { inspect.close(); }
    } else {
      const migrated = new SqliteStore(f.path);
      try {
        assert.deepEqual(migrated.load(), before); assert.ok(migrated.migrationBackup);
        const backup = new DatabaseSync(migrated.migrationBackup!);
        try { assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 1); } finally { backup.close(); }
        assert.deepEqual(migrated.load().settings.workGoals, DEFAULT_SETTINGS.workGoals);
      } finally { migrated.close(); }
    }
  }
});
