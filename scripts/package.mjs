import { packager } from '@electron/packager';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createDmg, signingOptions } from './distribution.mjs';

if (process.platform !== 'darwin') throw new Error('Package on macOS 13 or later.');
const { values: flags } = parseArgs({ options: { universal: { type: 'boolean' }, signed: { type: 'boolean' } } });
const arch = flags.universal ? 'universal' : process.arch;
const signing = flags.signed ? signingOptions(process.env) : undefined;
if (!signing) console.warn('Local development DMG: ad-hoc signed, not Apple-notarized. Do not publish this build.');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release', { recursive: true });
const staging = await mkdtemp(join(resolve('release'), '.timi-package-'));
try {
  const source = join(staging, 'app');
  const png = join(staging, 'timi.png');
  const iconset = join(staging, 'timi.iconset');
  const icon = join(staging, 'timi.icns');
  await mkdir(iconset);
  execFileSync('swift', ['-module-cache-path', join(staging, 'swift-cache'), 'scripts/icon.swift', png], { stdio: 'inherit' });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) execFileSync('sips', ['-z', String(size * scale), String(size * scale), png, '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icon], { stdio: 'inherit' });
  await cp('dist', source, { recursive: true });
  await cp('LICENSE', join(source, 'LICENSE'));
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'timi', version: metadata.version, main: 'main.cjs', license: 'MIT' }));
  console.log(`[package] Building ${arch} application${flags.universal ? ' and merging Intel and Apple Silicon slices' : ''}...`);
  let signingStarted = false;
  const paths = await packager({
    dir: source, out: 'release', name: 'timi', platform: 'darwin', arch,
    electronVersion: metadata.devDependencies.electron, appBundleId: 'work.timi.app',
    appCategoryType: 'public.app-category.productivity', icon,
    overwrite: true, asar: true, prune: true,
    osxSign: signing && {
      ...signing,
      optionsForFile: filePath => {
        if (!signingStarted) {
          console.log('[package] Signing the merged application and nested code with Developer ID...');
          signingStarted = true;
        }
        return signing.optionsForFile(filePath);
      },
    },
    extendInfo: { LSUIElement: true, LSMinimumSystemVersion: '13.0', CFBundleDevelopmentRegion: 'en', CFBundleLocalizations: ['en', 'de'] },
  });
  console.log(`[package] Application packaging${signing ? ' and Developer ID signing' : ''} completed.`);
  for (const path of paths) {
    const appPath = resolve(path, 'timi.app');
    if (!signing) {
      console.log('[package] Ad-hoc signing the local development app...');
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    }
    const outputPath = resolve('release', `timi-mac-${arch}.dmg`);
    await createDmg({ appPath, outputPath, staging, signing });
    console.log(appPath);
    console.log(outputPath);
  }
} finally { await rm(staging, { recursive: true, force: true }); }
