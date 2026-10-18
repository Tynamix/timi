import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { SqliteStore } from '../src/core/store.js';
import { TrackingApplication } from '../src/core/application.js';
import { DEFAULT_SETTINGS } from '../src/core/model.js';
import type { Command, NativeSample, Snapshot, TimeRecord } from '../src/shared.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BASE = Date.UTC(2026, 9, 12, 10);

function fixture(t: TestContext, initial = BASE) {
  const directory = mkdtempSync(join(tmpdir(), 'timi-test-'));
  const path = join(directory, 'timi.sqlite');
  let now = initial;
  const stores: SqliteStore[] = [];
  const open = () => {
    const store = new SqliteStore(path);
    stores.push(store);
    return { store, app: new TrackingApplication(store, () => now) };
  };
  const first = open();
  t.after(() => {
    for (const store of stores) {
      try { store.close(); } catch { /* The test may have closed the connection to simulate a crash. */ }
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    ...first, path, open,
    get now() { return now; },
    advance(ms: number) { now += ms; },
    setTime(value: number) { now = value; },
  };
}

function sample(app: TrackingApplication, idleMs = 0, flags: Partial<NativeSample> = {}) {
  app.sample({ idleMs, locked: false, sleeping: false, ...flags });
}

function execute(app: TrackingApplication, command: Command): Snapshot {
  return app.execute(command);
}

function createProject(app: TrackingApplication, name: string) {
  const snapshot = execute(app, { type: 'start', name });
  const id = snapshot.active!.projectId!;
  execute(app, { type: 'stop' });
  return id;
}

function work(records: TimeRecord[]) {
  return records.filter(record => record.kind === 'work');
}

function duration(records: TimeRecord[]) {
  return records.reduce((sum, record) => sum + record.end - record.start, 0);
}

function activeMinutes(f: ReturnType<typeof fixture>, minutes: number, app = f.app) {
  // Short native samples model ongoing use, without assuming activity between samples.
  for (let second = 0; second < minutes * 60; second++) {
    f.advance(1_000);
    sample(app);
  }
}

test('startup is untracked, with persisted defaults and no resume shortcut', t => {
  const f = fixture(t);
  const state = f.app.getSnapshot();
  assert.equal(state.mode, 'untracked');
  assert.equal(state.active, null);
  assert.equal(state.resumeProjectId, null);
  assert.equal(state.pending, null);
  assert.equal(state.todayMs, 0);
  assert.deepEqual(state.settings, DEFAULT_SETTINGS);
});

test('trimmed case-insensitive projects preserve spelling and same-project starts are no-ops', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: '   Alpha Studio   ' });
  f.advance(30_000);
  const started = f.app.getSnapshot().active!;
  execute(f.app, { type: 'start', name: 'aLPHa STUDIO' });
  execute(f.app, { type: 'start', name: '   ' });
  const state = f.app.getSnapshot();
  assert.deepEqual(state.active, started);
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0]!.name, 'Alpha Studio');
  assert.equal(state.records.length, 0);
  assert.equal(state.todayMs, 30_000);
});

test('switching records a contiguous boundary, excluding neither nor duplicating a millisecond', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(91_234);
  execute(f.app, { type: 'start', name: 'Beta' });
  f.advance(63_789);
  execute(f.app, { type: 'stop' });
  const state = f.app.getSnapshot();
  assert.equal(state.records.length, 2);
  assert.equal(state.records[0]!.end, state.records[1]!.start);
  assert.equal(duration(state.records), 155_023);
  assert.equal(state.todayMs, 155_023);
  assert.equal(state.resumeProjectId, null);
});

