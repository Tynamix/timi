import { randomUUID } from 'node:crypto';
import type { ActivePeriod, Command, NativeSample, PendingPeriod, Project, RecordInput, Snapshot, TimeRecord } from '../shared.js';
import { accounting } from './accounting.js';
import { AppFailure } from './errors.js';
import { freshRuntime, projectKey, projectName, validMinutes, validTimestamp, type PersistedState, type RuntimeState } from './model.js';
import { SqliteStore } from './store.js';
export { AppFailure } from './errors.js';

type State = PersistedState & { runtime: RuntimeState };
type Observation = { at: number; input: NativeSample };

/** Platform-neutral application interface: every durable transition passes through one transaction. */
export class TrackingApplication {
  private state: State;
  private observations: Observation[] = [];

  constructor(readonly store: SqliteStore, private readonly clock: () => number = Date.now) {
    const now = this.readClock();
    const saved = store.load();
    const next = structuredClone(saved);
    const previous = saved.runtime;
    const runtime = freshRuntime(now);
    next.runtime = runtime;
    if (previous) {
      const savedPending = [previous.pending, ...previous.pendingQueue].filter((period): period is PendingPeriod => period !== null);
      for (const period of savedPending) {
        const fixed = { ...period, end: period.end ?? Math.max(period.start, previous.checkpointAt), resume: false };
        if (!runtime.pending) runtime.pending = fixed;
        else runtime.pendingQueue.push(fixed);
      }
      if (!previous.cleanExit && previous.active) {
        const active = previous.active;
        const end = Math.max(active.start, previous.checkpointAt);
        let start = active.start;
        if (active.kind === 'work') {
          const certainEnd = Math.max(active.start, Math.min(end, previous.lastActivity));
          this.appendRecord(next, active.start, certainEnd, 'work', active.projectId, 'tracked');
          start = certainEnd;
        }
        if (end > start) {
          const recovery: PendingPeriod = { id: randomUUID(), start, end, projectId: active.projectId, reason: 'recovery', resume: false };
          if (!runtime.pending) runtime.pending = recovery;
          else runtime.pendingQueue.push(recovery);
        }
      }
    }
    this.store.transaction(() => this.store.writeState(next, saved));
    this.state = next as State;
  }

  sample(input: NativeSample): void {
    this.validateSample(input);
    const at = this.readClock();
    const latest = this.observations.at(-1)?.at ?? this.state.runtime.lastSampleAt;
    if (at < latest) throw new AppFailure('CLOCK_INVALID');
    this.observations.push({ at, input: { ...input } });
    this.flushObservations();
  }

