import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const command = (file, args, options = {}) => execFileSync(file, args, { stdio: 'inherit', ...options });

export function signingOptions(environment, run = command) {
  const keychain = environment.MACOS_SIGNING_KEYCHAIN;
  const teamId = environment.APPLE_TEAM_ID;
  if (!keychain?.trim()) throw new Error('Signed releases require MACOS_SIGNING_KEYCHAIN.');
  if (typeof teamId !== 'string' || teamId.length !== 10 || !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error('Signed releases require a valid APPLE_TEAM_ID.');
  }
  const output = run('security', ['find-identity', '-v', '-p', 'codesigning', keychain], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const identities = [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"\r\n]+)"\s*$/gm)]
    .filter(match => match[2].endsWith(`(${teamId})`));
  if (identities.length !== 1) throw new Error(`Expected one valid Developer ID Application identity for team ${teamId}; found ${identities.length}.`);
  return {
    identity: identities[0][1], keychain, continueOnError: false,
    optionsForFile: () => ({ entitlements: resolve('assets/entitlements.plist'), hardenedRuntime: true }),
  };
}

export async function verifySigning(environment, run = command) {
  const signing = signingOptions(environment, run);
  const directory = await mkdtemp(join(tmpdir(), 'timi-signing-check-'));
  try {
    const source = join(directory, 'main.c');
    const executable = join(directory, 'signing-check');
    await writeFile(source, 'int main(void) { return 0; }\n');
    run('xcrun', ['clang', source, '-o', executable]);
    run('codesign', [
      '--force', '--sign', signing.identity, '--keychain', signing.keychain, '--timestamp', '--options', 'runtime',
      '--entitlements', signing.optionsForFile(executable).entitlements, executable,
    ]);
    run('codesign', ['--verify', '--strict', '--verbose=2', executable]);
    run(executable, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function notarize(archive, target, signing, run) {
  const credentials = ['--keychain-profile', 'timi-notarization', '--keychain', signing.keychain];
  console.log(`[notarization] Uploading ${basename(archive)} to Apple...`);
  const submission = JSON.parse(run('xcrun', [
    'notarytool', 'submit', archive, ...credentials, '--output-format', 'json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  if (!submission || typeof submission.id !== 'string' || !submission.id.trim()) {
    throw new Error('Apple notarization returned an invalid submission response.');
  }
  console.log(`[notarization] Submission ID: ${submission.id}`);
  console.log(`[notarization] Waiting up to 60 minutes for Apple to process ${basename(archive)}...`);
  run('xcrun', [
    'notarytool', 'wait', submission.id, ...credentials, '--timeout', '60m', '--output-format', 'normal', '--progress',
  ], { stdio: 'inherit' });
  const result = JSON.parse(run('xcrun', [
    'notarytool', 'info', submission.id, ...credentials, '--output-format', 'json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  if (!result || result.id !== submission.id || typeof result.status !== 'string') {
    throw new Error('Apple notarization returned an invalid response.');
  }
  console.log(`[notarization] Apple notarization ${result.id}: ${result.status}`);
  if (result.status !== 'Accepted') {
    run('xcrun', ['notarytool', 'log', result.id, ...credentials]);
    throw new Error(`Apple notarization ${result.id} was not accepted: ${result.status}.`);
  }
  console.log(`[notarization] Stapling and validating the ticket for ${basename(target)}...`);
  run('xcrun', ['stapler', 'staple', target]);
  run('xcrun', ['stapler', 'validate', target]);
}

export async function createDmg({ appPath, outputPath, staging, signing }, run = command) {
  console.log('[package] Verifying the application signature...');
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  if (signing) {
    // Staple the app before copying it into the DMG so the installed copy also works offline.
    const archive = join(staging, 'notarization.zip');
    console.log('[notarization] Creating the internal app submission archive...');
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archive]);
    notarize(archive, appPath, signing, run);
    run('codesign', ['--verify', '--deep', '--strict', appPath]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
  }

  const contents = join(staging, 'dmg');
  console.log('[package] Creating the DMG with the app and Applications shortcut...');
  await mkdir(contents);
  run('ditto', [appPath, join(contents, 'timi.app')]);
  await symlink('/Applications', join(contents, 'Applications'));
  const image = join(staging, basename(outputPath));
  run('hdiutil', ['create', '-volname', 'timi', '-srcfolder', contents, '-fs', 'HFS+', '-format', 'UDZO', image]);
  run('hdiutil', ['verify', image]);
  if (signing) {
    console.log('[package] Signing the DMG with Developer ID...');
    run('codesign', ['--force', '--sign', signing.identity, '--keychain', signing.keychain, '--timestamp', image]);
    notarize(image, image, signing, run);
    run('codesign', ['--verify', '--strict', image]);
    run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', image]);
  }
  await rename(image, outputPath);
  console.log(`[package] DMG ready: ${outputPath}`);
}