test('pause creates a projectless break; activity never ends it; play resumes at the click', t => {
  const f = fixture(t);
  const project = execute(f.app, { type: 'start', name: 'Alpha' }).active!.projectId;
  f.advance(2 * MINUTE);
  execute(f.app, { type: 'pause' });
  assert.deepEqual(f.app.getSnapshot().active, { kind: 'break', start: BASE + 2 * MINUTE, projectId: null });
  f.advance(40 * MINUTE);
  sample(f.app, 30 * MINUTE, { locked: true, sleeping: true });
  sample(f.app);
  assert.equal(f.app.getSnapshot().mode, 'break');
  assert.equal(f.app.getSnapshot().pending, null);
  assert.equal(f.app.getSnapshot().reminderDue, false);
  const state = execute(f.app, { type: 'resume' });
  assert.deepEqual(state.active, { kind: 'work', start: BASE + 42 * MINUTE, projectId: project });
  assert.equal(state.todayMs, 2 * MINUTE);
  assert.equal(state.week.breakTotal, 40 * MINUTE);
});

test('starting any project ends a break; Stop clears the resume shortcut', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(MINUTE);
  execute(f.app, { type: 'pause' });
  f.advance(MINUTE);
  const state = execute(f.app, { type: 'start', name: 'Beta' });
  assert.equal(state.records[1]!.kind, 'break');
  assert.equal(state.records[1]!.end, state.active!.start);
  execute(f.app, { type: 'stop' });
  execute(f.app, { type: 'resume' });
  assert.equal(f.app.getSnapshot().mode, 'untracked');
  assert.equal(f.app.getSnapshot().resumeProjectId, null);
});

test('idle threshold removes the entire idle streak and decision time remains included', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(2 * MINUTE);
  sample(f.app);
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  let state = f.app.getSnapshot();
  assert.equal(state.mode, 'pending');
  assert.equal(state.pending!.start, BASE + 2 * MINUTE);
  assert.equal(state.todayMs, 2 * MINUTE);
  f.advance(15 * MINUTE);
  sample(f.app);
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  state = execute(f.app, { type: 'resolve', choice: 'break' });
  assert.equal(state.mode, 'work');
  assert.equal(state.active!.start, BASE + 27 * MINUTE);
  assert.equal(state.week.breakTotal, 25 * MINUTE);
  assert.equal(state.todayMs, 2 * MINUTE);
  assert.equal(state.records.find(record => record.kind === 'break')!.source, 'idle');
});

for (const choice of ['work', 'break', 'discard'] as const) {
  test(`idle choice ${choice} resumes the previous project exactly at the decision`, t => {
    const f = fixture(t);
    const project = execute(f.app, { type: 'start', name: 'Alpha' }).active!.projectId;
    f.advance(5 * MINUTE);
    sample(f.app, 5 * MINUTE);
    f.advance(20 * MINUTE);
    const state = execute(f.app, { type: 'resolve', choice });
    assert.deepEqual(state.active, { kind: 'work', start: f.now, projectId: project });
    assert.equal(state.pending, null);
    assert.equal(state.todayMs, choice === 'work' ? 25 * MINUTE : 0);
    assert.equal(state.week.breakTotal, choice === 'break' ? 25 * MINUTE : 0);
  });
}

test('idle clarification blocks starts and manual breaks and forbids another project', t => {
  const f = fixture(t);
  const beta = createProject(f.app, 'Beta');
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  const before = f.app.getSnapshot();
  assert.throws(() => execute(f.app, { type: 'start', name: 'New project' }));
  assert.throws(() => execute(f.app, { type: 'pause' }));
  assert.throws(() => execute(f.app, { type: 'resolve', choice: 'work', projectId: beta }));
  assert.deepEqual(f.app.getSnapshot(), before);
});

test('Stop fixes a pending endpoint and resolving it does not resume', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  f.advance(MINUTE);
  execute(f.app, { type: 'stop' });
  assert.equal(f.app.getSnapshot().pending!.end, BASE + 6 * MINUTE);
  f.advance(12 * MINUTE);
  const state = execute(f.app, { type: 'resolve', choice: 'work' });
  assert.equal(state.mode, 'untracked');
  assert.equal(state.resumeProjectId, null);
  assert.equal(state.todayMs, 6 * MINUTE);
});

