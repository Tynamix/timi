// Test-only adapters let the original application suite execute in JavaScriptCore.
// Temporary directories are created by the Node test launcher, never the backend.
import './polyfills';
import './bridge';
type Context = { after: (operation: () => void) => void };
const tests: { name: string; operation: (context: Context) => void }[] = [];
let directory = '';
let nextDirectory = 0;
const passed: string[] = [];
const skipped: string[] = [];
export function test(name: string, operation: (context: Context) => void): void { tests.push({ name, operation }); }
function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
    && same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
function check(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
export const assert = {
  equal(actual: unknown, expected: unknown, message?: string) { check(Object.is(actual, expected), message ?? `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); },
  deepEqual(actual: unknown, expected: unknown, message?: string) { check(same(actual, expected), message ?? `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); },
  throws(operation: () => void, validator?: (error: unknown) => boolean) {
    try { operation(); } catch (error) { if (validator) check(validator(error), 'Thrown error did not match'); return; }
    throw new Error('Expected operation to throw');
  },
  doesNotThrow(operation: () => void) { operation(); },
};
export function mkdtempSync(): string { return `${directory}/${++nextDirectory}`; }
export function rmSync(): void { /* The launcher removes all directories after the engine exits. */ }
export function unsupportedFilesystem(): never { throw new Error('File byte checks run externally against the native process'); }
export function join(...parts: string[]): string { return parts.join('/'); }
export function tmpdir(): string { return ''; }

globalThis.__timiInitialize = path => {
  directory = path;
  // JSC chooses the host timezone before running tests. Each zone gets its own
  // native process, instead of pretending process.env can reconfigure JSC.
  const zone = new Date(2026, 0, 1).getTimezoneOffset() === -60 ? 'Europe/Berlin' : 'America/New_York';
  (globalThis as unknown as { process: { env: Record<string, string> } }).process = { env: { TZ: zone } };
  try {
    for (const { name, operation } of tests) {
      if (name.startsWith('unreadable database') || (name.includes(' in ') && /(?:Europe\/Berlin|America\/New_York)$/.test(name) && !name.endsWith(zone))) {
        skipped.push(name); continue;
      }
      const cleanup: (() => void)[] = [];
      try { operation({ after: callback => cleanup.push(callback) }); passed.push(name); }
      catch (error) { throw new Error(`${name}: ${String(error)}`); }
      finally { for (const callback of cleanup.reverse()) callback(); }
    }
    return JSON.stringify({ ok: true, value: null });
  } catch (error) { return JSON.stringify({ ok: false, error: String(error), passed }); }
};
globalThis.__timiDispatch = () => JSON.stringify({ ok: true, value: { passed, skipped } });
