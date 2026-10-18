import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, session, Tray } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SqliteStore } from './core/store';
import { TrackingApplication } from './core/application';
import { isCommand } from './validation';
import { detectLocale, nativeMessages } from './native-messages';
import type { AppError, Environment, Locale, Result, Snapshot, WindowKind, WorkGoalNotice } from './shared';

app.setName('timi');
const dataArgument = process.argv.find(arg => arg.startsWith('--data-directory='));
app.setPath('userData', dataArgument ? resolve(dataArgument.slice('--data-directory='.length)) : join(app.getPath('appData'), 'timi'));
// Chromium background services are unnecessary for this entirely local application.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-pings');

let locale: Locale = 'en';
let store: SqliteStore | undefined;
let tracking: TrackingApplication | undefined;
let tray: Tray | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let quitting = false;
let locked = false;
let screenLocked = false;
let sessionInactive = false;
let sleeping = false;
let stickyError: AppError | null = null;
let presentedPending: string | null = null;
let reminderPresented = false;
const goalNotifications = new Map<string, Notification>();
const goalReceipts = new Map<string, WorkGoalNotice>();
const goalRetryAt = new Map<string, number>();
const windows = new Map<WindowKind, BrowserWindow>();
const loaded = new Set<WindowKind>();
const pageURL = pathToFileURL(join(__dirname, 'index.html')).href;
const msg = () => nativeMessages[locale];
const nativeErrorText = (error: AppError) => error.code === 'CLOCK_INVALID' ? msg().clock : error.code === 'ACTIVITY_ERROR' ? msg().activity : msg().save;
const time = (ms: number) => { const minutes = Math.floor(ms / 60_000); return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`; };

function errorValue(error: unknown): AppError {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)) {
    return { code: error.code, ...('details' in error ? { details: error.details as AppError['details'] } : {}) };
  }
  return { code: 'STORAGE_ERROR' };
}
function report(error: unknown): AppError {
  const value = errorValue(error);
  console.error('[timi]', value.code); // Never log project names, input contents, or time records.
  if (stickyError?.code !== value.code) {
    for (const win of windows.values()) if (!win.isDestroyed()) win.webContents.send('timi:error', value);
  }
  stickyError = value;
  return value;
}
function sample(): void {
  let idleMs: number;
  try {
    idleMs = powerMonitor.getSystemIdleTime() * 1000;
    if (!Number.isSafeInteger(idleMs) || idleMs < 0) throw new Error();
  } catch { throw { code: 'ACTIVITY_ERROR' }; }
  tracking!.sample({ idleMs, locked, sleeping });
}
function makeWindow(kind: WindowKind): BrowserWindow {
  const existing = windows.get(kind);
  if (existing && !existing.isDestroyed()) return existing;
  const sizes: Record<WindowKind, [number, number]> = { entry: [440, 570], overview: [1120, 780], settings: [540, 790], clarification: [580, 570] };
  const [width, height] = sizes[kind];
  const win = new BrowserWindow({
    width, height, minWidth: kind === 'overview' ? 900 : width, minHeight: kind === 'overview' ? 640 : height,
    show: false, frame: kind !== 'entry', resizable: kind === 'overview',
    minimizable: kind !== 'clarification', maximizable: kind === 'overview', fullscreenable: false,
    skipTaskbar: true, title: 'timi', backgroundColor: '#f5f4ef',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false, webSecurity: true, allowRunningInsecureContent: false },
  });
  windows.set(kind, win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('render-process-gone', () => {
    if (quitting) return;
    loaded.delete(kind);
    void win.loadFile(join(__dirname, 'index.html'), { query: { window: kind } });
  });
  win.webContents.on('did-finish-load', () => {
    loaded.add(kind);
    if (stickyError) win.webContents.send('timi:error', stickyError);
    if (kind === 'clarification' && tracking) syncWindows(tracking.getSnapshot());
  });
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (kind !== 'clarification') win.hide();
  });
  if (kind === 'entry') win.on('blur', () => win.hide());
  win.on('focus', () => {
    if (loaded.has(kind)) win.webContents.send('timi:focus');
  });
  void win.loadFile(join(__dirname, 'index.html'), { query: { window: kind } });
  return win;
}
function foreground(win: BrowserWindow, kind: WindowKind): void {
  const reveal = () => {
    if (win.isDestroyed() || quitting || locked || sleeping) return;
    if (kind !== 'entry') windows.get('entry')?.hide();
    win.show();
    app.focus({ steal: true });
    win.focus();
    win.webContents.send('timi:focus');
  };
  if (loaded.has(kind)) reveal(); else win.webContents.once('did-finish-load', reveal);
}
function showEntry(): void {
  if (!tracking || !tray || locked || sleeping) return;
  if (tracking.getSnapshot().pending) { showClarification(true); return; }
  const win = makeWindow('entry');
  const anchor = tray.getBounds();
  const area = screen.getDisplayMatching(anchor).workArea;
  const [width, height] = win.getSize();
  win.setPosition(Math.round(Math.max(area.x, Math.min(anchor.x + anchor.width / 2 - width / 2, area.x + area.width - width))),
    Math.round(Math.max(area.y, Math.min(anchor.y + anchor.height + 6, area.y + area.height - height))));
  foreground(win, 'entry');
}
function showClarification(explicit = false): void {
  if (!tracking) return;
  const state = tracking.getSnapshot();
  if (!state.pending || !state.canPresent || locked || sleeping) return;
  const win = makeWindow('clarification');
  if (!loaded.has('clarification')) return;
  if (explicit || presentedPending !== state.pending.id) {
    presentedPending = state.pending.id;
    windows.get('entry')?.hide();
    foreground(win, 'clarification');
  }
}
function syncWindows(state: Snapshot): void {
  if (!state.pending) { windows.get('clarification')?.hide(); presentedPending = null; }
  else if (!state.canPresent || locked || sleeping) windows.get('clarification')?.hide();
  else {
    const win = windows.get('clarification');
    // Returning from lock/sleep re-shows the same question without repeatedly taking focus.
    if (presentedPending === state.pending.id && win && loaded.has('clarification') && !win.isVisible()) win.showInactive();
    showClarification();
  }
  if (state.reminderDue && state.canPresent && !state.pending && !reminderPresented && !locked && !sleeping) {
    reminderPresented = true;
    showEntry();
  }
}
function refresh(): void {
  if (!tracking || quitting) return;
  const state = tracking.getSnapshot();
  const status = state.pending ? msg().pending : state.mode === 'break' ? msg().break : state.mode === 'work' ? msg().work : msg().stopped;
  tray?.setTitle(`${stickyError || state.pending ? '! ' : state.mode === 'break' ? 'Ⅱ ' : state.mode === 'untracked' ? '■ ' : ''}${time(state.todayMs)}`, { fontType: 'monospacedDigit' });
  tray?.setToolTip(`timi · ${msg().today}: ${time(state.todayMs)}\n${stickyError ? nativeErrorText(stickyError) : status}`);
  for (const win of windows.values()) if (!win.isDestroyed()) win.webContents.send('timi:changed');
  syncWindows(state);
  syncGoalNotifications(state);
}
function syncGoalNotifications(state: Snapshot): void {
  if (!tracking) return;
  try {
    for (const [key, notice] of goalReceipts) {
      tracking.acknowledgeWorkGoalNotice(notice);
      goalReceipts.delete(key);
    }
    if (stickyError || !state.canPresent || locked || sleeping || !Notification.isSupported()) return;
    for (const notice of tracking.getWorkGoalNotices()) {
      const key = `${notice.kind}:${notice.period}`;
      if (goalNotifications.has(key) || goalReceipts.has(key) || (goalRetryAt.get(key) ?? 0) > state.now) continue;
      const notification = new Notification({
        title: notice.kind === 'day' ? msg().dailyGoalTitle : msg().weeklyGoalTitle,
        body: (notice.kind === 'day' ? msg().dailyGoalBody : msg().weeklyGoalBody).replace('{time}', time(notice.targetMs)),
      });
      goalNotifications.set(key, notification);
      notification.once('show', () => {
        goalReceipts.set(key, notice);
        try { tracking!.acknowledgeWorkGoalNotice(notice); goalReceipts.delete(key); }
        catch (error) { report(error); }
      });
      notification.once('close', () => { goalNotifications.delete(key); });
      notification.once('failed', () => { goalNotifications.delete(key); goalRetryAt.set(key, Date.now() + 60_000); });
      notification.on('click', () => { foreground(makeWindow('overview'), 'overview'); });
      try { notification.show(); }
      catch { goalNotifications.delete(key); goalRetryAt.set(key, Date.now() + 60_000); }
    }
  } catch (error) { report(error); }
}
function attemptQuit(): void {
  if (quitting) return;
  sample();
  tracking!.quit();
  quitting = true;
  if (timer) clearInterval(timer);
  app.quit();
}
function nativeQuit(): void {
  try { attemptQuit(); }
  catch (error) {
    const problem = report(error); refresh();
    void dialog.showMessageBox({ type: 'error', title: 'timi', message: nativeErrorText(problem),
      buttons: [msg().retry, msg().stayOpen], defaultId: 1, cancelId: 1, noLink: true,
    }).then(({ response }) => { if (response === 0 && !quitting) nativeQuit(); });
  }
}
function caller(event: Electron.IpcMainInvokeEvent): WindowKind | null {
  for (const [kind, win] of windows) {
    if (event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
      && event.senderFrame.url === `${pageURL}?window=${kind}`) return kind;
  }
  return null;
}
function handle<T>(channel: string, fn: (kind: WindowKind, value: unknown) => T): void {
  ipcMain.handle(channel, (event, value): Result<T> => {
    const kind = caller(event);
    if (!kind) return { ok: false, error: { code: 'INVALID_COMMAND' } };
    try { return { ok: true, value: fn(kind, value) }; }
    catch (error) {
      const problem = errorValue(error);
      if (['STORAGE_ERROR', 'CLOCK_INVALID', 'ACTIVITY_ERROR'].includes(problem.code)) report(error);
      if (problem.code === 'PENDING_REQUIRED') showClarification(true);
      refresh();
      return { ok: false, error: problem };
    }
  });
}
function installIPC(): void {
  handle('timi:snapshot', (_kind, offset) => {
    if (!Number.isSafeInteger(offset) || (offset as number) > 0 || (offset as number) < -100_000) throw { code: 'INVALID_COMMAND' };
    return tracking!.getSnapshot(offset as number);
  });
  handle('timi:command', (_kind, value) => {
    if (!isCommand(value)) throw { code: 'INVALID_COMMAND' };
    sample();
    const state = tracking!.execute(value);
    if (['start', 'pause', 'resume', 'stop', 'later', 'resolve'].includes(value.type)
      || (value.type === 'settings' && !state.reminderDue)) reminderPresented = false;
    stickyError = null;
    refresh();
    return state;
  });
  handle('timi:environment', (): Environment => ({
    locale, version: app.getVersion(), packaged: app.isPackaged,
    loginAvailable: app.isPackaged && process.platform === 'darwin',
    launchAtLogin: app.getLoginItemSettings().status === 'enabled',
    launchAtLoginStatus: app.getLoginItemSettings().status,
  }));
  handle('timi:login', (_kind, enabled) => {
    if (typeof enabled !== 'boolean' || !app.isPackaged) throw { code: 'INVALID_COMMAND' };
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
      const actual = app.getLoginItemSettings().status === 'enabled';
      if (actual !== enabled) throw new Error();
      return actual;
    } catch { throw { code: 'LOGIN_ERROR' }; }
  });
  handle('timi:open', (_kind, kind) => {
    if (kind !== 'overview' && kind !== 'settings') throw { code: 'INVALID_COMMAND' };
    const win = makeWindow(kind);
    foreground(win, kind);
  });
  handle('timi:close', kind => { if (kind !== 'clarification') windows.get(kind)?.hide(); });
  handle('timi:quit', () => { attemptQuit(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showEntry());
  app.on('activate', () => showEntry());
  app.on('window-all-closed', () => { /* Menu-bar lifetime is independent of windows. */ });
  app.on('before-quit', event => {
    if (quitting || !tracking) return;
    event.preventDefault();
    nativeQuit();
  });
  app.on('will-quit', () => { store?.close(); });
  app.whenReady().then(() => {
    locale = detectLocale(app.getPreferredSystemLanguages());
    if (process.platform !== 'darwin') { dialog.showErrorBox('timi', 'This build of timi requires macOS 13 or later.'); app.exit(1); return; }
    app.setActivationPolicy('accessory');
    app.dock?.hide();
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !details.url.startsWith(pathToFileURL(__dirname + '/').href) });
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', event => event.preventDefault());
    mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
    store = new SqliteStore(join(app.getPath('userData'), 'tracking.sqlite'));
    tracking = new TrackingApplication(store, () => Date.now());
    screenLocked = powerMonitor.getSystemIdleState(1) === 'locked';
    locked = screenLocked;
    // A local template bitmap; macOS applies the current menu-bar foreground color.
    const image = nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAlUlEQVR4nO2VXQ6AIAyDuf+l9QTK+qdLWBPeaPuhZKw1OkjXZrWA+BSOhbFDKeF2MFeYJcf9yeU8xIzug4FQI7O3DKVc3khHWyBEMQ976RTPq2+AjgOyzyNltKMPaRzoCex3oCpYucsFtCuNPh2VTLojASR3JKHo7NSvozOZYRfPc0FZD4dOYJeXCkdWRK1gULjRGboBDEgOAZMySI8AAAAASUVORK5CYII=', 'base64')).resize({ width: 18, height: 18 });
    image.setTemplateImage(true);
    tray = new Tray(image);
    tray.on('click', () => { if (windows.get('entry')?.isVisible()) windows.get('entry')!.hide(); else showEntry(); });
    tray.on('right-click', () => tray!.popUpContextMenu(Menu.buildFromTemplate([
      { label: msg().entry, click: showEntry },
      ...(tracking!.getSnapshot().mode === 'untracked' ? [] : [{ label: msg().stop, click: () => {
        try { sample(); tracking!.execute({ type: 'stop' }); stickyError = null; reminderPresented = false; } catch (error) { report(error); }
        refresh();
      } }]),
      { label: msg().overview, click: () => foreground(makeWindow('overview'), 'overview') },
      { label: msg().settings, click: () => foreground(makeWindow('settings'), 'settings') },
      { type: 'separator' }, { label: msg().quit, click: nativeQuit },
    ])));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'timi', submenu: [{ label: msg().quit, accelerator: 'Command+Q', click: nativeQuit }] },
      { label: msg().edit, submenu: [
        { label: msg().undo, role: 'undo' }, { label: msg().redo, role: 'redo' }, { type: 'separator' },
        { label: msg().cut, role: 'cut' }, { label: msg().copy, role: 'copy' }, { label: msg().paste, role: 'paste' }, { label: msg().selectAll, role: 'selectAll' },
      ] },
    ]));
    installIPC();
    makeWindow('entry');
    const presence = (kind: 'locked' | 'sleeping' | 'sessionInactive', value: boolean) => {
      if (kind === 'locked') screenLocked = value;
      else if (kind === 'sessionInactive') sessionInactive = value;
      else sleeping = value;
      locked = screenLocked || sessionInactive;
      if (locked || sleeping) { windows.get('entry')?.hide(); windows.get('clarification')?.hide(); }
      try { sample(); tracking!.checkpoint(); stickyError = null; }
      catch (error) { report(error); }
      refresh();
    };
    powerMonitor.on('lock-screen', () => presence('locked', true));
    powerMonitor.on('unlock-screen', () => presence('locked', false));
    powerMonitor.on('suspend', () => presence('sleeping', true));
    powerMonitor.on('resume', () => presence('sleeping', false));
    powerMonitor.on('user-did-resign-active', () => presence('sessionInactive', true));
    powerMonitor.on('user-did-become-active', () => presence('sessionInactive', false));
    powerMonitor.on('shutdown', (...args: unknown[]) => {
      (args[0] as Electron.Event | undefined)?.preventDefault();
      nativeQuit();
    });
    let ticks = 0;
    timer = setInterval(() => {
      try { sample(); if (++ticks % 15 === 0) { tracking!.checkpoint(); stickyError = null; } }
      catch (error) { report(error); }
      refresh();
    }, 1000);
    sample(); refresh();
  }).catch(error => {
    console.error('[timi startup]', errorValue(error).code);
    dialog.showErrorBox('timi', `${msg().startup}\n\n${app.getPath('userData')}`);
    quitting = true;
    app.exit(1);
  });
}