test('settings accept large whole-minute values and invalid values leave both settings unchanged', t => {
  const f = fixture(t);
  execute(f.app, { type: 'settings', idleMinutes: 2_000_000, reminderMinutes: 3_000_000 });
  const before = f.app.getSnapshot().settings;
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => execute(f.app, { type: 'settings', idleMinutes: invalid, reminderMinutes: 10 }));
    assert.deepEqual(f.app.getSnapshot().settings, before);
    assert.throws(() => execute(f.app, { type: 'settings', idleMinutes: 5, reminderMinutes: invalid }));
    assert.deepEqual(f.app.getSnapshot().settings, before);
  }
  f.app.quit();
  f.store.close();
  const restarted = f.open();
  assert.deepEqual(restarted.app.getSnapshot().settings, before);
});

test('changing the idle threshold uses the existing streak without modifying a pending period', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(3 * MINUTE);
  sample(f.app, 3 * MINUTE);
  execute(f.app, { type: 'settings', idleMinutes: 2, reminderMinutes: 10 });
  assert.equal(f.app.getSnapshot().pending!.start, BASE);
  const pending = f.app.getSnapshot().pending;
  execute(f.app, { type: 'settings', idleMinutes: 999_999, reminderMinutes: 15 });
  assert.deepEqual(f.app.getSnapshot().pending, pending);
});

test('increasing the idle threshold does not reset last activity', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(3 * MINUTE);
  sample(f.app, 3 * MINUTE);
  execute(f.app, { type: 'settings', idleMinutes: 6, reminderMinutes: 10 });
  f.advance(3 * MINUTE);
  sample(f.app, 6 * MINUTE);
  assert.equal(f.app.getSnapshot().pending!.start, BASE);
});

test('lock/sleep starts one pending interval immediately and waits until awake and unlocked', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(MINUTE);
  sample(f.app, 0, { locked: true });
  const pendingId = f.app.getSnapshot().pending!.id;
  assert.equal(f.app.getSnapshot().pending!.start, BASE + MINUTE);
  assert.equal(f.app.getSnapshot().canPresent, false);
  f.advance(MINUTE);
  sample(f.app, MINUTE, { locked: true, sleeping: true });
  sample(f.app, MINUTE, { locked: false, sleeping: true });
  assert.equal(f.app.getSnapshot().canPresent, false);
  sample(f.app, MINUTE, { locked: true, sleeping: false });
  assert.equal(f.app.getSnapshot().canPresent, false);
  sample(f.app);
  assert.equal(f.app.getSnapshot().canPresent, true);
  assert.equal(f.app.getSnapshot().pending!.id, pendingId);
  assert.equal(f.app.getSnapshot().pending!.start, BASE + MINUTE);
});

test('lock preserves an earlier qualifying idle start', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(2 * MINUTE);
  sample(f.app);
  f.advance(8 * MINUTE);
  sample(f.app, 8 * MINUTE, { locked: true, sleeping: true });
  assert.equal(f.app.getSnapshot().pending!.start, BASE + 2 * MINUTE);
});

test('untracked lock and sleep never create clarification', t => {
  const f = fixture(t);
  f.advance(HOUR);
  sample(f.app, HOUR, { locked: true, sleeping: true });
  sample(f.app);
  assert.equal(f.app.getSnapshot().pending, null);
  assert.equal(f.app.getSnapshot().mode, 'untracked');
});

test('missing-project reminder counts active use and Later restarts the independent interval', t => {
  const f = fixture(t);
  sample(f.app);
  activeMinutes(f, 9);
  assert.equal(f.app.getSnapshot().reminderDue, false);
  activeMinutes(f, 1);
  assert.equal(f.app.getSnapshot().reminderDue, true);
  execute(f.app, { type: 'later' });
  assert.equal(f.app.getSnapshot().reminderDue, false);
  activeMinutes(f, 9);
  assert.equal(f.app.getSnapshot().reminderDue, false);
  activeMinutes(f, 1);
  assert.equal(f.app.getSnapshot().reminderDue, true);
  const state = execute(f.app, { type: 'start', name: 'Now' });
  assert.equal(state.active!.start, f.now);
  assert.equal(state.records.length, 0);
  assert.equal(state.reminderDue, false);
});

