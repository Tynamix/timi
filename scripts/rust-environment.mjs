import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

/** GUI editors can retain a PATH from before rustup was installed. */
export function rustEnvironment() {
  const candidates = [
    ...(process.env.PATH || '').split(delimiter).filter(Boolean).map(directory => join(directory, 'cargo')),
    join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'bin', 'cargo'),
  ];
  for (const cargo of candidates) {
    try { accessSync(cargo, constants.X_OK); }
    catch { continue; }
    return {
      cargo,
      env: { ...process.env, PATH: [dirname(cargo), process.env.PATH].filter(Boolean).join(delimiter) },
    };
  }
  throw new Error('Rust/Cargo was not found. Install stable Rust from https://rustup.rs, then retry the build.');
}
