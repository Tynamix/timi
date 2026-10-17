import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { PendingPeriod, Project, TimeRecord } from '../shared.js';
import { AppFailure, storageFailure } from './errors.js';
import { DEFAULT_SETTINGS, freshRuntime, projectKey, validMinutes, validTimestamp, type PersistedState, type RuntimeState } from './model.js';

const SCHEMA_VERSION = 1;
const SCHEMA = `
CREATE TABLE timi_projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL CHECK (archived IN (0, 1))
);
CREATE TABLE timi_records (
  id TEXT PRIMARY KEY, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL CHECK (end_ms >= start_ms),
  kind TEXT NOT NULL CHECK (kind IN ('work', 'break')),
  project_id TEXT REFERENCES timi_projects(id),
  source TEXT NOT NULL CHECK (source IN ('manual', 'tracked', 'idle', 'recovery')),
  CHECK ((kind = 'work' AND project_id IS NOT NULL) OR (kind = 'break' AND project_id IS NULL))
);
CREATE INDEX timi_records_by_range ON timi_records(start_ms, end_ms);
CREATE TABLE timi_settings (id INTEGER PRIMARY KEY CHECK (id = 1), idle_minutes INTEGER NOT NULL, reminder_minutes INTEGER NOT NULL);
CREATE TABLE timi_runtime (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT);
INSERT INTO timi_settings VALUES (1, 5, 10);
INSERT INTO timi_runtime VALUES (1, NULL);
PRAGMA user_version = 1;
`;

function assert(condition: unknown): asserts condition { if (!condition) throw new AppFailure('STORAGE_INVALID'); }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validateRuntime(runtime: unknown, projectIds: Set<string>): asserts runtime is RuntimeState | null {
  if (runtime === null) return;
  assert(plain(runtime));
  for (const key of ['lastActivity', 'lastSampleAt', 'checkpointAt', 'reminderAnchor']) assert(validTimestamp(runtime[key]));
  assert(runtime.lastIdleMs === null || (Number.isSafeInteger(runtime.lastIdleMs) && (runtime.lastIdleMs as number) >= 0));
  assert(Number.isSafeInteger(runtime.reminderActiveMs) && (runtime.reminderActiveMs as number) >= 0);
  for (const key of ['locked', 'sleeping', 'awaitingReturn', 'wasInactive', 'reminderDue', 'cleanExit']) assert(typeof runtime[key] === 'boolean');
  assert(runtime.resumeProjectId === null || (typeof runtime.resumeProjectId === 'string' && projectIds.has(runtime.resumeProjectId)));
  if (runtime.active !== null) {
    assert(plain(runtime.active));
    const active = runtime.active;
    assert(validTimestamp(active.start));
    assert((active.kind === 'work' && typeof active.projectId === 'string' && projectIds.has(active.projectId)) || (active.kind === 'break' && active.projectId === null));
    assert(active.start <= (runtime.checkpointAt as number));
  }
  const pending = (value: unknown): void => {
    assert(plain(value));
    assert(typeof value.id === 'string' && value.id.length > 0 && validTimestamp(value.start));
    assert(value.end === null || (validTimestamp(value.end) && value.end >= value.start));
    assert(value.reason === 'idle' || value.reason === 'recovery');
    assert(typeof value.resume === 'boolean');
    assert(value.projectId === null || (typeof value.projectId === 'string' && projectIds.has(value.projectId)));
    assert(value.reason !== 'idle' || value.projectId !== null);
    assert(value.end !== null || value.start <= (runtime.checkpointAt as number));
  };
  assert(Array.isArray(runtime.pendingQueue));
  for (const value of runtime.pendingQueue) pending(value);
  if (runtime.pending !== null) pending(runtime.pending);
  assert(!(runtime.active && runtime.pending));
  assert(runtime.pendingQueue.length === 0 || runtime.pending !== null);
  assert((runtime.lastActivity as number) <= (runtime.checkpointAt as number));
  assert((runtime.lastSampleAt as number) <= (runtime.checkpointAt as number));
}

/** The only SQLite boundary. A failed transaction leaves the prior durable state intact. */
export class SqliteStore {
  readonly db: DatabaseSync;
  private closed = false;
  readonly migrationBackup: string | null;