  execute(command: Command): Snapshot {
    this.flushObservations();
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') throw new AppFailure('INVALID_COMMAND');
    const now = this.readClock();
    this.mutate(now, draft => {
      switch (command.type) {
        case 'start': {
          if (typeof command.name !== 'string') throw new AppFailure('INVALID_PROJECT');
          const name = projectName(command.name);
          if (!name) return;
          this.requireResolved(draft);
          const existing = draft.projects.find(project => projectKey(project.name) === projectKey(name));
          if (existing && draft.runtime.active?.kind === 'work' && draft.runtime.active.projectId === existing.id) return;
          const project = this.ensureProject(draft, name);
          this.startWork(draft, project.id, now);
          return;
        }
        case 'createProject':
          if (typeof command.name !== 'string' || !projectName(command.name)) throw new AppFailure('INVALID_PROJECT');
          this.ensureProject(draft, command.name);
          return;
        case 'pause': {
          this.requireResolved(draft);
          if (draft.runtime.active?.kind === 'break') return;
          const resume = draft.runtime.active?.projectId ?? null;
          this.finishActive(draft, now);
          this.assertNoConflict(draft, { start: now, end: Infinity, kind: 'break', projectId: null });
          draft.runtime.active = { kind: 'break', start: now, projectId: null };
          draft.runtime.resumeProjectId = resume;
          this.resetReminder(draft.runtime, now);
          return;
        }
        case 'resume': {
          this.requireResolved(draft);
          if (draft.runtime.active?.kind !== 'break' || !draft.runtime.resumeProjectId) return;
          this.startWork(draft, draft.runtime.resumeProjectId, now);
          return;
        }
        case 'stop':
          this.stop(draft, now);
          return;
        case 'later':
          if (!draft.runtime.active && !draft.runtime.pending) this.resetReminder(draft.runtime, now);
          return;
        case 'resolve':
          this.resolve(draft, command, now);
          return;
        case 'settings': {
          if (!validMinutes(command.idleMinutes) || !validMinutes(command.reminderMinutes)) throw new AppFailure('INVALID_SETTINGS');
          draft.settings = { idleMinutes: command.idleMinutes, reminderMinutes: command.reminderMinutes };
          this.detectIdle(draft, now, false);
          this.updateReminderDue(draft);
          return;
        }
        case 'renameProject': {
          if (typeof command.id !== 'string' || typeof command.name !== 'string' || !projectName(command.name)) throw new AppFailure('INVALID_PROJECT');
          const project = this.projectById(draft, command.id);
          const name = projectName(command.name);
          if (draft.projects.some(other => other.id !== project.id && projectKey(other.name) === projectKey(name))) throw new AppFailure('PROJECT_EXISTS');
          project.name = name;
          return;
        }
        case 'archiveProject':
          if (typeof command.id !== 'string' || typeof command.archived !== 'boolean') throw new AppFailure('INVALID_PROJECT');
          this.projectById(draft, command.id).archived = command.archived;
          return;
        case 'correct':
          this.correct(draft, command.removeIds, command.records, now);
          return;
        default:
          throw new AppFailure('INVALID_COMMAND');
      }
    });
    return this.getSnapshot();
  }

  getSnapshot(weekOffset = 0): Snapshot {
    const now = this.readClock();
    const { runtime, projects, records, settings } = this.state;
    const report = accounting(records, runtime.active, projects, now, weekOffset);
    return structuredClone({
      now,
      mode: runtime.pending ? 'pending' : runtime.active?.kind ?? 'untracked',
      active: runtime.active, pending: runtime.pending, resumeProjectId: runtime.resumeProjectId,
      projects: [...projects].sort((a, b) => projectKey(a.name).localeCompare(projectKey(b.name))),
      settings, records: [...records].sort((a, b) => a.start - b.start || a.end - b.end),
      ...report, reminderDue: runtime.reminderDue,
      canPresent: !runtime.locked && !runtime.sleeping && !runtime.awaitingReturn,
    });
  }

  checkpoint(): void {
    this.flushObservations();
    this.mutate(this.readClock(), () => {}, true);
  }

  quit(): void {
    this.flushObservations();
    const now = this.readClock();
    this.mutate(now, draft => {
      this.stop(draft, now);
      draft.runtime.cleanExit = true;
    }, true);
  }

  /** Closing without quit deliberately simulates an unclean exit; normal lifecycle calls quit first. */
  close(): void { this.store.close(); }

  private readClock(): number {
    const now = this.clock();
    if (!validTimestamp(now)) throw new AppFailure('CLOCK_INVALID');
    return now;
  }

  private mutate(now: number, operation: (draft: State) => void, force = false): void {
    if (now < this.state.runtime.lastSampleAt) throw new AppFailure('CLOCK_INVALID');
    const draft = structuredClone(this.state);
    operation(draft);
    if (!force && JSON.stringify(draft) === JSON.stringify(this.state)) return;
    draft.runtime.checkpointAt = now;
    this.store.transaction(() => this.store.writeState(draft, this.state));
    this.state = draft;
  }