test('inactive, locked, and sleeping time does not accumulate reminder time', t => {
  const f = fixture(t);
  sample(f.app);
  activeMinutes(f, 4);
  for (let minute = 1; minute <= 30; minute++) {
    f.advance(MINUTE);
    sample(f.app, minute * MINUTE);
  }
  sample(f.app);
  f.advance(HOUR);
  sample(f.app, HOUR, { locked: true, sleeping: true });
  sample(f.app, 0, { locked: false, sleeping: false });
  activeMinutes(f, 5);
  assert.equal(f.app.getSnapshot().reminderDue, false);
  activeMinutes(f, 1);
  assert.equal(f.app.getSnapshot().reminderDue, true);
});

test('a missing-project break begins now, is projectless, and has no resumable project', t => {
  const f = fixture(t);
  sample(f.app);
  activeMinutes(f, 10);
  const state = execute(f.app, { type: 'pause' });
  assert.deepEqual(state.active, { kind: 'break', start: f.now, projectId: null });
  assert.equal(state.records.length, 0);
  assert.equal(state.resumeProjectId, null);
  assert.equal(state.reminderDue, false);
  f.advance(HOUR);
  sample(f.app, HOUR);
  assert.equal(f.app.getSnapshot().pending, null);
});

test('Stop starts a fresh missing-project interval', t => {
  const f = fixture(t);
  sample(f.app);
  activeMinutes(f, 9);
  execute(f.app, { type: 'start', name: 'Alpha' });
  activeMinutes(f, 2);
  execute(f.app, { type: 'stop' });
  activeMinutes(f, 9);
  assert.equal(f.app.getSnapshot().reminderDue, false);
  activeMinutes(f, 1);
  assert.equal(f.app.getSnapshot().reminderDue, true);
});

test('rename and archive retain stable identity and historical totals', t => {
  const f = fixture(t);
  const id = execute(f.app, { type: 'start', name: 'Alpha' }).active!.projectId!;
  f.advance(123_456);
  execute(f.app, { type: 'stop' });
  execute(f.app, { type: 'renameProject', id, name: '  Better Name  ' });
  const state = execute(f.app, { type: 'archiveProject', id, archived: true });
  assert.equal(state.projects.find(project => project.id === id)!.name, 'Better Name');
  assert.equal(state.records[0]!.projectId, id);
  assert.equal(state.week.rows.find(row => row.projectId === id)!.name, 'Better Name');
  assert.equal(state.week.rows.find(row => row.projectId === id)!.archived, true);
  assert.equal(state.week.workTotal, 123_456);
});

test('duplicate rename is rejected atomically', t => {
  const f = fixture(t);
  const alpha = createProject(f.app, 'Alpha');
  createProject(f.app, 'Beta');
  const before = f.app.getSnapshot();
  assert.throws(() => execute(f.app, { type: 'renameProject', id: alpha, name: ' bEtA ' }));
  assert.deepEqual(f.app.getSnapshot(), before);
});

test('corrections add, reassign, split into work/break, edit, and delete with shared accounting', t => {
  const f = fixture(t);
  const alpha = createProject(f.app, 'Alpha');
  const beta = createProject(f.app, 'Beta');
  let state = execute(f.app, { type: 'correct', removeIds: [], records: [
    { start: BASE - HOUR, end: BASE, kind: 'work', projectId: alpha },
  ] });
  assert.equal(state.todayMs, HOUR);
  state = execute(f.app, { type: 'correct', removeIds: [state.records[0]!.id], records: [
    { start: BASE - HOUR, end: BASE - 30 * MINUTE, kind: 'work', projectId: beta },
    { start: BASE - 30 * MINUTE, end: BASE, kind: 'break', projectId: null },
  ] });
  assert.equal(state.records.length, 2);
  assert.equal(state.todayMs, 30 * MINUTE);
  assert.equal(state.week.breakTotal, 30 * MINUTE);
  const workRecord = state.records.find(record => record.kind === 'work')!;
  state = execute(f.app, { type: 'correct', removeIds: [workRecord.id], records: [
    { start: BASE - 2 * HOUR, end: BASE - 30 * MINUTE, kind: 'work', projectId: alpha },
  ] });
  assert.equal(state.todayMs, 90 * MINUTE);
  state = execute(f.app, { type: 'correct', removeIds: state.records.map(record => record.id), records: [] });
  assert.equal(state.todayMs, 0);
  assert.equal(state.week.breakTotal, 0);
  assert.equal(state.records.length, 0);
});

