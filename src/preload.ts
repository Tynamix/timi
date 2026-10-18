import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, AppError, WorkspaceView } from './shared';

function listen<T>(channel: string, callback: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
const api: DesktopAPI = {
  snapshot: (weekOffset = 0) => ipcRenderer.invoke('timi:snapshot', weekOffset),
  command: command => ipcRenderer.invoke('timi:command', command),
  environment: () => ipcRenderer.invoke('timi:environment'),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('timi:login', enabled),
  openWindow: kind => ipcRenderer.invoke('timi:open', kind),
  workspaceView: () => ipcRenderer.invoke('timi:workspace-view'),
  onNavigate: callback => listen<WorkspaceView>('timi:navigate', callback),
  closeWindow: () => ipcRenderer.invoke('timi:close'),
  quit: () => ipcRenderer.invoke('timi:quit'),
  onChanged: callback => listen('timi:changed', callback),
  onError: callback => listen<AppError>('timi:error', callback),
  onFocus: callback => listen('timi:focus', callback),
};
contextBridge.exposeInMainWorld('timi', api);
