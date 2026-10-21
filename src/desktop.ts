import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppError, DesktopAPI, Result, UpdateStatus, WorkspaceView } from './shared';

const subscriptions: Promise<unknown>[] = [];
function subscribe<T>(event: string, callback: (value: T) => void): () => void {
  let cancelled = false;
  let dispose: (() => void) | undefined;
  subscriptions.push(listen<T>(event, message => callback(message.payload)).then(unlisten => {
    if (cancelled) unlisten(); else dispose = unlisten;
  }));
  return () => { cancelled = true; dispose?.(); };
}
const call = <T>(action: string, value: unknown = null): Promise<Result<T>> => invoke('desktop', { action, value });
const api: DesktopAPI = {
  updateStatus: () => call('update-status'),
  checkUpdate: () => call('update-check'),
  installUpdate: () => call('update-install'),
  onUpdate: callback => subscribe<UpdateStatus>('timi:update', callback),
  snapshot: (offset = 0) => call('snapshot', offset),
  command: command => call('command', command),
  environment: () => call('environment'),
  setLaunchAtLogin: enabled => call('login', enabled),
  openWindow: view => call('open', view),
  workspaceView: () => call('workspace-view'),
  closeWindow: () => call('close'),
  quit: () => call('quit'),
  onNavigate: callback => subscribe<WorkspaceView>('timi:navigate', callback),
  onChanged: callback => subscribe('timi:changed', callback),
  onError: callback => subscribe<AppError>('timi:error', callback),
  onFocus: callback => subscribe('timi:focus', callback),
};
Object.defineProperty(window, 'timi', { value: Object.freeze(api), writable: false, configurable: false });

/** Register listeners before native code can reveal a window or send its initial error. */
export async function desktopReady(): Promise<void> {
  await Promise.all(subscriptions);
  await call('ready');
}
