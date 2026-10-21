import './polyfills';
import './bridge';
import { TrackingApplication } from '../core/application';
import { SqliteStore } from '../core/store';
import { DatabaseSync } from './sqlite';
import { accounting, addLocalDays, dayStart } from '../core/accounting';
import { DEFAULT_SETTINGS } from '../core/model';

const BASE = new Date(2026, 9, 12, 12).getTime();
const MINUTE = 60_000;
let directory = '';
let testIndex = 0;
const passed: string[] = [];
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
function fails(operation: () => void, message: string): void {
  let failed = false;
  try { operation(); } catch { failed = true; }
  assert(failed, message);
}
function fixture() {
  let now = BASE;
  const path = `${directory}/native-${++testIndex}.sqlite`;
  const stores: SqliteStore[] = [];
  const open = () => {
    const store = new SqliteStore(path);
    stores.push(store);
    return { store, app: new TrackingApplication(store, () => now) };
  };
  return { ...open(), path, open, advance: (ms: number) => { now += ms; },
    close: () => { for (const store of stores) store.close(); } };
}
function sample(app: TrackingApplication, idleMs = 0): void { app.sample({ idleMs, locked: false, sleeping: false }); }
function test(name: string, operation: () => void) { operation(); passed.push(name); }

globalThis.__timiInitialize = path => {
  directory = path;
  try {
    test('startup remains untracked; Unicode project names round-trip without a Node runtime', () => {
      const f = fixture();
      try {
        equal(f.app.getSnapshot().mode, 'untracked', 'startup mode');
        equal(f.app.getSnapshot().settings, DEFAULT_SETTINGS, 'default settings');
        f.app.execute({ type: 'createProject', name: '  Grüße 日本語 🕒  ' });
        f.app.quit(); f.store.close();
        const next = f.open().app.getSnapshot();
        equal(next.mode, 'untracked', 'restart mode');
        equal(next.projects[0]?.name, 'Grüße 日本語 🕒', 'unicode preservation');
      } finally { f.close(); }
    });
    test('switch, pause, and resume preserve actual elapsed milliseconds', () => {
      const f = fixture();
      try {
        f.app.execute({ type: 'start', name: 'Alpha' }); f.advance(91_234);
        f.app.execute({ type: 'start', name: 'Beta' }); f.advance(63_789);
        f.app.execute({ type: 'pause' }); f.advance(19_123);
        f.app.execute({ type: 'resume' }); f.advance(321);
        const state = f.app.execute({ type: 'stop' });
        equal(state.todayMs, 155_344, 'worked milliseconds');
        equal(state.week.breakTotal, 19_123, 'break milliseconds');
        for (let i = 1; i < state.records.length; i++) equal(state.records[i - 1]!.end, state.records[i]!.start, 'contiguous interval');
      } finally { f.close(); }
    });
    test('a failed correction rolls back deletions and keeps in-memory state for retry', () => {
      const f = fixture();
      try {
        f.app.execute({ type: 'start', name: 'Alpha' }); f.advance(MINUTE);
        const before = f.app.execute({ type: 'stop' });
        const previous = f.store.load();
        const record = before.records[0]!;
        const correction = { type: 'correct' as const, removeIds: [record.id], records: [
          { start: record.start, end: record.end - 1, kind: 'work' as const, projectId: record.projectId },
        ] };
        f.store.db.exec("CREATE TEMP TRIGGER fail_insert BEFORE INSERT ON timi_records BEGIN SELECT RAISE(ABORT, 'simulated full disk'); END;");
        fails(() => f.app.execute(correction), 'correction must fail');
        equal(f.app.getSnapshot(), before, 'memory preserved');
        equal(f.store.load(), previous, 'database rollback');
        f.store.db.exec('DROP TRIGGER fail_insert');
        const after = f.app.execute(correction);
        equal(after.records.length, 1, 'single replacement');
        equal(after.todayMs, MINUTE - 1, 'retry succeeds exactly once');
      } finally { f.close(); }
    });
    test('a failed idle transition retains all observations and the entire unresolved interval', () => {
      const f = fixture();
      try {
        f.app.execute({ type: 'start', name: 'Alpha' }); f.advance(2 * MINUTE); sample(f.app);
        f.advance(5 * MINUTE);
        f.store.db.exec("CREATE TEMP TRIGGER fail_runtime BEFORE UPDATE ON timi_runtime BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
        fails(() => sample(f.app, 5 * MINUTE), 'idle persistence must fail');
        equal(f.app.getSnapshot().mode, 'work', 'prior state remains');
        equal(f.store.load().records.length, 0, 'records rolled back');
        f.advance(MINUTE);
        f.store.db.exec('DROP TRIGGER fail_runtime'); sample(f.app);
        equal(f.app.getSnapshot().pending?.start, BASE + 2 * MINUTE, 'whole idle streak starts at activity');
        f.advance(MINUTE);
        const state = f.app.execute({ type: 'resolve', choice: 'break' });
        equal(state.records.filter(record => record.kind === 'break').reduce((sum, record) => sum + record.end - record.start, 0), 7 * MINUTE, 'decision time included');
        equal(state.todayMs, 2 * MINUTE, 'certain work counted once');
      } finally { f.close(); }
    });
    test('crash recovery ends at the durable checkpoint, never at restart or an unsaved sample', () => {
      const f = fixture();
      try {
        f.app.execute({ type: 'start', name: 'Alpha' }); f.advance(10_123); sample(f.app);
        f.advance(4_877); f.app.checkpoint();
        f.advance(5_000); sample(f.app); f.store.close();
        f.advance(60 * MINUTE);
        const state = f.open().app.getSnapshot();
        equal(state.active, null, 'startup untracked');
        equal(state.records[0]?.end, BASE + 10_123, 'confirmed activity ends durably');
        equal(state.pending?.start, BASE + 10_123, 'uncertain recovery starts');
        equal(state.pending?.end, BASE + 15_000, 'latest durable checkpoint only');
        equal(state.pending?.resume, false, 'recovery cannot auto resume');
      } finally { f.close(); }
    });
    test('failed quit preserves state and a retry writes one clean durable stop', () => {
      const f = fixture();
      try {
        f.app.execute({ type: 'start', name: 'Alpha' }); f.advance(20_001);
        f.store.db.exec("CREATE TEMP TRIGGER fail_runtime BEFORE UPDATE ON timi_runtime BEGIN SELECT RAISE(ABORT, 'write failure'); END;");
        fails(() => f.app.quit(), 'quit must fail');
        equal(f.app.getSnapshot().mode, 'work', 'failed quit remains running');
        equal(f.store.load().runtime?.cleanExit, false, 'failed quit not clean');
        f.store.db.exec('DROP TRIGGER fail_runtime'); f.app.quit(); f.store.close();
        f.advance(MINUTE); const state = f.open().app.getSnapshot();
        equal(state.pending, null, 'no recovery after clean exit');
        equal(state.records.length, 1, 'one record after retry');
        equal(state.todayMs, 20_001, 'elapsed work preserved');
      } finally { f.close(); }
    });
    test('a COMMIT failure rolls back all writes and leaves the connection retryable', () => {
      const f = fixture();
      try {
        f.store.db.exec('CREATE TABLE commit_parent (id TEXT PRIMARY KEY); CREATE TABLE commit_child (parent TEXT REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);');
        const before = f.store.load();
        fails(() => f.store.transaction(() => {
          f.store.db.prepare('UPDATE timi_settings SET idle_minutes = ? WHERE id = 1').run(9);
          f.store.db.prepare('INSERT INTO commit_child VALUES (?)').run('missing');
        }), 'deferred constraint must fail at COMMIT');
        equal(f.store.load(), before, 'all changes rolled back after COMMIT failure');
        equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM commit_child').get()!.count, 0, 'failed insert rolled back');
        f.app.execute({ type: 'start', name: 'Retry' });
        equal(f.app.getSnapshot().mode, 'work', 'new transaction succeeds');
      } finally { f.close(); }
    });
    test('SQLite text preserves empty strings, embedded NULs, and multibyte Unicode', () => {
      const db = new DatabaseSync(':memory:');
      try {
        db.exec('CREATE TABLE strings (id INTEGER PRIMARY KEY, text_value TEXT NOT NULL);');
        const strings = ['', 'before\0after', '日本語 🕒 Grüße'];
        for (let index = 0; index < strings.length; index++) db.prepare('INSERT INTO strings VALUES (?, ?)').run(index, strings[index]!);
        equal(db.prepare('SELECT text_value FROM strings ORDER BY id').all().map(row => row.text_value), strings, 'UTF-8 and explicit text lengths');
      } finally { db.close(); }
    });
    test('notification receipts persist without advancing the tracking checkpoint', () => {
      const f = fixture();
      try {
        f.app.execute({ type: 'start', name: 'Alpha' });
        const checkpoint = f.store.load().runtime!.checkpointAt;
        f.advance(12_345); sample(f.app);
        const notice = { kind: 'day' as const, period: '2026-10-12', targetMs: 1, workedMs: 12_345 };
        f.app.acknowledgeWorkGoalNotice(notice); f.app.acknowledgeWorkGoalNotice(notice);
        equal(f.store.load().runtime!.checkpointAt, checkpoint, 'receipt does not checkpoint runtime');
        equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM timi_goal_notices').get()!.count, 1, 'receipt idempotent');
      } finally { f.close(); }
    });
    test('existing v1 SQLite files migrate with a readable consistent backup', () => {
      const path = `${directory}/migration.sqlite`;
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE timi_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE, archived INTEGER);
        CREATE TABLE timi_records (id TEXT PRIMARY KEY, start_ms INTEGER, end_ms INTEGER, kind TEXT, project_id TEXT, source TEXT);
        CREATE TABLE timi_settings (id INTEGER PRIMARY KEY, idle_minutes INTEGER, reminder_minutes INTEGER);
        CREATE TABLE timi_runtime (id INTEGER PRIMARY KEY, state_json TEXT);
        INSERT INTO timi_projects VALUES ('alpha', 'Alpha', 'alpha', 0);
        INSERT INTO timi_records VALUES ('saved', ${BASE - MINUTE}, ${BASE}, 'work', 'alpha', 'tracked');
        INSERT INTO timi_settings VALUES (1, 7, 11); INSERT INTO timi_runtime VALUES (1, NULL); PRAGMA user_version = 1;`);
      old.close();
      const store = new SqliteStore(path);
      try {
        assert(store.migrationBackup, 'migration creates backup');
        const backup = new DatabaseSync(store.migrationBackup);
        try {
          equal(backup.prepare('PRAGMA user_version').get()!.user_version, 1, 'backup original version');
          equal(backup.prepare('SELECT id FROM timi_records').get()!.id, 'saved', 'backup original row');
        } finally { backup.close(); }
        const app = new TrackingApplication(store, () => BASE + MINUTE);
        equal(app.getSnapshot().records[0]?.id, 'saved', 'record identity preserved');
        equal(app.getSnapshot().settings.idleMinutes, 7, 'settings preserved');
        equal(app.getSnapshot().mode, 'untracked', 'migration startup untracked');
      } finally { store.close(); }
    });
    test('local days preserve the actual 23-hour and 25-hour DST intervals', () => {
      for (const [month, day, hours] of [[2, 29, 23], [9, 25, 25]]) {
        const start = dayStart(new Date(2026, month!, day!, 12).getTime());
        const end = addLocalDays(start, 1);
        equal((end - start) / 3_600_000, hours, 'local DST day length');
        const report = accounting([{ id: 'dst', start, end, kind: 'work', projectId: 'project', source: 'manual' }], null,
          [{ id: 'project', name: 'DST', archived: false }], end - 1);
        equal(report.todayMs, hours! * 3_600_000, 'elapsed duration across DST');
      }
    });
    return JSON.stringify({ ok: true, value: null });
  } catch (error) { return JSON.stringify({ ok: false, error: String(error), passed }); }
};
globalThis.__timiDispatch = () => JSON.stringify({ ok: true, value: { passed } });
