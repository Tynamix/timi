import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('skip - native platform checks require macOS.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = await mkdtemp(join(tmpdir(), 'timi-native-platform-'));
const driver = join(directory, 'driver');
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  response.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  response.end('local-control');
});
server.on('upgrade', (request, socket) => {
  requests.push(request.url);
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});

try {
  const compiled = spawnSync('clang', ['-fobjc-arc', '-fblocks', '-std=c11', '-mmacosx-version-min=13.0',
    '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
    ...['AppKit', 'QuartzCore', 'ApplicationServices', 'IOKit', 'ServiceManagement', 'UserNotifications', 'WebKit'].flatMap(name => ['-framework', name]),
    join(root, 'src/native/platform-test-driver.m'), '-o', driver], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  const rulesDirectory = join(directory, 'rules');
  await mkdir(rulesDirectory);
  const port = await new Promise(resolvePort => {
    server.once('error', error => {
      if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
      console.log(`skip - local loopback test server unavailable (${error.code})`);
      resolvePort(0);
    });
    server.listen(0, '127.0.0.1', () => resolvePort(server.address().port));
  });
  const result = await new Promise((resolveExit, reject) => {
    const child = spawn(driver, [rulesDirectory, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', data => { output += data; process.stdout.write(data); });
    child.stderr.on('data', data => { errors += data; });
    child.once('error', reject);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000);
    child.once('close', (status, signal) => {
      clearTimeout(timeout);
      resolveExit({ status, signal, output, errors });
    });
  });
  assert.equal(result.status, 0, result.errors || `Native platform driver terminated: ${result.signal}`);
  assert.match(result.output, /ok - actual production offline rules compile/);
  if (result.output.includes('real WKWebView')) {
    assert.deepEqual(requests, ['/control'], 'The control must reach loopback, and blocked traffic must never reach the server.');
    console.log('ok - local server observed only the unfiltered control; no blocked requests escaped');
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(directory, { recursive: true, force: true });
}