  private validateSample(input: NativeSample): void {
    if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.idleMs) || input.idleMs < 0 || typeof input.locked !== 'boolean' || typeof input.sleeping !== 'boolean') throw new AppFailure('INVALID_COMMAND');
  }

  private flushObservations(): void {
    while (this.observations.length > 0) {
      const observation = this.observations[0]!;
      const draft = structuredClone(this.state);
      this.observe(draft, observation);
      // Ordinary activity remains in memory until a periodic checkpoint; transitions are immediate.
      const transition = JSON.stringify(draft.runtime.active) !== JSON.stringify(this.state.runtime.active)
        || JSON.stringify(draft.runtime.pending) !== JSON.stringify(this.state.runtime.pending)
        || draft.records.length !== this.state.records.length;
      if (transition) {
        draft.runtime.checkpointAt = observation.at;
        this.store.transaction(() => this.store.writeState(draft, this.state));
      }
      this.state = draft;
      this.observations.shift();
    }
  }

  private observe(draft: State, { at: now, input }: Observation): void {
    const runtime = draft.runtime;
    if (now < runtime.lastSampleAt) throw new AppFailure('CLOCK_INVALID');
    const threshold = draft.settings.idleMinutes * 60_000;
    const previouslySuspended = runtime.locked || runtime.sleeping;
    const suspended = input.locked || input.sleeping;
    const previousActivity = runtime.lastActivity;
    const estimate = Math.max(-8_640_000_000_000_000, now - input.idleMs);
    // Native counters are commonly quantized to seconds. A drifting estimate while the counter
    // increases is not input; a reset or a near-zero counter is the only evidence of activity.
    const activityDetected = runtime.lastIdleMs === null || input.idleMs < 1_000
      || input.idleMs < runtime.lastIdleMs
      || estimate >= previousActivity + 1_000;
    const lastActivity = activityDetected ? Math.max(previousActivity, estimate) : previousActivity;
    const hadNewActivity = lastActivity > previousActivity;
    const wasInactive = runtime.wasInactive;
    // If the timer missed the threshold itself, a returning input still reveals the completed
    // inactivity streak. Classify it before advancing the last-activity anchor.
    if (hadNewActivity && runtime.active?.kind === 'work'
      && lastActivity - Math.max(runtime.active.start, previousActivity) >= threshold) {
      this.detectIdle(draft, lastActivity, false);
    }
    const gapWasInactive = hadNewActivity && lastActivity - Math.max(previousActivity, runtime.reminderAnchor) >= threshold;
    runtime.locked = input.locked;
    runtime.sleeping = input.sleeping;
    runtime.lastActivity = lastActivity;
    runtime.lastIdleMs = input.idleMs;
    runtime.lastSampleAt = now;
    runtime.wasInactive = input.idleMs >= threshold || suspended;

    if (runtime.pending && runtime.awaitingReturn && !suspended && (hadNewActivity || previouslySuspended)) runtime.awaitingReturn = false;
    if (!runtime.active && !runtime.pending) {
      if (suspended || previouslySuspended || wasInactive || gapWasInactive || input.idleMs >= threshold) {
        // The first observation after absence establishes a new activity anchor, without backfill.
        runtime.reminderAnchor = Math.max(runtime.reminderAnchor, lastActivity, now - input.idleMs);
      } else if (hadNewActivity && lastActivity > runtime.reminderAnchor) {
        const elapsed = lastActivity - runtime.reminderAnchor;
        // A large unsampled gap cannot establish active use. Frequent native sampling is required.
        if (elapsed < threshold) runtime.reminderActiveMs += elapsed;
        runtime.reminderAnchor = lastActivity;
      }
      this.updateReminderDue(draft);
    } else runtime.reminderDue = false;

    this.detectIdle(draft, now, suspended && !previouslySuspended);
    if (!suspended && runtime.pending && !runtime.awaitingReturn) runtime.reminderDue = false;
  }

  private detectIdle(draft: State, now: number, absenceBegan: boolean): void {
    const runtime = draft.runtime;
    if (runtime.active?.kind !== 'work' || runtime.pending) return;
    const idleStart = Math.max(runtime.active.start, runtime.lastActivity);
    const thresholdReached = now - idleStart >= draft.settings.idleMinutes * 60_000;
    if (!thresholdReached && !absenceBegan && !runtime.locked && !runtime.sleeping) return;
    const start = thresholdReached ? idleStart : now;
    const projectId = runtime.active.projectId;
    this.appendRecord(draft, runtime.active.start, start, 'work', projectId, 'tracked');
    runtime.active = null;
    runtime.pending = { id: randomUUID(), start, end: null, projectId, reason: 'idle', resume: true };
    runtime.resumeProjectId = null;
    runtime.awaitingReturn = thresholdReached && !absenceBegan;
    runtime.reminderDue = false;
  }

  private updateReminderDue(draft: State): void {
    const runtime = draft.runtime;
    runtime.reminderDue = !runtime.active && !runtime.pending && !runtime.locked && !runtime.sleeping
      && !runtime.wasInactive && runtime.reminderActiveMs >= draft.settings.reminderMinutes * 60_000;
  }

  private resetReminder(runtime: RuntimeState, now: number): void {
    runtime.reminderActiveMs = 0;
    runtime.reminderAnchor = now;
    runtime.reminderDue = false;
  }

  private projectById(draft: PersistedState, id: string): Project {
    const project = draft.projects.find(value => value.id === id);
    if (!project) throw new AppFailure('PROJECT_NOT_FOUND');
    return project;
  }

  private ensureProject(draft: State, rawName: string): Project {
    const name = projectName(rawName);
    if (!name || name.includes('\0')) throw new AppFailure('INVALID_PROJECT');
    const existing = draft.projects.find(project => projectKey(project.name) === projectKey(name));
    if (existing) { existing.archived = false; return existing; }
    const project = { id: randomUUID(), name, archived: false };
    draft.projects.push(project);
    return project;
  }

  private requireResolved(draft: State): void {
    if (draft.runtime.pending) throw new AppFailure('PENDING_REQUIRED');
  }

  private startWork(draft: State, projectId: string, now: number): void {
    this.projectById(draft, projectId);
    this.finishActive(draft, now);
    this.assertNoConflict(draft, { start: now, end: Infinity, kind: 'work', projectId });
    draft.runtime.active = { kind: 'work', start: now, projectId };
    draft.runtime.resumeProjectId = null;
    draft.runtime.lastActivity = now;
    draft.runtime.lastIdleMs = 0;
    draft.runtime.wasInactive = false;
    draft.runtime.awaitingReturn = false;
    this.resetReminder(draft.runtime, now);
  }

  private finishActive(draft: State, now: number): void {
    const active = draft.runtime.active;
    if (!active) return;
    if (now < active.start) throw new AppFailure('CLOCK_INVALID');
    this.appendRecord(draft, active.start, now, active.kind, active.projectId, 'tracked');
    draft.runtime.active = null;
  }

  private stop(draft: State, now: number): void {
    this.finishActive(draft, now);
    if (draft.runtime.pending) {
      if (now < draft.runtime.pending.start) throw new AppFailure('CLOCK_INVALID');
      draft.runtime.pending.end ??= now;
      draft.runtime.pending.resume = false;
    }
    draft.runtime.resumeProjectId = null;
    this.resetReminder(draft.runtime, now);
  }

  private resolve(draft: State, command: Extract<Command, { type: 'resolve' }>, now: number): void {
    const pending = draft.runtime.pending;
    if (!pending) throw new AppFailure('INVALID_COMMAND');
    if (command.pendingId !== undefined && command.pendingId !== pending.id) throw new AppFailure('INVALID_COMMAND');
    if (!['work', 'break', 'discard'].includes(command.choice)) throw new AppFailure('INVALID_COMMAND');
    if (pending.reason !== 'recovery' && (command.projectId !== undefined || command.projectName !== undefined)) throw new AppFailure('INVALID_COMMAND');
    if (command.projectId !== undefined && command.projectName !== undefined) throw new AppFailure('INVALID_PROJECT');
    let projectId = pending.projectId;
    if (command.choice === 'work') {
      if (command.projectId !== undefined) {
        if (typeof command.projectId !== 'string') throw new AppFailure('INVALID_PROJECT');
        projectId = this.projectById(draft, command.projectId).id;
      }
      if (command.projectName !== undefined) {
        if (typeof command.projectName !== 'string' || !projectName(command.projectName)) throw new AppFailure('INVALID_PROJECT');
        projectId = this.ensureProject(draft, command.projectName).id;
      }
      if (!projectId) throw new AppFailure('INVALID_PROJECT');
      this.projectById(draft, projectId);
    }
    const end = pending.end ?? now;
    if (end < pending.start) throw new AppFailure('CLOCK_INVALID');
    draft.runtime.pending = null;
    if (command.choice !== 'discard' && end > pending.start) {
      const record = { start: pending.start, end, kind: command.choice, projectId: command.choice === 'work' ? projectId : null };
      this.assertNoConflict(draft, record);
      this.appendRecord(draft, record.start, record.end, record.kind, record.projectId, pending.reason);
    }
    draft.runtime.awaitingReturn = false;
    draft.runtime.pending = draft.runtime.pendingQueue.shift() ?? null;
    draft.runtime.resumeProjectId = null;
    if (pending.resume && pending.end === null && !draft.runtime.pending) this.startWork(draft, pending.projectId!, now);
    else this.resetReminder(draft.runtime, now);
  }

  private appendRecord(draft: PersistedState, start: number, end: number, kind: 'work' | 'break', projectId: string | null, source: TimeRecord['source']): void {
    if (end <= start) return;
    draft.records.push({ id: randomUUID(), start, end, kind, projectId, source });
  }

  private correct(draft: State, removeIds: string[], inputs: RecordInput[], now: number): void {
    if (!Array.isArray(removeIds) || !Array.isArray(inputs) || removeIds.some(id => typeof id !== 'string') || new Set(removeIds).size !== removeIds.length) throw new AppFailure('INVALID_COMMAND');
    for (const id of removeIds) if (!draft.records.some(record => record.id === id)) throw new AppFailure('RECORD_NOT_FOUND');
    draft.records = draft.records.filter(record => !removeIds.includes(record.id));
    for (const input of inputs) {
      if (!input || typeof input !== 'object' || !validTimestamp(input.start) || !validTimestamp(input.end) || input.end <= input.start) throw new AppFailure('INVALID_RANGE');
      if (input.kind === 'work') {
        if (typeof input.projectId !== 'string') throw new AppFailure('INVALID_PROJECT');
        this.projectById(draft, input.projectId);
      } else if (input.kind !== 'break' || input.projectId !== null) throw new AppFailure('INVALID_PROJECT');
      this.assertNoConflict(draft, input);
      this.appendRecord(draft, input.start, input.end, input.kind, input.projectId, 'manual');
    }
    // A backward wall clock must not let a current interval disappear from overlap checks.
    if (draft.runtime.active && now < draft.runtime.active.start) throw new AppFailure('CLOCK_INVALID');
  }

  private assertNoConflict(draft: State, input: RecordInput): void {
    const conflicts: (TimeRecord | (ActivePeriod & { end: number; id: string }) | (PendingPeriod & { end: number }))[] = [...draft.records];
    if (draft.runtime.active) conflicts.push({ ...draft.runtime.active, end: Infinity, id: 'current' });
    for (const pending of [draft.runtime.pending, ...draft.runtime.pendingQueue]) if (pending) conflicts.push({ ...pending, end: pending.end ?? Infinity });
    const conflict = conflicts.find(record => record.end > record.start && input.start < record.end && input.end > record.start);
    if (conflict) {
      const details: Record<string, string | number> = { id: conflict.id, start: conflict.start, end: Number.isFinite(conflict.end) ? conflict.end : this.readClock() };
      if (conflict.projectId) details.projectId = conflict.projectId;
      throw new AppFailure('OVERLAP', details);
    }
  }
}
