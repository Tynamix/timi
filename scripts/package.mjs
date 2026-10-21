import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createDmg, signingOptions } from './distribution.mjs';
import { rustEnvironment } from './rust-environment.mjs';
import { createUpdateArchive } from './updater.mjs';

if (process.platform !== 'darwin') throw new Error('Package on macOS 13 or later.');
const { values: flags } = parseArgs({ options: { universal: { type: 'boolean' }, signed: { type: 'boolean' } } });
const arch = flags.universal ? 'universal' : process.arch;
if (!['universal', 'arm64', 'x64'].includes(arch)) throw new Error(`Unsupported Mac architecture: ${arch}`);
const target = { universal: 'universal-apple-darwin', arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' }[arch];
const signing = flags.signed ? signingOptions(process.env) : undefined;
if (signing && arch !== 'universal') throw new Error('Signed updater releases require --universal.');
if (signing && !process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()) throw new Error('Signed releases require TAURI_SIGNING_PRIVATE_KEY.');
if (!signing) console.warn('Local development DMG: ad-hoc signed, not Apple-notarized. Do not publish this build.');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release', { recursive: true });
const staging = await mkdtemp(join(resolve('release'), '.timi-package-'));
try {
  console.log(`[package] Building the Tauri ${arch} application...`);
  // This pipeline owns Developer ID signing and notarization. Keep Tauri's app
  // bundling local and ad-hoc, even if the caller has Apple credentials set.
  const targetDirectory = resolve(process.env.CARGO_TARGET_DIR || 'src-tauri/target');
  const environment = { ...rustEnvironment().env, CARGO_TARGET_DIR: targetDirectory, APPLE_SIGNING_IDENTITY: '-' };
  for (const name of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_PATH', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD']) delete environment[name];
  execFileSync(resolve('node_modules/.bin/tauri'), [
    'build', '--target', target, '--bundles', 'app', '--config',
    JSON.stringify({ version: metadata.version, bundle: { macOS: { signingIdentity: '-' } } }),
  ], { stdio: 'inherit', env: environment });
  const bundle = join(targetDirectory, target, 'release/bundle/macos/timi.app');
  const stagedApp = join(staging, 'timi.app');
  execFileSync('ditto', [bundle, stagedApp], { stdio: 'inherit' });
  await cp('LICENSE', join(stagedApp, 'Contents/Resources/LICENSE'));
  if (signing) {
    console.log('[package] Signing the application with Developer ID and Hardened Runtime...');
    execFileSync('codesign', ['--force', '--sign', signing.identity, '--keychain', signing.keychain,
      '--timestamp', '--options', 'runtime', '--entitlements', signing.entitlements, stagedApp], { stdio: 'inherit' });
  } else {
    execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', resolve('assets/entitlements.plist'), stagedApp], { stdio: 'inherit' });
  }
  const outputPath = resolve('release', `timi-mac-${arch}.dmg`);
  await createDmg({ appPath: stagedApp, outputPath, staging, signing });
  if (signing) {
    const configuration = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
    const archive = await createUpdateArchive({ appPath: stagedApp, directory: staging, version: metadata.version, publicKey: configuration.plugins.updater.pubkey });
    const extracted = join(staging, 'update-check');
    await mkdir(extracted);
    execFileSync('tar', ['-xzf', archive, '-C', extracted], { stdio: 'inherit' });
    const extractedApp = join(extracted, 'timi.app');
    execFileSync('codesign', ['--verify', '--deep', '--strict', extractedApp], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'validate', extractedApp], { stdio: 'inherit' });
    execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', extractedApp], { stdio: 'inherit' });
    for (const name of ['timi-mac-universal.app.tar.gz', 'timi-mac-universal.app.tar.gz.sig', 'latest.json']) {
      await cp(join(staging, name), resolve('release', name));
    }
  }
  const appPath = resolve('release', `timi-darwin-${arch}`, 'timi.app');
  await mkdir(resolve('release', `timi-darwin-${arch}`), { recursive: true });
  await rm(appPath, { recursive: true, force: true });
  execFileSync('ditto', [stagedApp, appPath], { stdio: 'inherit' });
  console.log(appPath);
  console.log(outputPath);
} finally { await rm(staging, { recursive: true, force: true }); }
