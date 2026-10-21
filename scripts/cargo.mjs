import { spawn } from 'node:child_process';
import { rustEnvironment } from './rust-environment.mjs';

try {
  const { cargo, env } = rustEnvironment();
  const child = spawn(cargo, process.argv.slice(2), { stdio: 'inherit', env });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
