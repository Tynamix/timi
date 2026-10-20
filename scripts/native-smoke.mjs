import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import electronPath from 'electron';
import { _electron } from 'playwright';

if (process.platform !== 'darwin') throw new Error('Native smoke checks require a macOS desktop session.');
const artifacts = resolve('artifacts/native-smoke');
await mkdir(artifacts, { recursive: true });
const checks = [];
const applications = [];
const childProcesses = new Map();
const directories = [];
const issues = [];
const record = description => { checks.push(description); console.log(`PASS ${description}`); };
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

async function eventually(check, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { last = error; }
    await pause(60);
  }
  throw new Error(`Timed out: ${description}`, { cause: last });
}

async function launch(language) {
  const directory = await mkdtemp(join(tmpdir(), 'timi-native-'));
  directories.push(directory);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({
    executablePath: process.env.TIMI_TEST_EXECUTABLE || electronPath,
    args: [...(process.env.TIMI_TEST_EXECUTABLE ? [] : ['.']), `--data-directory=${directory}`, '-AppleLanguages', `(${language})`],
    cwd: process.cwd(), env: environment, timeout: 30_000,
  });
  applications.push(application);
  childProcesses.set(application, application.process());
  const entry = await application.firstWindow();
  entry.on('pageerror', error => issues.push(String(error)));
  await entry.waitForSelector('#app[aria-busy="false"]');
  const nativeIdleSeconds = await application.evaluate(({ powerMonitor }) => powerMonitor.getSystemIdleTime());
  assert.equal(Number.isSafeInteger(nativeIdleSeconds) && nativeIdleSeconds >= 0, true);
  await application.evaluate(({ powerMonitor, app, BrowserWindow, Tray }) => {
    const setTitle = Tray.prototype.setTitle;
    Tray.prototype.setTitle = function (title, options) {
      globalThis.__timiSmokeTrayTitle = title;
      return setTitle.call(this, title, options);
    };
    globalThis.__timiSmokeWindowEvents = [];
    const watch = window => {
      for (const event of ['show', 'hide', 'focus', 'blur']) window.on(event, () => {
        globalThis.__timiSmokeWindowEvents.push({ event, url: window.webContents.getURL() });
      });
    };
    BrowserWindow.getAllWindows().forEach(watch);
    app.on('browser-window-created', (_event, window) => watch(window));
    app.on('activate', () => globalThis.__timiSmokeWindowEvents.push({ event: 'app-activate' }));
    // Start at the next local noon so correction examples a few hours earlier stay
    // in the displayed day/week, including real runs just after Monday midnight.
    const noon = new Date(); noon.setHours(12, 0, 0, 123);
    if (noon.getTime() < Date.now()) noon.setDate(noon.getDate() + 1);
    globalThis.__timiSmokeTime = noon.getTime();
    globalThis.__timiSmokeIdleSeconds = 0;
    Date.now = () => globalThis.__timiSmokeTime;
    powerMonitor.getSystemIdleTime = () => globalThis.__timiSmokeIdleSeconds;
  });
  const fixture = { application, entry, directory, nativeIdleSeconds };
  await showEntry(fixture);
  return fixture;
}

async function showEntry({ application, entry }) {
  await application.evaluate(({ app }) => { app.emit('activate'); });
  await eventually(() => visible(application, 'entry'), 'entry visible');
  await entry.locator('#project-entry').focus();
}

async function visible(application, kind) {
  return application.evaluate(({ BrowserWindow }, target) =>
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith(`window=${target}`))?.isVisible() ?? false, kind);
}

async function getWindow(application, kind) {
  const view = kind === 'settings' ? 'settings' : kind === 'overview' ? 'overview' : null;
  if (kind === 'settings') kind = 'overview';
  await eventually(() => application.windows().some(page => page.url().endsWith(`window=${kind}`)), `${kind} created`);
  const page = application.windows().find(page => page.url().endsWith(`window=${kind}`));
  page.on('pageerror', error => issues.push(String(error)));
  await page.waitForSelector('#app[aria-busy="false"]');
  if (view) await page.locator(`.${view}-page`).waitFor({ state: 'visible' });
  return page;
}