test('invalid ranges, overlapping saved records, and overlaps within a correction roll back atomically', t => {
  const f = fixture(t);
  const projectId = createProject(f.app, 'Alpha');
  execute(f.app, { type: 'correct', removeIds: [], records: [
    { start: BASE - HOUR, end: BASE, kind: 'work', projectId },
  ] });
  const before = f.app.getSnapshot();
  const invalidRecords = [
    [{ start: BASE, end: BASE, kind: 'work' as const, projectId }],
    [{ start: BASE, end: BASE - MINUTE, kind: 'work' as const, projectId }],
    [{ start: BASE - MINUTE, end: BASE + MINUTE, kind: 'work' as const, projectId }],
    [{ start: NaN, end: BASE, kind: 'work' as const, projectId }],
    [{ start: BASE - 3 * HOUR, end: BASE - 2 * HOUR, kind: 'work' as const, projectId },
      { start: BASE - 150 * MINUTE, end: BASE - HOUR, kind: 'break' as const, projectId: null }],
  ];
  for (const records of invalidRecords) {
    assert.throws(() => execute(f.app, { type: 'correct', removeIds: [], records }));
    assert.deepEqual(f.app.getSnapshot(), before);
  }
  assert.throws(() => execute(f.app, { type: 'correct', removeIds: [before.records[0]!.id], records: [
    { start: BASE, end: BASE, kind: 'work', projectId },
  ] }));
  assert.deepEqual(f.app.getSnapshot(), before);
});

test('corrections reject overlaps with current work, manual breaks, and unresolved time', t => {
  const f = fixture(t);
  const projectId = execute(f.app, { type: 'start', name: 'Alpha' }).active!.projectId!;
  f.advance(MINUTE);
  const conflicting = () => execute(f.app, { type: 'correct', removeIds: [], records: [
    { start: f.now - 1_000, end: f.now, kind: 'work', projectId },
  ] });
  assert.throws(conflicting);
  execute(f.app, { type: 'pause' });
  f.advance(MINUTE);
  assert.throws(conflicting);
  execute(f.app, { type: 'resume' });
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  assert.throws(conflicting);
});

test('idle-classified records can be corrected', t => {
  const f = fixture(t);
  const projectId = execute(f.app, { type: 'start', name: 'Alpha' }).active!.projectId!;
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  execute(f.app, { type: 'resolve', choice: 'work' });
  execute(f.app, { type: 'stop' });
  const idleRecord = f.app.getSnapshot().records.find(record => record.source === 'idle')!;
  const state = execute(f.app, { type: 'correct', removeIds: [idleRecord.id], records: [
    { start: idleRecord.start, end: idleRecord.end - MINUTE, kind: 'break', projectId: null },
    { start: idleRecord.end - MINUTE, end: idleRecord.end, kind: 'work', projectId },
  ] });
  assert.equal(state.todayMs, MINUTE);
  assert.equal(state.week.breakTotal, 4 * MINUTE);
});

test('failed transitions and failed quit preserve the previous in-memory and durable state', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(MINUTE);
  sample(f.app);
  f.app.checkpoint();
  const before = f.app.getSnapshot();
  const writeState = f.store.writeState.bind(f.store);
  f.store.writeState = () => { throw new Error('simulated disk full'); };
  assert.throws(() => execute(f.app, { type: 'start', name: 'Beta' }));
  assert.deepEqual(f.app.getSnapshot(), before);
  assert.throws(() => f.app.quit());
  assert.deepEqual(f.app.getSnapshot(), before);
  f.store.writeState = writeState;
  execute(f.app, { type: 'start', name: 'Beta' });
  const state = f.app.getSnapshot();
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0]!.end, state.active!.start);
  f.app.quit();
  f.store.close();
  const restarted = f.open();
  assert.equal(restarted.app.getSnapshot().mode, 'untracked');
  assert.equal(restarted.app.getSnapshot().pending, null);
  assert.equal(restarted.app.getSnapshot().records.length, 1);
});

