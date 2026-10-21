import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

if (process.platform !== 'darwin') {
  console.log('Native JavaScriptCore integration requires macOS.');
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = await mkdtemp(join(tmpdir(), 'timi-native-engine-'));
const driver = join(directory, 'driver');
const aliases = { 'node:sqlite': join(root, 'src/native/sqlite.ts'), 'node:crypto': join(root, 'src/native/crypto.ts') };
const bundle = async (entry, output) => build({ entryPoints: [join(root, entry)], outfile: output,
  bundle: true, format: 'iife', platform: 'browser', target: 'safari15', alias: aliases });
function run(source, path, requests, zone = 'Europe/Berlin') {
  const child = spawnSync(driver, [source, path], { encoding: 'utf8', env: { ...process.env, TZ: zone },
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n' });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  return child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
try {
  const compiled = spawnSync('clang', ['-fobjc-arc', '-Wall', '-Wextra', '-Wno-unused-parameter',
    '-framework', 'Foundation', '-framework', 'JavaScriptCore', '-lsqlite3',
    join(root, 'src-tauri/native/engine.m'), join(root, 'src/native/engine-test-driver.m'), '-o', driver], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  if (compiled.stderr) process.stderr.write(compiled.stderr);
  const tests = join(directory, 'tests.js');
  const backend = join(directory, 'backend.js');
  await Promise.all([bundle('src/native/engine-tests.ts', tests), bundle('src/native/backend.ts', backend)]);
  const data = join(directory, 'data');
  await mkdir(data);
  const [report] = run(tests, data, [{ method: 'report', args: null }]);
  assert.equal(report.ok, true);
  for (const name of report.value.passed) console.log(`ok - ${name}`);
  const dbPath = join(directory, 'dispatch.sqlite');
  const responses = run(backend, dbPath, [
    { method: 'snapshot', args: 0 },
    { method: 'command', args: { type: 'start', name: 'Alpha', unauthorized: true } },
    { method: 'snapshot', args: 1 },
    { method: 'command', args: { type: 'createProject', name: 'Offline ✓' } },
    { method: 'presentation', args: 'de' },
    { method: 'command', args: { type: 'start', name: 'Offline ✓' } },
    { method: 'checkpoint', args: null },
    { method: 'quit', args: null },
  ]);
  assert.equal(responses[0].value.mode, 'untracked');
  assert.deepEqual(responses[1], { ok: false, error: { code: 'INVALID_COMMAND' } });
  assert.deepEqual(responses[2], { ok: false, error: { code: 'INVALID_COMMAND' } });
  assert.equal(responses[3].value.projects[0].name, 'Offline ✓');
  assert.equal(responses[4].value.messages.quit, 'timi beenden');
  assert.equal(responses[4].value.display.text, '0:00');
  for (const response of responses.slice(5)) assert.equal(response.ok, true);
  const [restart] = run(backend, dbPath, [{ method: 'snapshot', args: 0 }]);
  assert.equal(restart.value.mode, 'untracked');
  assert.equal(restart.value.pending, null);
  assert.equal(restart.value.projects[0].name, 'Offline ✓');
  console.log('ok - production dispatch validation, presentation, persistence, and clean restart');

  // An old Electron application's SQLite connection uses normal WAL locking.
  // Keep that connection idle after COMMIT: the new app must still refuse entry.
  const legacy = new NodeDatabaseSync(dbPath);
  legacy.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; COMMIT;');
  const priorRuntime = legacy.prepare('SELECT state_json FROM timi_runtime').get().state_json;
  const refused = spawnSync(driver, [backend, dbPath], { encoding: 'utf8', input: '' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /STORAGE_ERROR/);
  assert.equal(legacy.prepare('SELECT state_json FROM timi_runtime').get().state_json, priorRuntime);
  legacy.close();
  const owner = spawn(driver, [backend, dbPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const lines = createInterface({ input: owner.stdout });
    const ready = once(lines, 'line');
    owner.stdin.write(JSON.stringify({ method: 'snapshot', args: 0 }) + '\n');
    const [line] = await ready;
    assert.equal(JSON.parse(line).ok, true);
    const lateLegacy = new NodeDatabaseSync(dbPath);
    try {
      lateLegacy.exec('PRAGMA busy_timeout=25;');
      assert.throws(() => lateLegacy.prepare('PRAGMA quick_check').all(), /locked/);
    } finally { lateLegacy.close(); }
    lines.close();
  } finally {
    const stopped = once(owner, 'exit');
    owner.stdin.end();
    await stopped;
  }
  console.log('ok - old and new app processes exclude each other even between checkpoints');

  const corruptPath = join(directory, 'corrupt.sqlite');
  const corrupt = Buffer.from('preserve this corrupted original database exactly\n');
  await writeFile(corruptPath, corrupt);
  const unreadable = spawnSync(driver, [backend, corruptPath], { encoding: 'utf8', input: '' });
  assert.equal(unreadable.status, 1);
  assert.deepEqual(await readFile(corruptPath), corrupt);
  console.log('ok - corrupted database bytes are preserved by the production native engine');

  const originalSuite = join(directory, 'application-tests.js');
  const compat = join(root, 'src/native/test-compat.ts');
  const virtual = {
    'node:test': `export { test as default } from ${JSON.stringify(compat)};`,
    'node:assert/strict': `export { assert as default } from ${JSON.stringify(compat)};`,
    'node:fs': `export { mkdtempSync, rmSync, unsupportedFilesystem as readFileSync, unsupportedFilesystem as writeFileSync } from ${JSON.stringify(compat)};`,
    'node:path': `export { join } from ${JSON.stringify(compat)};`,
    'node:os': `export { tmpdir } from ${JSON.stringify(compat)};`,
  };
  await build({ entryPoints: [join(root, 'test/application.test.ts')], outfile: originalSuite,
    bundle: true, format: 'iife', platform: 'browser', target: 'safari15', alias: aliases,
    plugins: [{ name: 'native-test-adapters', setup(builder) {
      builder.onResolve({ filter: /^node:/ }, args => virtual[args.path] ? { path: args.path, namespace: 'test-adapter' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'test-adapter' }, args => ({ contents: virtual[args.path], resolveDir: root }));
    } }],
  });
  let originalCount = 0;
  for (const zone of ['Europe/Berlin', 'America/New_York']) {
    const fixtures = join(directory, zone.replaceAll('/', '-'));
    await mkdir(fixtures);
    await Promise.all(Array.from({ length: 100 }, (_, index) => mkdir(join(fixtures, String(index + 1)))));
    const [suite] = run(originalSuite, fixtures, [{ method: 'report', args: null }], zone);
    assert.equal(suite.ok, true);
    originalCount += suite.value.passed.length;
    console.log(`ok - ${suite.value.passed.length} original application tests execute in JavaScriptCore (${zone})`);
  }
  console.log(`${report.value.passed.length + 3} native integration tests and ${originalCount} original application test executions passed.`);
} finally { await rm(directory, { recursive: true, force: true }); }