async function state(page) {
  const result = await page.evaluate(() => window.timi.snapshot());
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

async function command(page, value) {
  const result = await page.evaluate(value => window.timi.command(value), value);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

async function clock(fixture, milliseconds, idleSeconds = 0) {
  await fixture.application.evaluate((_electron, value) => {
    globalThis.__timiSmokeTime += value.milliseconds;
    globalThis.__timiSmokeIdleSeconds = value.idleSeconds;
  }, { milliseconds, idleSeconds });
}

async function signal(fixture, name) {
  await fixture.application.evaluate(({ powerMonitor }, event) => { powerMonitor.emit(event); }, name);
}

async function saveScreenshot(page, name) {
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
}

async function closeApplication(application) {
  const child = childProcesses.get(application);
  if (child.exitCode === null && child.signalCode === null) {
    try { await application.evaluate(({ app }) => { setImmediate(() => app.quit()); }); } catch {}
    try { await eventually(() => child.exitCode !== null || child.signalCode !== null, 'test application quit', 5_000); }
    catch { child.kill('SIGTERM'); }
  }
  try { await application.close(); } catch {}
}

async function windowDiagnostics(application) {
  return application.evaluate(({ BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), visible: window.isVisible(), focused: window.isFocused() })),
    events: globalThis.__timiSmokeWindowEvents.slice(-35),
  }));
}