test('failed classification can be retried once without duplicating records', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  const before = f.app.getSnapshot();
  const writeState = f.store.writeState.bind(f.store);
  f.store.writeState = () => { throw new Error('simulated disk full'); };
  assert.throws(() => execute(f.app, { type: 'resolve', choice: 'work' }));
  assert.deepEqual(f.app.getSnapshot(), before);
  f.store.writeState = writeState;
  execute(f.app, { type: 'resolve', choice: 'work' });
  assert.equal(f.app.getSnapshot().records.length, 1);
  assert.equal(f.app.getSnapshot().todayMs, 5 * MINUTE);
});

test('clean quit includes work through quit and reopening adds no closed-app time or resume', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(7 * MINUTE);
  f.app.quit();
  f.store.close();
  f.advance(HOUR);
  const reopened = f.open();
  const state = reopened.app.getSnapshot();
  assert.equal(state.mode, 'untracked');
  assert.equal(state.active, null);
  assert.equal(state.pending, null);
  assert.equal(state.resumeProjectId, null);
  assert.equal(duration(work(state.records)), 7 * MINUTE);
  assert.equal(state.reminderDue, false);
});

test('clean quit during a break saves the break without resuming it on startup', t => {
  const f = fixture(t);
  execute(f.app, { type: 'pause' });
  f.advance(7 * MINUTE);
  f.app.quit();
  f.store.close();
  f.advance(HOUR);
  const state = f.open().app.getSnapshot();
  assert.equal(state.mode, 'untracked');
  assert.equal(state.week.breakTotal, 7 * MINUTE);
  assert.equal(state.pending, null);
});

test('clean quit fixes an unresolved idle endpoint and preserves its one question on startup', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  f.advance(MINUTE);
  f.app.quit();
  f.store.close();
  f.advance(HOUR);
  const reopened = f.open();
  assert.equal(reopened.app.getSnapshot().pending!.end, BASE + 6 * MINUTE);
  const state = execute(reopened.app, { type: 'resolve', choice: 'work' });
  assert.equal(state.mode, 'untracked');
  assert.equal(state.todayMs, 6 * MINUTE);
  assert.equal(state.pending, null);
});

test('crash recovery preserves certain work, bounds uncertainty at checkpoint, allows reassignment once', t => {
  const f = fixture(t);
  const beta = createProject(f.app, 'Beta');
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(2 * MINUTE);
  sample(f.app);
  f.advance(MINUTE);
  sample(f.app, MINUTE);
  f.app.checkpoint();
  f.store.close();
  f.advance(HOUR);
  const recovered = f.open();
  let state = recovered.app.getSnapshot();
  assert.equal(state.active, null);
  assert.equal(state.pending!.reason, 'recovery');
  assert.equal(state.pending!.start, BASE + 2 * MINUTE);
  assert.equal(state.pending!.end, BASE + 3 * MINUTE);
  assert.equal(state.todayMs, 2 * MINUTE);
  state = execute(recovered.app, { type: 'resolve', choice: 'work', projectId: beta });
  assert.equal(state.mode, 'untracked');
  assert.equal(state.todayMs, 3 * MINUTE);
  assert.equal(state.records.find(record => record.source === 'recovery')!.projectId, beta);
  recovered.app.checkpoint();
  recovered.store.close();
  const again = f.open().app.getSnapshot();
  assert.equal(again.pending, null);
  assert.equal(again.todayMs, 3 * MINUTE);
  assert.equal(again.records.length, 2);
});

test('crashed manual break is recovered as fixed uncertainty and never automatically resumed', t => {
  const f = fixture(t);
  execute(f.app, { type: 'pause' });
  f.advance(8 * MINUTE);
  f.app.checkpoint();
  f.store.close();
  f.advance(HOUR);
  const recovered = f.open();
  const pending = recovered.app.getSnapshot().pending!;
  assert.equal(pending.reason, 'recovery');
  assert.equal(pending.start, BASE);
  assert.equal(pending.end, BASE + 8 * MINUTE);
  const state = execute(recovered.app, { type: 'resolve', choice: 'break' });
  assert.equal(state.mode, 'untracked');
  assert.equal(state.resumeProjectId, null);
  assert.equal(state.week.breakTotal, 8 * MINUTE);
});

