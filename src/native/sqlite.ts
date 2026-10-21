import { native } from './bridge';

type Value = string | number | null;
type Row = Record<string, Value>;
let exclusiveAccess = false;

/** Production owns its database for the whole session, including idle periods.
 * This also excludes legacy Electron versions with a different singleton lock. */
export function useExclusiveDatabaseAccess(): void { exclusiveAccess = true; }

/** The subset of node:sqlite used by the shared store, implemented by system SQLite.
 * Statements are finalized after every operation, including failures. Transactions
 * remain synchronous on one connection for their entire lifetime. */
export class DatabaseSync {
  private readonly id: number;
  private closed = false;

  constructor(path: string) { this.id = native<number>({ op: 'open', path, exclusive: exclusiveAccess }); }

  exec(sql: string): void {
    this.assertOpen();
    native({ op: 'exec', id: this.id, sql });
  }

  prepare(sql: string): {
    all: (...params: Value[]) => Row[];
    get: (...params: Value[]) => Row | undefined;
    run: (...params: Value[]) => { changes: number; lastInsertRowid: number };
  } {
    this.assertOpen();
    const query = <T>(mode: string, params: Value[]) => {
      this.assertOpen();
      return native<T>({ op: 'query', id: this.id, sql, mode, params });
    };
    return {
      all: (...params) => query<Row[]>('all', params),
      get: (...params) => query<Row | null>('get', params) ?? undefined,
      run: (...params) => query<{ changes: number; lastInsertRowid: number }>('run', params),
    };
  }

  close(): void {
    if (this.closed) return;
    native({ op: 'close', id: this.id });
    this.closed = true;
  }

  private assertOpen(): void { if (this.closed) throw new Error('Database is closed'); }
}
