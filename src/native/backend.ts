import './polyfills';
import './bridge';
import { TrackingApplication } from '../core/application';
import { SqliteStore } from '../core/store';
import { AppFailure } from '../core/errors';
import { isCommand } from '../validation';
import { nativeMessages } from '../native-messages';
import { statusTime } from '../status-time';
import { useExclusiveDatabaseAccess } from './sqlite';
import type { AppError, NativeSample, Result, WorkGoalNotice } from '../shared';

let application: TrackingApplication | undefined;

function result(operation: () => unknown): string {
  let response: Result<unknown>;
  try { response = { ok: true, value: operation() ?? null }; }
  catch (error) {
    const value: AppError = error instanceof AppFailure
      ? { code: error.code, ...(error.details ? { details: error.details } : {}) }
      : { code: 'STORAGE_ERROR' };
    response = { ok: false, error: value };
  }
  return JSON.stringify(response);
}

globalThis.__timiInitialize = (path: string) => result(() => {
  if (application) throw new AppFailure('INVALID_COMMAND');
  useExclusiveDatabaseAccess();
  const store = new SqliteStore(path);
  try { application = new TrackingApplication(store); }
  catch (error) { try { store.close(); } catch { /* original failure wins */ } throw error; }
});

globalThis.__timiDispatch = (method: string, encoded: string) => result(() => {
  if (!application) throw new AppFailure('STORAGE_ERROR');
  const args: unknown = JSON.parse(encoded);
  switch (method) {
    case 'snapshot':
      if (!Number.isSafeInteger(args) || (args as number) > 0 || (args as number) < -100_000) throw new AppFailure('INVALID_COMMAND');
      return application.getSnapshot(args as number);
    case 'validateCommand':
      if (!isCommand(args)) throw new AppFailure('INVALID_COMMAND');
      return null;
    case 'command':
      if (!isCommand(args)) throw new AppFailure('INVALID_COMMAND');
      return application.execute(args);
    case 'sample': application.sample(args as NativeSample); return null;
    case 'checkpoint': application.checkpoint(); return null;
    case 'quit': application.quit(); return null;
    case 'notices': return application.getWorkGoalNotices();
    case 'acknowledge': {
      const notice = args as WorkGoalNotice | null;
      if (!notice || typeof notice !== 'object' || !['day', 'week'].includes(notice.kind)
        || typeof notice.period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(notice.period)
        || !Number.isSafeInteger(notice.targetMs) || notice.targetMs < 0
        || !Number.isSafeInteger(notice.workedMs) || notice.workedMs < 0) throw new AppFailure('INVALID_COMMAND');
      application.acknowledgeWorkGoalNotice(notice); return null;
    }
    case 'presentation':
      if (args !== 'de' && args !== 'en') throw new AppFailure('INVALID_COMMAND');
      return { display: statusTime(application.getSnapshot()), messages: nativeMessages[args] };
    default: throw new AppFailure('INVALID_COMMAND');
  }
});
