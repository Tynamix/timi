import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

execFileSync(process.execPath, ['scripts/package.mjs', '--universal', '--signed'], { stdio: 'inherit' });
const names = ['timi-mac-universal.dmg'];
const sums = await Promise.all(names.map(async name => `${createHash('sha256').update(await readFile(`release/${name}`)).digest('hex')}  ${name}\n`));
await writeFile('release/SHA256SUMS', sums.join(''));