test('repeated crashes preserve the same pending question without duplicate saved time', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(2 * MINUTE);
  sample(f.app);
  f.advance(5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  f.app.checkpoint();
  const id = f.app.getSnapshot().pending!.id;
  f.store.close();
  f.advance(HOUR);
  const recovered = f.open();
  assert.equal(recovered.app.getSnapshot().pending!.id, id);
  assert.equal(recovered.app.getSnapshot().pending!.end, BASE + 7 * MINUTE);
  recovered.app.checkpoint();
  recovered.store.close();
  f.advance(HOUR);
  const recoveredAgain = f.open();
  assert.equal(recoveredAgain.app.getSnapshot().pending!.id, id);
  assert.equal(recoveredAgain.app.getSnapshot().pending!.end, BASE + 7 * MINUTE);
  const state = execute(recoveredAgain.app, { type: 'resolve', choice: 'work' });
  assert.equal(state.mode, 'untracked');
  assert.equal(state.todayMs, 7 * MINUTE);
  assert.equal(state.records.length, 2);
});

test('unreadable database is rejected without replacement or truncation', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timi-corrupt-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'timi.sqlite');
  const data = Buffer.from('preserve this corrupted original database exactly\n');
  writeFileSync(path, data);
  assert.throws(() => new SqliteStore(path));
  assert.deepEqual(readFileSync(path), data);
});

for (const zone of ['Europe/Berlin', 'America/New_York']) {
  test(`calendar accounting splits midnight and Monday boundaries in ${zone}`, t => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = zone;
    t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
    const monday = new Date(2026, 9, 12, 0, 0, 0, 0).getTime();
    const f = fixture(t, monday + 12 * HOUR);
    const projectId = createProject(f.app, 'Alpha');
    execute(f.app, { type: 'correct', removeIds: [], records: [
      { start: monday - 31_111, end: monday + 91_234, kind: 'work', projectId },
    ] });
    const current = f.app.getSnapshot();
    const prior = f.app.getSnapshot(-1);
    assert.equal(current.week.start, monday);
    assert.equal(current.week.workDays[0], 91_234);
    assert.equal(prior.week.workDays[6], 31_111);
    assert.equal(current.week.workTotal + prior.week.workTotal, 122_345);
    assert.equal(current.todayMs, 91_234);
  });

  test(`calendar accounting uses elapsed milliseconds through spring and autumn DST in ${zone}`, t => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = zone;
    t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
    const transitions = zone === 'Europe/Berlin'
      ? [{ month: 2, day: 29, hours: 23 }, { month: 9, day: 25, hours: 25 }]
      : [{ month: 2, day: 8, hours: 23 }, { month: 10, day: 1, hours: 25 }];
    for (const transition of transitions) {
      const start = new Date(2026, transition.month, transition.day).getTime();
      const end = new Date(2026, transition.month, transition.day + 1).getTime();
      const f = fixture(t, end - 1);
      const projectId = createProject(f.app, 'Alpha');
      execute(f.app, { type: 'correct', removeIds: [], records: [
        { start, end, kind: 'work', projectId },
      ] });
      const state = f.app.getSnapshot();
      assert.equal(state.todayMs, transition.hours * HOUR);
      assert.equal(state.week.workDays[6], transition.hours * HOUR);
      assert.equal(state.week.workTotal, transition.hours * HOUR);
      assert.equal(state.week.end - state.week.start, (7 * 24 + transition.hours - 24) * HOUR);
    }
  });
}

