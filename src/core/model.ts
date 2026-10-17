import type { ActivePeriod, PendingPeriod, Project, Settings, TimeRecord } from '../shared.js';

export interface RuntimeState {
  active: ActivePeriod | null;
  pending: PendingPeriod | null;
  pendingQueue: PendingPeriod[];
  resumeProjectId: string | null;
  lastActivity: number;
  lastSampleAt: number;
  lastIdleMs: number | null;
  locked: boolean;
  sleeping: boolean;
  awaitingReturn: boolean;
  wasInactive: boolean;
  reminderActiveMs: number;
  reminderAnchor: number;
  reminderDue: boolean;
  checkpointAt: number;
  cleanExit: boolean;
}
export interface PersistedState {
  projects: Project[];
  records: TimeRecord[];
  settings: Settings;
  runtime: RuntimeState | null;
}
export const DEFAULT_SETTINGS: Settings = { idleMinutes: 5, reminderMinutes: 10 };
export const MAX_DATE_MS = 8_640_000_000_000_000;
export function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_DATE_MS;
}
export function validMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(value * 60_000);
}
export function projectName(value: string): string { return value.trim().normalize('NFC'); }
export function projectKey(value: string): string { return projectName(value).toLowerCase(); }
export function freshRuntime(now: number): RuntimeState {
  return {
    active: null, pending: null, pendingQueue: [], resumeProjectId: null,
    lastActivity: now, lastSampleAt: now, lastIdleMs: null,
    locked: false, sleeping: false, awaitingReturn: false, wasInactive: false,
    reminderActiveMs: 0, reminderAnchor: now, reminderDue: false,
    checkpointAt: now, cleanExit: false,
  };
}
