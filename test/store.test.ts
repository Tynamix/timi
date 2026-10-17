import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import { TrackingApplication } from '../src/core/application.js';
import { SqliteStore } from '../src/core/store.js';

const BASE = Date.UTC(2026, 9, 12, 10);

function databasePath(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'timi-store-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'timi.sqlite');
}

function makeLegacyDatabase(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);
    CREATE TABLE periods (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL);
    CREATE TABLE breaks (id TEXT PRIMARY KEY, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL);
    CREATE TABLE idle_periods (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, returned INTEGER NOT NULL, classification TEXT);
    CREATE TABLE settings (id INTEGER PRIMARY KEY, idle_minutes INTEGER NOT NULL);
    INSERT INTO projects VALUES ('alpha', 'Alpha Studio', 'alpha studio');
    INSERT INTO projects VALUES ('beta', 'Beta', 'beta');
    INSERT INTO settings VALUES (1, 7);
  `);
  db.prepare('INSERT INTO periods VALUES (?, ?, ?, ?)').run('saved-work', 'alpha', BASE - 120_000, BASE - 60_000);
  db.prepare('INSERT INTO breaks VALUES (?, ?, ?)').run('saved-break', BASE - 60_000, BASE);
  db.prepare('INSERT INTO idle_periods VALUES (?, ?, ?, ?, ?, ?)').run('pending-idle', 'alpha', BASE, BASE + 90_000, 1, null);
  return db;
}

test('legacy migration preserves identities, records, settings, unresolved intervals, original tables, and backup', t => {
  const path = databasePath(t);
  const legacy = makeLegacyDatabase(path);
  legacy.close();
  const originalBytes = readFileSync(path);
  const store = new SqliteStore(path);
  t.after(() => store.close());
  assert.ok(store.migrationBackup);
  // The backup is a consistent complete SQLite database; rows, not page layout, are the contract.
  const backup = new DatabaseSync(store.migrationBackup!);
  try {
    assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM periods').get()!.count, 1);
    assert.equal(backup.prepare('SELECT name FROM projects WHERE id = ?').get('alpha')!.name, 'Alpha Studio');
    assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 0);
  } finally { backup.close(); }
  assert.ok(originalBytes.length > 0);
  const app = new TrackingApplication(store, () => BASE + 3_600_000);
  const state = app.getSnapshot();
  assert.equal(state.active, null);
  assert.equal(state.resumeProjectId, null);
  assert.equal(state.projects.find(project => project.id === 'alpha')!.name, 'Alpha Studio');
  assert.equal(state.records.find(record => record.id === 'saved-work')!.projectId, 'alpha');
  assert.equal(state.records.find(record => record.id === 'saved-break')!.kind, 'break');
  assert.deepEqual(state.settings, { idleMinutes: 7, reminderMinutes: 10 });
  assert.equal(state.pending!.id, 'pending-idle');
  assert.equal(state.pending!.end, BASE + 90_000);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM periods').get()!.count, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM idle_periods').get()!.count, 1);
  app.execute({ type: 'resolve', choice: 'work' });
  app.quit();
  store.close();
  const reopened = new SqliteStore(path);
  try {
    const restarted = new TrackingApplication(reopened, () => BASE + 7_200_000);
    assert.equal(restarted.getSnapshot().pending, null);
    assert.equal(restarted.getSnapshot().records.length, 3);
    assert.equal(restarted.getSnapshot().todayMs, 150_000);
  } finally { reopened.close(); }
});

test('multiple legacy pending intervals are presented once in sequence without resuming work', t => {
  const path = databasePath(t);
  const legacy = makeLegacyDatabase(path);
  legacy.prepare('INSERT INTO idle_periods VALUES (?, ?, ?, ?, ?, ?)').run('pending-second', 'beta', BASE + 90_000, BASE + 180_000, 1, null);
  legacy.close();
  const store = new SqliteStore(path);
  t.after(() => store.close());
  const app = new TrackingApplication(store, () => BASE + 3_600_000);
  assert.equal(app.getSnapshot().pending!.id, 'pending-idle');
  let state = app.execute({ type: 'resolve', choice: 'break', pendingId: 'pending-idle' });
  assert.equal(state.active, null);
  assert.equal(state.pending!.id, 'pending-second');
  assert.throws(() => app.execute({ type: 'resolve', choice: 'break', pendingId: 'pending-idle' }));
  assert.equal(app.getSnapshot().pending!.id, 'pending-second');
  state = app.execute({ type: 'resolve', choice: 'discard' });
  assert.equal(state.mode, 'untracked');
  assert.equal(state.pending, null);
  assert.equal(state.records.length, 3);
  assert.equal(state.week.breakTotal, 150_000);
});

test('malformed legacy storage fails atomically and leaves its original schema and records intact', t => {
  const path = databasePath(t);
  const legacy = makeLegacyDatabase(path);
  legacy.exec('UPDATE settings SET idle_minutes = 0');
  legacy.close();
  assert.throws(() => new SqliteStore(path));
  const inspect = new DatabaseSync(path);
  try {
    assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version, 0);
    assert.equal(inspect.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'timi_%'").get()!.count, 0);
    assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM periods').get()!.count, 1);
    assert.equal(inspect.prepare('SELECT idle_minutes FROM settings').get()!.idle_minutes, 0);
  } finally { inspect.close(); }
});

test('unknown and newer SQLite schemas are refused without replacing existing data', t => {
  for (const newer of [false, true]) {
    const path = databasePath(t);
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE irreplaceable_data (message TEXT); INSERT INTO irreplaceable_data VALUES (\'keep me\');');
    if (newer) db.exec('PRAGMA user_version = 99');
    db.close();
    const before = readFileSync(path);
    assert.throws(() => new SqliteStore(path));
    assert.deepEqual(readFileSync(path), before);
  }
});

test('genuine SQLite failure after record replacement rolls back all rows and keeps application state unchanged', t => {
  const path = databasePath(t);
  const store = new SqliteStore(path);
  t.after(() => store.close());
  let now = BASE;
  const app = new TrackingApplication(store, () => now);
  const projectId = app.execute({ type: 'start', name: 'Alpha' }).active!.projectId!;
  now += 120_000;
  app.execute({ type: 'stop' });
  const beforeSnapshot = app.getSnapshot();
  const beforeStored = store.load();
  store.db.exec(`CREATE TRIGGER fail_runtime_write BEFORE UPDATE ON timi_runtime BEGIN SELECT RAISE(ABORT, 'simulated SQLite write failure'); END;`);
  const replacement = {
    type: 'correct' as const, removeIds: [beforeSnapshot.records[0]!.id], records: [
      { start: BASE, end: BASE + 60_000, kind: 'work' as const, projectId },
      { start: BASE + 60_000, end: BASE + 120_000, kind: 'break' as const, projectId: null },
    ],
  };
  assert.throws(() => app.execute(replacement));
  assert.deepEqual(app.getSnapshot(), beforeSnapshot);
  assert.deepEqual(store.load(), beforeStored);
  store.db.exec('DROP TRIGGER fail_runtime_write');
  const after = app.execute(replacement);
  assert.equal(after.records.length, 2);
  assert.equal(after.todayMs, 60_000);
  assert.equal(after.week.breakTotal, 60_000);
  app.quit();
  store.close();
  const reopened = new SqliteStore(path);
  try {
    const saved = reopened.load();
    assert.equal(saved.records.length, 2);
    assert.equal(saved.runtime!.cleanExit, true);
  } finally { reopened.close(); }
});

test('corrupted runtime JSON is refused and preserved', t => {
  const path = databasePath(t);
  const store = new SqliteStore(path);
  store.db.prepare('UPDATE timi_runtime SET state_json = ?').run('{broken-json');
  store.close();
  assert.throws(() => new SqliteStore(path));
  const inspect = new DatabaseSync(path);
  try {
    assert.equal(inspect.prepare('SELECT state_json FROM timi_runtime').get()!.state_json, '{broken-json');
  } finally { inspect.close(); }
});

test('an actual SIGKILL preserves WAL checkpoints and recovers uncertainty without closed-app time', t => {
  const path = databasePath(t);
  // The project is CommonJS; explicit require avoids Node 24 treating tsx's
  // transformed TypeScript as a native ESM module in this standalone child.
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=commonjs', '-e', `
    const { SqliteStore } = require('./src/core/store.ts');
    const { TrackingApplication } = require('./src/core/application.ts');
    let now = ${BASE};
    const store = new SqliteStore(process.env.TIMI_CRASH_DATABASE);
    const app = new TrackingApplication(store, () => now);
    app.execute({ type: 'start', name: 'Crash test' });
    now += 120000;
    app.sample({ idleMs: 0, locked: false, sleeping: false });
    now += 30000;
    app.sample({ idleMs: 30000, locked: false, sleeping: false });
    app.checkpoint();
    process.kill(process.pid, 'SIGKILL');
  `], { cwd: process.cwd(), env: { ...process.env, TIMI_CRASH_DATABASE: path }, encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const store = new SqliteStore(path);
  t.after(() => store.close());
  const app = new TrackingApplication(store, () => BASE + 3_600_000);
  const recovered = app.getSnapshot();
  assert.equal(recovered.active, null);
  assert.equal(recovered.pending!.reason, 'recovery');
  assert.equal(recovered.pending!.start, BASE + 120_000);
  assert.equal(recovered.pending!.end, BASE + 150_000);
  assert.equal(recovered.todayMs, 120_000);
  const classified = app.execute({ type: 'resolve', choice: 'break' });
  assert.equal(classified.mode, 'untracked');
  assert.equal(classified.todayMs, 120_000);
  assert.equal(classified.week.breakTotal, 30_000);
  assert.equal(classified.records.length, 2);
});

test('stored overlaps are refused without deleting conflicting records', t => {
  const path = databasePath(t);
  const store = new SqliteStore(path);
  const app = new TrackingApplication(store, () => BASE);
  const project = app.execute({ type: 'createProject', name: 'Alpha' }).projects[0]!.id;
  const insert = store.db.prepare('INSERT INTO timi_records VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('first', BASE - 120_000, BASE - 30_000, 'work', project, 'manual');
  insert.run('overlap', BASE - 60_000, BASE, 'break', null, 'manual');
  store.close();
  assert.throws(() => new SqliteStore(path));
  const inspect = new DatabaseSync(path);
  try { assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM timi_records').get()!.count, 2); }
  finally { inspect.close(); }
});

test('duplicate saved pending identities are refused even if their intervals do not overlap', t => {
  const path = databasePath(t);
  const store = new SqliteStore(path);
  const app = new TrackingApplication(store, () => BASE);
  const projectId = app.execute({ type: 'createProject', name: 'Alpha' }).projects[0]!.id;
  const runtime = store.load().runtime!;
  runtime.pending = { id: 'same-pending-id', start: BASE, end: BASE + 60_000, projectId, reason: 'idle', resume: false };
  runtime.pendingQueue = [{ ...runtime.pending, start: BASE + 120_000, end: BASE + 180_000 }];
  runtime.checkpointAt = BASE + 180_000;
  store.db.prepare('UPDATE timi_runtime SET state_json = ?').run(JSON.stringify(runtime));
  store.close();
  assert.throws(() => new SqliteStore(path));
  const inspect = new DatabaseSync(path);
  try {
    const unchanged = JSON.parse(inspect.prepare('SELECT state_json FROM timi_runtime').get()!.state_json as string);
    assert.equal(unchanged.pendingQueue[0].id, 'same-pending-id');
  } finally { inspect.close(); }
});
