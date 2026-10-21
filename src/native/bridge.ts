/** Private backend bridge. This global only exists in an isolated JavaScriptCore context,
 * never in a webview, and exposes no networking or general filesystem API. */
declare global {
  var __timiNative: (request: string) => string;
  var __timiInitialize: (path: string) => string;
  var __timiDispatch: (method: string, args: string) => string;
}

export function native<T>(request: Record<string, unknown>): T {
  const response = JSON.parse(globalThis.__timiNative(JSON.stringify(request))) as
    { ok: true; value: T } | { ok: false; error: string };
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
