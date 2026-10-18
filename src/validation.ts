import type { Command, RecordInput } from './shared';
import { validWorkGoals } from './core/work-goals';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 16_384;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const record = (v: unknown): v is RecordInput => object(v) && keys(v, ['start', 'end', 'kind', 'projectId'])
  && integer(v.start) && integer(v.end) && (v.kind === 'work' || v.kind === 'break') && (v.projectId === null || text(v.projectId));

/** Reject unexpected fields as well as wrong types before the application boundary. */
export function isCommand(v: unknown): v is Command {
  if (!object(v) || !text(v.type)) return false;
  switch (v.type) {
    case 'start': case 'createProject': return keys(v, ['type', 'name']) && text(v.name);
    case 'pause': case 'resume': case 'stop': case 'later': return keys(v, ['type']);
    case 'resolve': return keys(v, ['type', 'choice', 'pendingId', 'projectId', 'projectName']) && ['work', 'break', 'discard'].includes(String(v.choice)) && (v.pendingId === undefined || text(v.pendingId))
      && (v.projectId === undefined || text(v.projectId)) && (v.projectName === undefined || text(v.projectName));
    case 'settings': return keys(v, ['type', 'idleMinutes', 'reminderMinutes', 'workGoals']) && integer(v.idleMinutes) && integer(v.reminderMinutes)
      && (v.workGoals === undefined || validWorkGoals(v.workGoals));
    case 'renameProject': return keys(v, ['type', 'id', 'name']) && text(v.id) && text(v.name);
    case 'archiveProject': return keys(v, ['type', 'id', 'archived']) && text(v.id) && typeof v.archived === 'boolean';
    case 'correct': return keys(v, ['type', 'removeIds', 'records']) && Array.isArray(v.removeIds) && Array.isArray(v.records)
      && v.removeIds.length <= 10_000 && v.records.length <= 10_000 && v.removeIds.every(text) && v.records.every(record);
    default: return false;
  }
}