  constructor(readonly path: string) {
    let database: DatabaseSync | undefined;
    let backup: string | null = null;
    try {
      database = new DatabaseSync(path);
      this.db = database;
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA synchronous = FULL; PRAGMA fullfsync = ON;');
      const check = this.db.prepare('PRAGMA quick_check').all();
      assert(check.length === 1 && Object.values(check[0]!)[0] === 'ok');
      const version = this.db.prepare('PRAGMA user_version').get()!.user_version as number;
      if (version > SCHEMA_VERSION || version < 0) throw new AppFailure('STORAGE_VERSION', { version });
      const names = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name as string);
      if (version === 0 && names.length === 0) this.transaction(() => this.db.exec(SCHEMA));
      else if (version === 0) {
        const legacy = ['projects', 'periods', 'breaks', 'idle_periods', 'settings'];
        assert(names.length === legacy.length && legacy.every(name => names.includes(name)));
        this.validateLegacySchema();
        // A consistent SQLite backup is made before any migration DDL. Existing tables are also retained.
        if (path !== ':memory:') {
          backup = `${path}.pre-v1-${randomUUID()}.sqlite`;
          this.db.prepare('VACUUM INTO ?').run(backup);
        }
        this.transaction(() => this.migrateLegacy());
      } else {
        assert(['timi_projects', 'timi_records', 'timi_settings', 'timi_runtime'].every(name => names.includes(name)));
      }
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA fullfsync = ON;');
      this.load(); // Refuse malformed rows instead of replacing or normalizing unreadable data.
      this.migrationBackup = backup;
    } catch (error) {
      try { database?.close(); } catch { /* original failure wins */ }
      throw storageFailure(error);
    }
  }

  transaction<T>(operation: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* preserve original failure */ }
        throw error;
      }
    } catch (error) { throw storageFailure(error); }
  }

  load(): PersistedState {
    try {
      const projectRows = this.db.prepare('SELECT id, name, name_key, archived FROM timi_projects ORDER BY name_key, id').all();
      for (const row of projectRows) assert(typeof row.name === 'string' && row.name_key === projectKey(row.name) && (row.archived === 0 || row.archived === 1));
      const projects = projectRows.map(row => ({ id: row.id, name: row.name, archived: row.archived === 1 })) as Project[];
      const ids = new Set<string>();
      for (const project of projects) {
        assert(typeof project.id === 'string' && project.id.length > 0 && typeof project.name === 'string' && projectKey(project.name).length > 0);
        ids.add(project.id);
      }
      const rawRecords = this.db.prepare('SELECT * FROM timi_records ORDER BY start_ms, end_ms, id').all();
      const records = rawRecords.map(row => ({ id: row.id, start: row.start_ms, end: row.end_ms, kind: row.kind, projectId: row.project_id, source: row.source })) as TimeRecord[];
      for (const record of records) {
        assert(typeof record.id === 'string' && validTimestamp(record.start) && validTimestamp(record.end) && record.end >= record.start);
        assert((record.kind === 'work' && record.projectId !== null && ids.has(record.projectId)) || (record.kind === 'break' && record.projectId === null));
        assert(['manual', 'tracked', 'idle', 'recovery'].includes(record.source));
      }
      const configuration = this.db.prepare('SELECT idle_minutes, reminder_minutes FROM timi_settings WHERE id = 1').get();
      assert(configuration && validMinutes(configuration.idle_minutes) && validMinutes(configuration.reminder_minutes));
      const settings = { idleMinutes: configuration.idle_minutes, reminderMinutes: configuration.reminder_minutes };
      const row = this.db.prepare('SELECT state_json FROM timi_runtime WHERE id = 1').get();
      assert(row);
      let runtime: unknown;
      try { runtime = row.state_json === null ? null : JSON.parse(row.state_json as string); }
      catch (error) { throw new AppFailure('STORAGE_INVALID', undefined, { cause: error }); }
      validateRuntime(runtime, ids);
      const intervals = records.map(record => ({ id: record.id, start: record.start, end: record.end }));
      const intervalIds = new Set(records.map(record => record.id));
      if (runtime) {
        if (runtime.active) intervals.push({ id: 'current', start: runtime.active.start, end: Infinity });
        for (const pending of [runtime.pending, ...runtime.pendingQueue]) {
          if (!pending) continue;
          assert(!intervalIds.has(pending.id));
          intervalIds.add(pending.id);
          intervals.push({ id: pending.id, start: pending.start, end: pending.end ?? Infinity });
        }
      }
      intervals.sort((a, b) => a.start - b.start || a.end - b.end);
      let previousEnd = -Infinity;
      for (const interval of intervals) {
        if (interval.end === interval.start) continue;
        assert(interval.start >= previousEnd);
        previousEnd = interval.end;
      }
      return { projects, records, settings, runtime };
    } catch (error) { throw storageFailure(error); }
  }

  /** Called inside transaction; optional prior state makes checkpoints independent of history size in SQLite. */
  writeState(next: PersistedState, previous?: PersistedState): void {
    const before = previous ?? this.load();
    const records = new Map(next.records.map(record => [record.id, record]));
    const oldRecords = new Map(before.records.map(record => [record.id, record]));
    const projects = new Map(next.projects.map(project => [project.id, project]));
    const oldProjects = new Map(before.projects.map(project => [project.id, project]));
    const remove = this.db.prepare('DELETE FROM timi_records WHERE id = ?');
    for (const record of before.records) if (!records.has(record.id)) remove.run(record.id);
    const projectStatement = this.db.prepare(`INSERT INTO timi_projects(id, name, name_key, archived) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, archived = excluded.archived`);
    for (const project of next.projects) if (JSON.stringify(oldProjects.get(project.id)) !== JSON.stringify(project)) projectStatement.run(project.id, project.name, projectKey(project.name), Number(project.archived));
    const recordStatement = this.db.prepare(`INSERT INTO timi_records(id, start_ms, end_ms, kind, project_id, source) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET start_ms = excluded.start_ms, end_ms = excluded.end_ms, kind = excluded.kind, project_id = excluded.project_id, source = excluded.source`);
    for (const record of next.records) if (JSON.stringify(oldRecords.get(record.id)) !== JSON.stringify(record)) recordStatement.run(record.id, record.start, record.end, record.kind, record.projectId, record.source);
    const deleteProject = this.db.prepare('DELETE FROM timi_projects WHERE id = ?');
    for (const project of before.projects) if (!projects.has(project.id)) deleteProject.run(project.id);
    this.db.prepare('UPDATE timi_settings SET idle_minutes = ?, reminder_minutes = ? WHERE id = 1').run(next.settings.idleMinutes, next.settings.reminderMinutes);
    this.db.prepare('UPDATE timi_runtime SET state_json = ? WHERE id = 1').run(JSON.stringify(next.runtime));
  }

  close(): void {
    if (this.closed) return;
    try { this.db.close(); this.closed = true; } catch (error) { throw storageFailure(error); }
  }

  private validateLegacySchema(): void {
    const expected: Record<string, string[]> = {
      projects: ['id', 'name', 'name_key'], periods: ['id', 'project_id', 'start_ms', 'end_ms'],
      breaks: ['id', 'start_ms', 'end_ms'], idle_periods: ['id', 'project_id', 'start_ms', 'end_ms', 'returned', 'classification'],
      settings: ['id', 'idle_minutes'],
    };
    for (const [table, columns] of Object.entries(expected)) {
      const actual = this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      assert(actual.length === columns.length && columns.every(column => actual.includes(column)));
    }
  }

  private migrateLegacy(): void {
    const projects = this.db.prepare('SELECT id, name FROM projects').all().map(row => ({ id: row.id, name: row.name, archived: false })) as Project[];
    const keys = new Set<string>();
    const ids = new Set<string>();
    for (const project of projects) {
      assert(typeof project.id === 'string' && typeof project.name === 'string' && projectKey(project.name).length > 0 && !keys.has(projectKey(project.name)));
      keys.add(projectKey(project.name)); ids.add(project.id);
    }
    const idle = this.db.prepare('SELECT * FROM idle_periods ORDER BY start_ms, rowid').all();
    const classified = new Set(idle.filter(row => row.classification !== null).map(row => row.id));
    const records: TimeRecord[] = [
      ...this.db.prepare('SELECT * FROM periods').all().map(row => ({ id: row.id, start: row.start_ms, end: row.end_ms, kind: 'work', projectId: row.project_id, source: classified.has(row.id) ? 'idle' : 'tracked' })),
      ...this.db.prepare('SELECT * FROM breaks').all().map(row => ({ id: row.id, start: row.start_ms, end: row.end_ms, kind: 'break', projectId: null, source: classified.has(row.id) ? 'idle' : 'tracked' })),
    ] as TimeRecord[];
    const recordIds = new Set<string>();
    for (const record of records) {
      assert(typeof record.id === 'string' && !recordIds.has(record.id) && validTimestamp(record.start) && validTimestamp(record.end) && record.end >= record.start);
      assert(record.kind !== 'work' || ids.has(record.projectId!)); recordIds.add(record.id);
    }
    const pending: PendingPeriod[] = idle.filter(row => row.classification === null).map(row => {
      assert(typeof row.id === 'string' && typeof row.project_id === 'string' && ids.has(row.project_id) && validTimestamp(row.start_ms) && validTimestamp(row.end_ms) && row.end_ms >= row.start_ms);
      return { id: row.id, start: row.start_ms, end: row.end_ms, projectId: row.project_id, reason: 'idle', resume: false };
    });
    const oldSettings = this.db.prepare('SELECT idle_minutes FROM settings WHERE id = 1').get();
    assert(oldSettings && validMinutes(oldSettings.idle_minutes));
    const runtime = freshRuntime(0);
    runtime.pending = pending.shift() ?? null;
    runtime.pendingQueue = pending;
    runtime.cleanExit = true;
    this.db.exec(SCHEMA);
    this.writeState({ projects, records, settings: { ...DEFAULT_SETTINGS, idleMinutes: oldSettings.idle_minutes }, runtime }, { projects: [], records: [], settings: DEFAULT_SETTINGS, runtime: null });
    this.load();
  }
}
