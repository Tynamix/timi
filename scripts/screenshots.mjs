// Reproducible WebKit renderer captures with real core/SQLite and a test-only desktop fixture.
// This is not an automation driver for the native Tauri shell.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { webkit } from 'playwright';
import { TrackingApplication } from '../src/core/application.ts';
import { SqliteStore } from '../src/core/store.ts';

if (process.platform !== 'darwin') throw new Error('Use macOS for screenshots with the app’s system fonts.');
const output = resolve(process.env.TIMI_SCREENSHOT_DIRECTORY || 'docs/images');
process.env.TZ = 'Europe/Berlin';
const temporary = await mkdtemp(join(tmpdir(), 'timi-screenshots-'));
const at = (day, hour, minute = 0) => Date.parse(`2026-10-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`);
let now = at(16, 13);
const application = new TrackingApplication(new SqliteStore(join(temporary, 'tracking.sqlite')), () => now);
let browser;
let workspaceView = 'overview';
const errors = [];
try {
  await mkdir(output, { recursive: true });
  await Promise.all(['index.html', 'style.css'].map(file => copyFile(`src/renderer/${file}`, join(temporary, file))));
  // The production desktop bridge remains strict; only this temporary test bundle
  // replaces it with the fixture installed below before renderer initialization.
  await build({ entryPoints: ['src/renderer/index.ts'], outfile: join(temporary, 'renderer.js'), bundle: true,
    platform: 'browser', target: 'safari16', plugins: [{ name: 'screenshot-desktop', setup(builder) {
      builder.onResolve({ filter: /^\.\.\/desktop$/ }, () => ({ path: 'desktop', namespace: 'screenshot' }));
      builder.onLoad({ filter: /.*/, namespace: 'screenshot' }, () => ({ contents: 'export async function desktopReady() {}', loader: 'js' }));
    } }] });
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  browser = await webkit.launch();
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Berlin', colorScheme: process.env.TIMI_SCREENSHOT_THEME === 'dark' ? 'dark' : 'light', reducedMotion: 'reduce', deviceScaleFactor: 2 });
  context.setDefaultTimeout(15_000);
  context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  await context.exposeBinding('__timiFixture', async ({ page }, { method, args }) => {
    try {
      let value;
      if (method === 'snapshot') value = application.getSnapshot(args[0]);
      else if (method === 'command') {
        value = application.execute(args[0]);
        queueMicrotask(() => { for (const view of context.pages()) void view.evaluate(() => window.dispatchEvent(new Event('timi:changed'))); });
      } else if (method === 'environment') value = { locale: 'en', version, loginAvailable: false, launchAtLogin: false, launchAtLoginStatus: 'not-registered', packaged: false };
      else if (method === 'updateStatus') value = { phase: 'disabled', version: null, error: null };
      else if (method === 'workspaceView') value = workspaceView;
      else if (method === 'openWindow') {
        workspaceView = args[0];
        await page.evaluate(view => window.dispatchEvent(new CustomEvent('timi:navigate', { detail: view })), workspaceView);
      } else throw new Error(`Unsupported screenshot fixture method: ${method}`);
      return { ok: true, value };
    } catch (error) { return { ok: false, error: { code: error.code || 'UNEXPECTED' } }; }
  });
  await context.addInitScript(() => {
    const call = method => (...args) => window.__timiFixture({ method, args });
    const listen = event => callback => {
      const handler = event => callback(event.detail);
      window.addEventListener(event, handler);
      return () => window.removeEventListener(event, handler);
    };
    window.timi = {
      updateStatus: call('updateStatus'), checkUpdate: call('checkUpdate'), installUpdate: call('installUpdate'), onUpdate: listen('timi:update'),
      snapshot: call('snapshot'), command: call('command'), environment: call('environment'),
      workspaceView: call('workspaceView'), openWindow: call('openWindow'),
      closeWindow: call('closeWindow'), quit: call('quit'), setLaunchAtLogin: call('setLaunchAtLogin'),
      onChanged: listen('timi:changed'), onError: listen('timi:error'), onFocus: listen('timi:focus'), onNavigate: listen('timi:navigate'),
    };
  });
  const pageFor = async (kind, width, height) => {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(`${pathToFileURL(join(temporary, 'index.html'))}?window=${kind}`);
    await page.waitForSelector('#app[aria-busy="false"]');
    return page;
  };
  for (const name of ['Brand design', 'Development', 'Writing']) application.execute({ type: 'createProject', name });
  const projects = Object.fromEntries(application.getSnapshot().projects.map(project => [project.name, project.id]));
  const records = [];
  const add = (day, start, end, project) => records.push({ start: at(day, ...start), end: at(day, ...end), kind: project ? 'work' : 'break', projectId: project ? projects[project] : null });
  for (let day = 12; day <= 15; day++) {
    add(day, [9, 0], [12, day % 2 ? 0 : 30], 'Development');
    add(day, [12, day % 2 ? 0 : 30], [13, 0]);
    add(day, [13, 0], [15, 0], 'Brand design');
    add(day, [15, 0], [16, day % 2 ? 30 : 0], 'Writing');
  }
  add(16, [9, 0], [12, 0], 'Brand design');
  add(16, [12, 0], [12, 30]);
  add(16, [12, 30], [13, 0], 'Writing');
  application.execute({ type: 'correct', removeIds: [], records });
  application.execute({ type: 'settings', idleMinutes: 5, reminderMinutes: 10, workGoals: {
    dailyHours: [8, 8, 8, 8, 6, 0, 0], notifyDaily: true, notifyWeekly: true, showRemaining: true,
  } });
  application.execute({ type: 'start', name: 'Development' });
  for (let minutes = 0; minutes < 130; minutes += 2) {
    now += 2 * 60_000;
    application.sample({ idleMs: 0, locked: false, sleeping: false });
  }
  const entry = await pageFor('entry', 440, 570);
  await entry.locator('.status-title').filter({ hasText: 'Development' }).waitFor();
  await entry.locator('.today-value').filter({ hasText: '5:40 / 6:00' }).waitFor();
  await entry.locator('#project-entry').blur();
  await entry.screenshot({ path: join(output, 'tracking.png') });

  const overview = await pageFor('overview', 1120, 748);
  await overview.locator('.summary-number').filter({ hasText: '31:40 / 38:00' }).waitFor();
  await overview.screenshot({ path: join(output, 'overview.png') });
  await overview.getByRole('button', { name: 'Settings', exact: true }).click();
  await overview.locator('.settings-page').waitFor({ state: 'visible' });
  assert.equal(await overview.locator('.goal-week-value').textContent(), '38:00 h');
  assert.equal(await overview.locator('#show-remaining').isChecked(), true);
  await overview.setViewportSize({ width: 1120, height: 960 });
  await overview.locator('h1').filter({ hasText: 'Settings' }).blur();
  await overview.screenshot({ path: join(output, 'settings.png'), fullPage: true });
  await overview.setViewportSize({ width: 1120, height: 748 });
  await overview.getByRole('button', { name: '‹ Week overview', exact: true }).click();
  await overview.locator('.overview-page').waitFor({ state: 'visible' });
  const row = overview.locator('.records-table tbody tr').filter({ hasText: 'Brand design' }).first();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await overview.getByRole('button', { name: 'Split', exact: true }).click();
  await overview.screenshot({ path: join(output, 'corrections.png') });
  await overview.getByRole('button', { name: 'Cancel', exact: true }).click();

  application.sample({ idleMs: 0, locked: true, sleeping: false });
  now += 18 * 60_000;
  application.sample({ idleMs: 0, locked: false, sleeping: false });
  const clarification = await pageFor('clarification', 580, 538);
  await clarification.waitForSelector('.clarification-choices');
  assert.equal(await clarification.locator('.interval-duration').textContent(), '0:18');
  await clarification.screenshot({ path: join(output, 'idle.png') });

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
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: 1600, height: 1060 });
  await canvas.goto(pathToFileURL(hero).href);
  await canvas.locator('header h1').waitFor();
  await canvas.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
  await canvas.screenshot({ path: join(output, 'hero.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`Saved six WebKit renderer images to ${output}. Native Tauri window behavior is not covered.`);
} finally {
  if (browser) await browser.close();
  application.close();
  await rm(temporary, { recursive: true, force: true });
}
