import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('Native checks require macOS 13 or later and Xcode Command Line Tools.');
for (const [command, args] of [
  [process.execPath, ['src/native/test-engine.mjs']],
  [process.execPath, ['src/native/test-platform.mjs']],
  [process.execPath, ['scripts/cargo.mjs', 'test', '--manifest-path', 'src-tauri/Cargo.toml']],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Native JavaScriptCore/SQLite, macOS platform/WebKit integration and Rust checks completed.');
console.log('These checks do not automate the full timi UI. Verify tray, focus, sleep/lock, notifications and login manually; see docs/guide.md.');