test('millisecond totals accumulate before any display rounding', t => {
  const f = fixture(t);
  const alpha = createProject(f.app, 'Alpha');
  const beta = createProject(f.app, 'Beta');
  const state = execute(f.app, { type: 'correct', removeIds: [], records: [
    { start: BASE - 100_000, end: BASE - 69_500, kind: 'work', projectId: alpha },
    { start: BASE - 69_500, end: BASE - 39_000, kind: 'work', projectId: beta },
  ] });
  assert.equal(state.todayMs, 61_000);
  assert.equal(state.week.workTotal, 61_000);
  assert.equal(state.week.workDays.reduce((sum, value) => sum + value, 0), 61_000);
  assert.equal(state.week.rows.reduce((sum, row) => sum + row.total, 0), 61_000);
});

test('a backwards clock observation is rejected without poisoning later valid samples', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(MINUTE);
  sample(f.app);
  f.setTime(BASE + 30_000);
  assert.throws(() => sample(f.app), (error: unknown) => (error as { code: string }).code === 'CLOCK_INVALID');
  f.setTime(BASE + 2 * MINUTE);
  assert.doesNotThrow(() => sample(f.app));
  const state = execute(f.app, { type: 'stop' });
  assert.equal(state.todayMs, 2 * MINUTE);
  assert.equal(state.pending, null);
});

test('checkpoints and commands before the last native observation cannot corrupt durable state', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(MINUTE);
  sample(f.app);
  f.app.checkpoint();
  const stored = f.store.load();
  f.setTime(BASE + 30_000);
  assert.throws(() => f.app.checkpoint());
  assert.throws(() => execute(f.app, { type: 'stop' }));
  assert.throws(() => f.app.quit());
  assert.deepEqual(f.store.load(), stored);
  f.setTime(BASE + 2 * MINUTE);
  execute(f.app, { type: 'stop' });
  assert.equal(f.app.getSnapshot().todayMs, 2 * MINUTE);
});

test('an unsampled idle gap followed by activity still excludes the entire qualifying streak', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(MINUTE);
  sample(f.app);
  f.advance(20 * MINUTE);
  sample(f.app, 0);
  const state = f.app.getSnapshot();
  assert.equal(state.pending!.start, BASE + MINUTE);
  assert.equal(state.todayMs, MINUTE);
  assert.equal(state.canPresent, true);
  f.advance(5 * MINUTE);
  execute(f.app, { type: 'resolve', choice: 'break' });
  assert.equal(f.app.getSnapshot().week.breakTotal, 25 * MINUTE);
});

test('a reset counter that is greater than the previous sample still updates last activity', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(10_000);
  sample(f.app, 10_000);
  f.advance(20_000);
  sample(f.app, 15_000); // There was fresh native input at +15s, after the previous sample.
  f.setTime(BASE + 15_000 + 5 * MINUTE);
  sample(f.app, 5 * MINUTE);
  assert.equal(f.app.getSnapshot().pending!.start, BASE + 15_000);
  assert.equal(f.app.getSnapshot().todayMs, 15_000);
});

test('failed native idle transition replays original lock and return timestamps on retry', t => {
  const f = fixture(t);
  execute(f.app, { type: 'start', name: 'Alpha' });
  f.advance(2 * MINUTE);
  sample(f.app);
  const writeState = f.store.writeState.bind(f.store);
  f.store.writeState = () => { throw new Error('simulated disk full'); };
  f.advance(5 * MINUTE);
  assert.throws(() => sample(f.app, 5 * MINUTE));
  f.advance(MINUTE);
  assert.throws(() => sample(f.app, 6 * MINUTE, { locked: true, sleeping: true }));
  f.advance(MINUTE);
  assert.throws(() => sample(f.app));
  f.store.writeState = writeState;
  f.app.checkpoint();
  const restored = f.app.getSnapshot();
  assert.equal(restored.pending!.start, BASE + 2 * MINUTE);
  assert.equal(restored.canPresent, true);
  assert.equal(restored.records.length, 1);
  assert.equal(restored.todayMs, 2 * MINUTE);
  f.advance(MINUTE);
  const resolved = execute(f.app, { type: 'resolve', choice: 'work' });
  assert.equal(resolved.todayMs, 10 * MINUTE);
  assert.equal(resolved.records.length, 2);
  assert.equal(resolved.active!.start, BASE + 10 * MINUTE);
});
