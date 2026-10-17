/** Stable, localized at the UI boundary; SQLite messages never leak as product copy. */
export class AppFailure extends Error {
  constructor(readonly code: string, readonly details?: Record<string, string | number>, options?: ErrorOptions) {
    super(code, options);
    this.name = 'AppFailure';
  }
}
export function storageFailure(error: unknown): AppFailure {
  return error instanceof AppFailure ? error : new AppFailure('STORAGE_ERROR', undefined, { cause: error });
}
