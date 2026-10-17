import { packager } from '@electron/packager';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('Package on macOS 13 or later.');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const staging = await mkdtemp(join(tmpdir(), 'timi-package-'));
await mkdir('assets/timi.iconset', { recursive: true });
try {
  execFileSync('swift', ['-module-cache-path', join(tmpdir(), 'timi-swift-cache'), 'scripts/icon.swift', 'assets/timi.png']);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) execFileSync('sips', ['-z', String(size * scale), String(size * scale), 'assets/timi.png', '--out', `assets/timi.iconset/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', 'assets/timi.iconset', '-o', 'assets/timi.icns']);
  await cp('dist', staging, { recursive: true });
  await cp('LICENSE', join(staging, 'LICENSE'));
  await writeFile(join(staging, 'package.json'), JSON.stringify({ name: 'timi', version: metadata.version, main: 'main.cjs', license: 'MIT' }));
  const paths = await packager({
    dir: staging, out: 'release', name: 'timi', platform: 'darwin', arch: process.argv.includes('--universal') ? 'universal' : process.arch,
    electronVersion: metadata.devDependencies.electron, appBundleId: 'work.timi.app',
    appCategoryType: 'public.app-category.productivity', icon: resolve('assets/timi.icns'),
    overwrite: true, asar: true, prune: true,
    extendInfo: { LSUIElement: true, LSMinimumSystemVersion: '13.0', CFBundleDevelopmentRegion: 'en', CFBundleLocalizations: ['en', 'de'] },
  });
  for (const path of paths) {
    const appPath = join(path, 'timi.app');
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
    const archive = join('release', `timi-mac-${process.argv.includes('--universal') ? 'universal' : process.arch}.zip`);
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archive]);
    console.log(resolve(appPath));
    console.log(resolve(archive));
  }
} finally { await rm(staging, { recursive: true, force: true }); await rm('assets/timi.iconset', { recursive: true, force: true }); }
