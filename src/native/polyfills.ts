// JavaScriptCore has no browser structuredClone host function. Application state
// consists solely of arrays and plain records; retain undefined and numeric values
// exactly instead of using a lossy JSON serialization round trip.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => {
    if (Array.isArray(value)) return value.map(item => structuredClone(item)) as T;
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) result[key] = structuredClone(item);
      return result as T;
    }
    return value;
  };
}
// Array.at was added after the initial macOS 12 release.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value(this: unknown[], index: number) {
      const integer = Math.trunc(index) || 0;
      return this[integer < 0 ? this.length + integer : integer];
    }, writable: true, configurable: true,
  });
}
