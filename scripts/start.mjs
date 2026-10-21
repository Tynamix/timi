import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { rustEnvironment } from './rust-environment.mjs';

if (process.platform !== 'darwin') throw new Error('timi requires macOS 13 or later.');
// Keep development offline too: load bundled local assets, without a dev server.
// Tauri consumes the first separator; Cargo consumes the second.
const child = spawn(resolve('node_modules/.bin/tauri'), [
  'dev', '--no-dev-server', '--no-watch', '--', '--', ...process.argv.slice(2),
], { stdio: 'inherit', env: rustEnvironment().env });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