function localInput(milliseconds) {
  const date = new Date(milliseconds);
  const two = value => String(value).padStart(2, '0');
  // Chromium canonicalizes redundant seconds and trailing fractional zeros.
  const fraction = String(date.getMilliseconds()).padStart(3, '0').replace(/0+$/, '');
  const seconds = date.getSeconds() || fraction ? `:${two(date.getSeconds())}${fraction ? `.${fraction}` : ''}` : '';
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}${seconds}`;
}

try {
  const f = await launch('en');
  const entry = f.entry;
  assert.equal(await entry.evaluate(() => document.documentElement.lang), 'en');
  const native = await f.application.evaluate(({ app, BrowserWindow }) => ({
    dockVisible: app.dock?.isVisible(), version: process.versions.electron,
    platform: process.platform, architecture: process.arch,
    preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  assert.equal(native.dockVisible, false);
  assert.equal(native.preferences.contextIsolation, true);
  assert.equal(native.preferences.nodeIntegration, false);
  assert.equal(native.preferences.sandbox, true);
  const osLogin = await f.application.evaluate(({ app }) => app.getLoginItemSettings());
  const environment = await entry.evaluate(() => window.timi.environment());
  assert.equal(environment.ok, true);
  assert.equal(environment.value.packaged, Boolean(process.env.TIMI_TEST_EXECUTABLE));
  assert.equal(environment.value.launchAtLogin, osLogin.openAtLogin);
  assert.equal(environment.value.launchAtLoginStatus, osLogin.status ?? (osLogin.openAtLogin ? 'enabled' : 'not-registered'));
  assert.deepEqual(await entry.evaluate(() => ({ require: typeof require, process: typeof process })), { require: 'undefined', process: 'undefined' });
  assert.equal((await state(entry)).mode, 'untracked');
  assert.equal(await entry.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
  await entry.locator('#project-entry').fill('   ');
  await entry.locator('#project-entry').press('Enter');
  assert.equal((await state(entry)).mode, 'untracked');
  assert.equal((await state(entry)).projects.length, 0);
  record('Real Electron windows, native inactivity API, actual OS login-registration readback, hidden Dock icon, isolated sandboxed renderer');

  await entry.locator('#project-entry').fill('  Alpha  ');
  assert.equal((await state(entry)).mode, 'untracked');
  await entry.locator('#project-entry').press('Enter');
  await eventually(async () => (await state(entry)).mode === 'work', 'Enter starts Alpha');
  assert.equal((await state(entry)).projects[0].name, 'Alpha');
  const alpha = (await state(entry)).active.projectId;
  await showEntry(f);
  await entry.locator('#project-entry').fill('Beta');
  assert.equal((await state(entry)).active.projectId, alpha);
  await entry.locator('#project-entry').press('Escape');
  await eventually(async () => !(await visible(f.application, 'entry')), 'Escape hides entry');
  assert.equal((await state(entry)).mode, 'work');
  await clock(f, 61_000);
  await showEntry(f);
  await entry.locator('#project-entry').fill('Beta');
  await entry.locator('#project-entry').press('Enter');
  await eventually(async () => (await state(entry)).active?.projectId !== alpha, 'Enter switches to Beta');
  const beta = (await state(entry)).active.projectId;
  await clock(f, 61_000);
  await showEntry(f);
  await entry.locator('#project-entry').fill('al');
  await entry.locator('#project-entry').press('ArrowDown');
  assert.equal((await state(entry)).active.projectId, beta);
  await entry.locator('#project-entry').press('Enter');
  await eventually(async () => (await state(entry)).active?.projectId === alpha, 'arrow-selected project starts');
  await showEntry(f);
  await entry.locator('#project-entry').fill('bet');
  await entry.locator('#project-suggestions [role="option"]').click();
  await eventually(async () => (await state(entry)).active?.projectId === beta, 'suggestion click switches immediately');
  await showEntry(f);
  await saveScreenshot(entry, 'entry-en');
  record('Real keyboard and suggestion clicks: trimming, no start while typing/highlighting, Enter selection, Escape preserves tracking');

  await f.application.evaluate(({ BrowserWindow, app }) => {
    const target = new BrowserWindow({ width: 240, height: 120, show: true, title: 'timi smoke focus target', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    globalThis.__timiSmokeFocusTarget = target;
    app.focus({ steal: true });
    target.focus();
  });
  try {
    await eventually(async () => !(await visible(f.application, 'entry')), 'independent native window focus hides entry');
    assert.equal((await state(entry)).mode, 'work');
  } finally {
    await f.application.evaluate(() => { globalThis.__timiSmokeFocusTarget.destroy(); });
  }
  await showEntry(f);
  record('Native focus moving to a separate test window blurs and hides entry while tracking continues');

  await clock(f, 61_000);
  await entry.getByRole('button', { name: 'Pause', exact: true }).click();
  await eventually(async () => (await state(entry)).mode === 'break', 'Pause starts break');
  await clock(f, 20 * 60_000, 20 * 60);
  await signal(f, 'lock-screen');
  await signal(f, 'suspend');
  assert.equal((await state(entry)).pending, null);
  await signal(f, 'unlock-screen');
  await signal(f, 'resume');
  await clock(f, 0);
  await showEntry(f);
  await entry.getByRole('button', { name: 'Play', exact: true }).click();
  await eventually(async () => (await state(entry)).mode === 'work', 'Play resumes previous project');
  await entry.getByRole('button', { name: 'Stop', exact: true }).click();
  await eventually(async () => (await state(entry)).mode === 'untracked', 'Stop ends recording');
  assert.equal((await state(entry)).resumeProjectId, null);
  assert.equal(await entry.getByRole('button', { name: 'Play', exact: true }).count(), 0);
  record('Pause, projectless manual breaks, native-event suppression, Play and Stop controls');

  await entry.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = await getWindow(f.application, 'settings');
  try { await eventually(async () => !(await visible(f.application, 'entry')), 'outside focus hides entry'); }
  catch (error) { console.log(JSON.stringify(await windowDiagnostics(f.application), null, 2)); throw error; }
  await settings.locator('#idle-minutes').fill('2');
  const workspaceId = await f.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('window=overview')).id);
  await settings.getByRole('button', { name: '‹ Week overview', exact: true }).click();
  await settings.locator('.overview-page').waitFor({ state: 'visible' });
  const currentWeek = await settings.locator('.week-range').textContent();
  await settings.getByRole('button', { name: 'Previous week', exact: true }).click();
  await eventually(async () => (await settings.locator('.week-range').textContent()) !== currentWeek, 'previous week loaded');
  const selectedWeek = await settings.locator('.week-range').textContent();
  await settings.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.locator('.settings-page').waitFor({ state: 'visible' });
  assert.equal(await settings.locator('#idle-minutes').inputValue(), '2');
  await settings.getByRole('button', { name: '‹ Week overview', exact: true }).click();
  await settings.locator('.overview-page').waitFor({ state: 'visible' });
  assert.equal(await settings.locator('.week-range').textContent(), selectedWeek);
  await settings.getByRole('button', { name: 'This week', exact: true }).click();
  await showEntry(f);
  await entry.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.locator('.settings-page').waitFor({ state: 'visible' });
  assert.equal(await settings.locator('#idle-minutes').inputValue(), '2');
  assert.deepEqual(await f.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => /window=(overview|settings)$/.test(window.webContents.getURL())).map(window => window.id)), [workspaceId]);
  await settings.evaluate(() => window.timi.closeWindow());
  await eventually(async () => !(await visible(f.application, 'overview')), 'shared workspace closes');
  await showEntry(f);
  await entry.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.locator('.settings-page').waitFor({ state: 'visible' });
  assert.equal(await settings.locator('#idle-minutes').inputValue(), '2');
  record('Tracker direct settings, overview Settings button and Back reuse one window; drafts and selected week survive navigation and closing');
  await settings.locator('#reminder-minutes').fill('3');
  for (const [index, hours] of ['7,6', '8', '8', '8', '8', '4', '0'].entries()) await settings.locator(`#work-hours-${index}`).fill(hours);
  await settings.getByRole('switch', { name: 'Show remaining working time', exact: true }).check();
  await settings.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await eventually(async () => (await state(settings)).settings.idleMinutes === 2, 'preferences save');
  assert.deepEqual((await state(settings)).settings.workGoals.dailyHours, [7.6, 8, 8, 8, 8, 4, 0]);
  assert.equal((await state(settings)).settings.workGoals.showRemaining, true);
  const displayState = await state(settings);
  const targetHours = displayState.settings.workGoals.dailyHours[(new Date(displayState.now).getDay() + 6) % 7];
  const remainingMs = Math.round(targetHours * 3_600_000) - displayState.todayMs;
  const displayMinutes = targetHours > 0 ? Math.abs(Math.ceil(remainingMs / 60_000)) : Math.floor(displayState.todayMs / 60_000);
  const expectedDisplay = `${targetHours > 0 && remainingMs < 0 ? '−' : ''}${Math.floor(displayMinutes / 60)}:${String(displayMinutes % 60).padStart(2, '0')}`;
  assert.equal((await f.application.evaluate(() => globalThis.__timiSmokeTrayTitle)).replace(/^[!Ⅱ■] /, ''), expectedDisplay);
  await saveScreenshot(settings, 'settings-work-goals-en');
  await settings.locator('.work-goals-section').screenshot({ path: join(artifacts, 'work-goals-en.png') });
  const savedSettings = (await state(settings)).settings;
  await settings.locator('#idle-minutes').fill('0');
  await settings.getByRole('button', { name: 'Save preferences', exact: true }).click();
  assert.deepEqual((await state(settings)).settings, savedSettings);
  await settings.locator('#idle-minutes').fill('2');
  await settings.locator('#work-hours-0').fill('25');
  await settings.getByRole('button', { name: 'Save preferences', exact: true }).click();
  assert.deepEqual((await state(settings)).settings, savedSettings);
  await settings.locator('#work-hours-0').fill('7,6');
  await settings.getByRole('switch', { name: 'Show remaining working time', exact: true }).uncheck();
  await settings.getByRole('button', { name: 'Save preferences', exact: true }).click();
  assert.equal((await state(settings)).settings.workGoals.showRemaining, false);
  const workedMinutes = Math.floor((await state(settings)).todayMs / 60_000);
  assert.equal((await f.application.evaluate(() => globalThis.__timiSmokeTrayTitle)).replace(/^[!Ⅱ■] /, ''), `${Math.floor(workedMinutes / 60)}:${String(workedMinutes % 60).padStart(2, '0')}`);
  record('Menu-bar switch saves remaining/worked mode and updates the native status-item title');
  record('Settings persist weekday targets with decimal commas and reject invalid hours atomically; navigation closes entry');

  await entry.evaluate(() => window.timi.openWindow('overview'));
  const overview = await getWindow(f.application, 'overview');
  let current = await state(overview);
  await overview.getByRole('button', { name: 'Add time', exact: true }).click();
  await overview.locator('.editor input[type="datetime-local"]').nth(0).fill(localInput(current.now - 3 * 3_600_000));
  await overview.locator('.editor input[type="datetime-local"]').nth(1).fill(localInput(current.now - 2 * 3_600_000));
  await overview.locator('.editor select[data-field="project"]').selectOption(alpha);
  const draftStart = await overview.locator('.editor input[type="datetime-local"]').nth(0).inputValue();
  await entry.evaluate(() => window.timi.openWindow('settings'));
  await overview.locator('.settings-page').waitFor({ state: 'visible' });
  assert.equal(await overview.locator('dialog[open]').count(), 0);
  await overview.getByRole('button', { name: '‹ Week overview', exact: true }).click();
  await overview.locator('dialog[open]').waitFor();
  assert.equal(await overview.locator('.editor input[type="datetime-local"]').nth(0).inputValue(), draftStart);
  record('External settings navigation suspends and restores the correction editor without losing its draft');
  await overview.getByRole('button', { name: 'Save changes', exact: true }).click();
  await eventually(() => overview.locator('dialog[open]').count().then(count => count === 0), 'correction saved');
  const correctionRows = () => overview.locator('.records-table tbody tr').filter({ hasText: 'Correction' });
  await correctionRows().first().getByRole('button', { name: 'Edit', exact: true }).click();
  await overview.getByRole('button', { name: 'Split', exact: true }).click();
  await overview.locator('.editor select[data-field="kind"]').nth(1).selectOption('break');
  await saveScreenshot(overview, 'correction-en');
  await overview.getByRole('button', { name: 'Save changes', exact: true }).click();
  await eventually(() => overview.locator('dialog[open]').count().then(count => count === 0), 'split saved');
  current = await state(overview);
  assert.equal(current.records.filter(record => record.source === 'manual').length, 2);
  assert.equal(current.records.find(record => record.source === 'manual' && record.kind === 'break').end
    - current.records.find(record => record.source === 'manual' && record.kind === 'break').start, 30 * 60_000);
  await correctionRows().filter({ hasText: 'Break' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await overview.getByRole('button', { name: 'Delete record', exact: true }).click();
  await overview.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await eventually(async () => (await state(overview)).records.filter(record => record.source === 'manual').length === 1, 'delete correction');
  await saveScreenshot(overview, 'overview-en');
  record('Weekly overview and correction editor: add, split work/break, inspect and delete with updated accounting');

  await showEntry(f);
  await entry.locator('#project-entry').fill('Alpha');
  await entry.locator('#project-entry').press('Enter');
  await eventually(async () => (await state(entry)).mode === 'work', 'start for lock test');
  await clock(f, 30_000);
  await signal(f, 'lock-screen');
  const pendingId = (await state(entry)).pending.id;
  await signal(f, 'user-did-resign-active');
  await signal(f, 'user-did-become-active');
  assert.equal((await state(entry)).canPresent, false);
  assert.equal(await visible(f.application, 'clarification'), false);
  await signal(f, 'suspend');
  await signal(f, 'unlock-screen');
  assert.equal(await visible(f.application, 'clarification'), false);
  await signal(f, 'resume');
  const clarification = await getWindow(f.application, 'clarification');
  await eventually(() => visible(f.application, 'clarification'), 'clarification shown after awake and unlocked');
  assert.equal((await state(entry)).pending.id, pendingId);
  assert.deepEqual(await f.application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter(window => /window=(entry|overview|clarification)$/.test(window.webContents.getURL()))
      .map(window => ({
        kind: new URL(window.webContents.getURL()).searchParams.get('window'),
        onTop: window.isAlwaysOnTop(), allWorkspaces: window.isVisibleOnAllWorkspaces(),
      })).sort((left, right) => left.kind.localeCompare(right.kind))), [
    { kind: 'clarification', onTop: true, allWorkspaces: true },
    { kind: 'entry', onTop: false, allWorkspaces: false },
    { kind: 'overview', onTop: false, allWorkspaces: false },
  ]);
  assert.equal(await clarification.locator('.clarification-choices button').count(), 3);
  await clarification.keyboard.press('Escape');
  await f.application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('window=clarification')).close();
  });
  assert.equal(await visible(f.application, 'clarification'), true);
  assert.equal((await state(entry)).pending.id, pendingId);
  await entry.evaluate(() => window.timi.openWindow('settings'));
  await settings.locator('.settings-page').waitFor({ state: 'visible' });
  await pause(2_200);
  assert.equal(await f.application.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL().endsWith('window=overview')), true);
  assert.deepEqual(await f.application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('window=clarification'));
    return { visible: window.isVisible(), focused: window.isFocused(), onTop: window.isAlwaysOnTop(), allWorkspaces: window.isVisibleOnAllWorkspaces() };
  }), { visible: true, focused: false, onTop: true, allWorkspaces: true });
  await signal(f, 'lock-screen');
  await signal(f, 'suspend');
  assert.equal(await visible(f.application, 'clarification'), false);
  await signal(f, 'unlock-screen');
  assert.equal(await visible(f.application, 'clarification'), false);
  await signal(f, 'resume');
  await eventually(() => visible(f.application, 'clarification'), 'same clarification restored after lock and sleep');
  assert.equal((await state(entry)).pending.id, pendingId);
  assert.deepEqual(await f.application.evaluate(({ BrowserWindow, app }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('window=clarification'));
    return { focused: window.isFocused(), onTop: window.isAlwaysOnTop(), allWorkspaces: window.isVisibleOnAllWorkspaces(), dockVisible: app.dock.isVisible() };
  }), { focused: false, onTop: true, allWorkspaces: true, dockVisible: false });
  record('Clarification alone stays always-on-top across workspaces after blur and lock/sleep without stealing focus or showing the Dock');
  await clock(f, 5 * 60_000, 5 * 60);
  await command(entry, { type: 'settings', idleMinutes: 2, reminderMinutes: 3 });
  assert.equal((await state(entry)).canPresent, true);
  await saveScreenshot(clarification, 'clarification-en');
  await clarification.getByRole('button', { name: /^Record as a break/ }).click();
  await eventually(async () => (await state(entry)).pending === null, 'clarification resolved');
  await eventually(async () => !(await visible(f.application, 'clarification')), 'resolved clarification hides');
  current = await state(entry);
  assert.equal(current.mode, 'work');
  const idleRecord = current.records.find(record => record.source === 'idle');
  assert.equal(idleRecord.end - idleRecord.start, 5 * 60_000);
  assert.equal(current.active.start, idleRecord.end);
  await clock(f, 0, 0);
  record('Synthetic native lock/sleep signals overlap once, gate presentation, resist Escape/close, avoid repeated focus stealing, include decision time');

  const lock = new DatabaseSync(join(f.directory, 'tracking.sqlite'));
  try {
    lock.exec('BEGIN IMMEDIATE');
    const failedStop = await entry.evaluate(() => window.timi.command({ type: 'stop' }));
    assert.equal(failedStop.ok, false);
    assert.equal(failedStop.error.code, 'STORAGE_ERROR');
    assert.equal((await state(entry)).mode, 'work');
    const failedQuit = await entry.evaluate(() => window.timi.quit());
    assert.equal(failedQuit.ok, false);
    assert.equal((await state(entry)).mode, 'work');
    assert.equal(f.application.process().exitCode, null);
  } finally { lock.exec('ROLLBACK'); lock.close(); }
  await command(entry, { type: 'stop' });
  record('Real competing SQLite writer: failed Stop and quit preserve state, app stays open, retry succeeds');

  await command(entry, { type: 'settings', idleMinutes: 5, reminderMinutes: 1 });
  await clock(f, 60_000);
  await command(entry, { type: 'settings', idleMinutes: 5, reminderMinutes: 1 });
  await eventually(() => visible(f.application, 'entry'), 'active-use reminder foregrounds entry');
  assert.equal((await state(entry)).reminderDue, true);
  await entry.getByRole('button', { name: 'Later', exact: true }).click();
  await eventually(async () => !(await state(entry)).reminderDue, 'Later resets reminder');
  await clock(f, 60_000);
  await command(entry, { type: 'settings', idleMinutes: 5, reminderMinutes: 1 });
  await entry.getByRole('button', { name: 'Start break', exact: true }).click();
  await eventually(async () => (await state(entry)).mode === 'break', 'reminder starts break now');
  assert.equal((await state(entry)).active.start, (await state(entry)).now);
  assert.equal((await state(entry)).resumeProjectId, null);
  await command(entry, { type: 'stop' });
  record('Active-use reminder foregrounds entry, Later resets its interval, Start break begins now without backfill');

  // Exercise native notification wiring without posting test messages to the user's desktop.
  await f.application.evaluate(({ Notification }) => {
    globalThis.__timiSmokeGoalNotifications = [];
    Notification.isSupported = () => true;
    Notification.prototype.show = function () {
      globalThis.__timiSmokeGoalNotifications.push({ title: this.title, body: this.body });
      this.emit('show', {});
      this.emit('close', {});
    };
  });
  const dailyHours = [0, 0, 0, 0, 0, 0, 0];
  const goalState = await state(entry);
  dailyHours[(new Date(goalState.now).getDay() + 6) % 7] = 1 / 60;
  await command(entry, { type: 'settings', idleMinutes: 5, reminderMinutes: 1, workGoals: { dailyHours, notifyDaily: true, notifyWeekly: true } });
  await eventually(() => f.application.evaluate(() => globalThis.__timiSmokeGoalNotifications.length === 2), 'daily and weekly goal notifications');
  const notices = await f.application.evaluate(() => globalThis.__timiSmokeGoalNotifications);
  assert.deepEqual(notices.map(notice => notice.title), ['Daily working time reached', 'Weekly working time reached']);
  assert.ok(notices.every(notice => notice.body.includes('0:01')));
  await command(entry, { type: 'settings', idleMinutes: 5, reminderMinutes: 1 });
  assert.equal(await f.application.evaluate(() => globalThis.__timiSmokeGoalNotifications.length), 2);
  const noticeStorage = new DatabaseSync(join(f.directory, 'tracking.sqlite'));
  try { assert.equal(noticeStorage.prepare('SELECT count(*) AS count FROM timi_goal_notices').get().count, 2); }
  finally { noticeStorage.close(); }
  record('Daily and weekly notifications use native Electron wiring and durable once-per-period receipts (display mocked)');

  assert.equal((await entry.evaluate(() => window.timi.command({ type: 'runShell', command: 'invalid' }))).ok, false);
  assert.equal(await entry.evaluate(async () => {
    try { await fetch('https://example.invalid/timi-security-check'); return false; } catch { return true; }
  }), true);
  record('Narrow IPC rejects unknown commands and renderer CSP blocks application network access');

  const quitChild = childProcesses.get(f.application);
  const quitLock = new DatabaseSync(join(f.directory, 'tracking.sqlite'));
  try {
    quitLock.exec('BEGIN IMMEDIATE');
    await f.application.evaluate(({ dialog, app }) => {
      dialog.showMessageBox = options => {
        globalThis.__timiSmokeQuitDialog = options;
        return new Promise(resolveDialog => { globalThis.__timiSmokeResolveQuitDialog = resolveDialog; });
      };
      setImmediate(() => app.quit());
    });
    await eventually(() => f.application.evaluate(() => Boolean(globalThis.__timiSmokeQuitDialog)), 'native failed-quit dialog');
    const quitButtons = await f.application.evaluate(() => globalThis.__timiSmokeQuitDialog.buttons);
    assert.deepEqual(quitButtons, ['Retry', 'Keep timi open']);
    assert.equal(quitChild.exitCode, null);
    assert.equal((await state(entry)).mode, 'untracked');
  } finally { quitLock.exec('ROLLBACK'); quitLock.close(); }
  await f.application.evaluate(() => { globalThis.__timiSmokeResolveQuitDialog({ response: 0, checkboxChecked: false }); });
  await eventually(() => quitChild.exitCode !== null, 'native Retry saves and quits');
  const savedAfterQuit = new DatabaseSync(join(f.directory, 'tracking.sqlite'));
  try {
    assert.equal(JSON.parse(savedAfterQuit.prepare('SELECT state_json FROM timi_runtime').get().state_json).cleanExit, true);
  } finally { savedAfterQuit.close(); }
  await closeApplication(f.application);
  record('Native Quit failure offers Retry and Keep open; simulated Retry response performs a clean durable quit');

  for (const language of ['de', 'fr']) {
    const localized = await launch(language);
    const expected = language === 'de' ? 'de' : 'en';
    assert.equal(await localized.entry.evaluate(() => document.documentElement.lang), expected);
    assert.equal(await localized.entry.locator('#project-entry').getAttribute('placeholder'), expected === 'de' ? 'Woran arbeitest du?' : 'What are you working on?');
    await localized.entry.evaluate(() => window.timi.openWindow('settings'));
    const localizedSettings = await getWindow(localized.application, 'settings');
    assert.equal(await localizedSettings.evaluate(() => document.documentElement.lang), expected);
    await saveScreenshot(localizedSettings, `settings-${language === 'de' ? 'de' : 'fallback-en'}`);
    if (language === 'de') {
      for (const [index, hours] of ['7,6', '8', '8', '8', '8', '4', '0'].entries()) await localizedSettings.locator(`#work-hours-${index}`).fill(hours);
      await localizedSettings.emulateMedia({ colorScheme: 'light' });
      await localizedSettings.locator('.work-goals-section').screenshot({ path: join(artifacts, 'work-goals-de.png') });
      await localizedSettings.emulateMedia({ colorScheme: 'dark' });
      await localizedSettings.locator('.work-goals-section').screenshot({ path: join(artifacts, 'work-goals-de-dark.png') });
    }
    await closeApplication(localized.application);
  }
  record('macOS per-app AppleLanguages selects German and falls back to English for unsupported French');
  assert.deepEqual(issues, [], `Unexpected renderer errors: ${issues.join('\n')}`);
  for (const file of await readdir(artifacts)) {
    if (/^failure-.*\.png$/.test(file)) await rm(join(artifacts, file));
  }
  await writeFile(join(artifacts, 'report.json'), JSON.stringify({
    passed: true, timestamp: new Date().toISOString(), native: { electron: native.version, platform: native.platform, architecture: native.architecture, packaged: environment.value.packaged, executable: process.env.TIMI_TEST_EXECUTABLE || electronPath }, checks,
    limitations: [
      'Goal notification show/close events were mocked; real macOS presentation, permission prompts, and Focus behavior were not exercised.',
      'Lock and sleep were synthetic Electron powerMonitor events; physical lid, screen-lock, and wake hardware were not exercised.',
      'Native inactivity readings were replaced with controlled seconds for deterministic tests; actual keyboard/trackpad idle behavior requires a manual session.',
      'Launch-at-login registration was inspected without toggling the user’s login items; actual login reboot and signing/notarization were not tested.',
    ],
  }, null, 2));
  console.log(`Native smoke passed. Screenshots and report: ${artifacts}`);
} catch (error) {
  for (const application of applications) {
    for (const page of application.windows()) {
      try { await saveScreenshot(page, `failure-${new URL(page.url()).searchParams.get('window') || 'window'}`); } catch {}
    }
  }
  await writeFile(join(artifacts, 'report.json'), JSON.stringify({ passed: false, timestamp: new Date().toISOString(), checks, error: String(error), rendererErrors: issues }, null, 2));
  throw error;
} finally {
  for (const application of applications) {
    try { await closeApplication(application); } catch {}
  }
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
}
