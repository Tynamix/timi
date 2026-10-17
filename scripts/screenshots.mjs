// Real Electron UI, fictional records, fixed clock, isolated disposable storage.
// Run on a Mac desktop: npm run build && node scripts/screenshots.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';
import { _electron } from 'playwright';

if (process.platform !== 'darwin') throw new Error('Screenshots require a macOS desktop session.');
const output = resolve('docs/images');
const temporary = await mkdtemp(join(tmpdir(), 'timi-screenshots-'));
const environment = { ...process.env, TZ: 'Europe/Berlin' };
delete environment.ELECTRON_RUN_AS_NODE;
let application;
const at = (day, hour, minute = 0) => Date.parse(`2026-10-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`);
try {
  await mkdir(output, { recursive: true });
  const bootstrap = join(temporary, 'main.cjs');
  await writeFile(bootstrap, `
    globalThis.__screenshotTime = ${at(16, 13)};
    Date.now = () => globalThis.__screenshotTime;
    require('electron').powerMonitor.getSystemIdleTime = () => globalThis.__screenshotIdle || 0;
    require(${JSON.stringify(resolve('dist/main.cjs'))});
  `);
  application = await _electron.launch({
    executablePath: electronPath, args: [bootstrap, `--data-directory=${join(temporary, 'data')}`, '-AppleLanguages', '(en)'],
    cwd: process.cwd(), env: environment,
  });
  const entry = await application.firstWindow();
  const errors = [];
  application.on('window', page => page.on('pageerror', error => errors.push(String(error))));
  entry.on('pageerror', error => errors.push(String(error)));
  await entry.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await entry.waitForSelector('#app[aria-busy="false"]');
  const command = async value => {
    const result = await entry.evaluate(value => window.timi.command(value), value);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  for (const name of ['Brand design', 'Development', 'Writing']) await command({ type: 'createProject', name });
  const snapshot = await entry.evaluate(() => window.timi.snapshot());
  const projects = Object.fromEntries(snapshot.value.projects.map(project => [project.name, project.id]));
  const records = [];
  const add = (day, start, end, project) => records.push({
    start: at(day, ...start), end: at(day, ...end),
    kind: project ? 'work' : 'break', projectId: project ? projects[project] : null,
  });
  for (let day = 12; day <= 15; day++) {
    add(day, [9, 0], [12, day % 2 ? 0 : 30], 'Development');
    add(day, [12, day % 2 ? 0 : 30], [13, 0]);
    add(day, [13, 0], [15, 0], 'Brand design');
    add(day, [15, 0], [16, day % 2 ? 30 : 0], 'Writing');
  }
  add(16, [9, 0], [12, 0], 'Brand design');
  add(16, [12, 0], [12, 30]);
  add(16, [12, 30], [13, 0], 'Writing');
  await command({ type: 'correct', removeIds: [], records });
  await command({ type: 'start', name: 'Development' });
  // Frequent samples establish active use; one large clock jump correctly becomes idle.
  for (let minutes = 0; minutes < 130; minutes += 2) {
    await application.evaluate(() => { globalThis.__screenshotTime += 2 * 60_000; });
    await command({ type: 'settings', idleMinutes: 5, reminderMinutes: 10 });
  }
  await application.evaluate(({ app }) => app.emit('activate'));
  console.log('Demo state:', JSON.stringify(await entry.evaluate(async () => {
    const { value } = await window.timi.snapshot();
    return { mode: value.mode, todayMs: value.todayMs };
  })));
  await entry.locator('.status-title').filter({ hasText: 'Development' }).waitFor();
  await entry.locator('#project-entry').fill('');
  await entry.locator('.today-value').filter({ hasText: '5:40' }).waitFor();
  await entry.locator('#project-entry').blur();
  await entry.screenshot({ path: join(output, 'tracking.png') });
  console.log('Captured tracking');

  const overviewOpened = application.waitForEvent('window');
  await entry.evaluate(() => window.timi.openWindow('overview'));
  const overview = await overviewOpened;
  await overview.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await overview.waitForSelector('#app[aria-busy="false"]');
  await overview.locator('.summary-number').filter({ hasText: '31:40' }).waitFor();
  await overview.screenshot({ path: join(output, 'overview.png') });
  console.log('Captured overview');
  const row = overview.locator('.records-table tbody tr').filter({ hasText: 'Brand design' }).first();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await overview.getByRole('button', { name: 'Split', exact: true }).click();
  await overview.screenshot({ path: join(output, 'corrections.png') });
  await overview.getByRole('button', { name: 'Cancel', exact: true }).click();

  const clarificationOpened = application.waitForEvent('window');
  await application.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('lock-screen');
    globalThis.__screenshotTime += 18 * 60_000;
    globalThis.__screenshotIdle = 18 * 60;
    powerMonitor.emit('unlock-screen');
  });
  const clarification = await clarificationOpened;
  await clarification.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await clarification.waitForSelector('.clarification-choices');
  await clarification.screenshot({ path: join(output, 'idle.png') });
  assert.equal(await clarification.locator('.interval-duration').textContent(), '0:18');
  console.log('Captured corrections and absence');

  const embedded = async name => `data:image/png;base64,${(await readFile(join(output, name))).toString('base64')}`;
  const hero = join(temporary, 'hero.html');
  await writeFile(hero, `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{position:relative;margin:0;width:1600px;height:1060px;overflow:hidden;background:#eaf0e5;color:#214f45;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
    body:before{content:'';position:absolute;width:950px;height:950px;border-radius:50%;background:#dce8d4;right:-280px;top:-410px}
    header{position:absolute;left:72px;top:62px}small{font-size:17px;font-weight:650;letter-spacing:3px}h1{font-size:76px;line-height:1.06;letter-spacing:-4px;font-weight:650;margin:20px 0}p{font-size:24px;margin:22px 0;color:#557269}
    .window{position:absolute;border:1px solid #c6d4c8;border-radius:17px;overflow:hidden;box-shadow:0 30px 65px #173d3124;background:#f6f7f4}.bar{height:32px;display:flex;align-items:center;gap:7px;padding:0 13px;background:#f6f7f4;border-bottom:1px solid #dfe5dc}.bar i{width:10px;height:10px;border-radius:50%;background:#d6ded4}.bar span{font-size:11px;color:#708076;margin:auto;padding-right:45px}.window img{display:block;width:100%}
    .overview{left:72px;top:395px;width:1140px;height:596px}.overview img{width:1140px}.entry{right:65px;top:252px;width:378px}.note{position:absolute;right:77px;bottom:70px;font-size:16px;line-height:1.6;color:#557269}
  </style><header><small>TIMI / TIME TRACKING FOR MACOS</small><h1>Time well spent.<br>Yours to keep.</h1><p>In your menu bar. On your Mac. Under your control.</p></header>
  <div class="window overview"><div class="bar"><i></i><i></i><i></i><span>Your week</span></div><img src="${await embedded('overview.png')}"></div>
  <div class="window entry"><img src="${await embedded('tracking.png')}"></div>
  <div class="note">Fully offline.<br>Free & open source.</div>`);
  const canvasOpened = application.waitForEvent('window');
  await application.evaluate(({ BrowserWindow }, path) => {
    const window = new BrowserWindow({ width: 1600, height: 1060, useContentSize: true, show: true,
      webPreferences: { partition: 'timi-readme-composition', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    void window.loadFile(path);
  }, hero);
  const canvas = await canvasOpened;
  await canvas.waitForLoadState('load');
  await canvas.locator('header h1').waitFor();
  await canvas.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await canvas.screenshot({ path: join(output, 'hero.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`Saved five README images to ${output}`);
} finally {
  if (application) {
    try { await application.evaluate(({ app }) => { app.exit(0); }); } catch {}
    await application.close().catch(() => {});
  }
  await rm(temporary, { recursive: true, force: true });
}
