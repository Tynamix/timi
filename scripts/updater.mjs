import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const updateArchiveName = 'timi-mac-universal.app.tar.gz';

/** Verify the CLI's Minisign output against the public key shipped in the app.
 * This also catches CI accidentally using a different release key. Runtime
 * verification is performed independently by the official updater plugin. */
export function verifyUpdateSignature(bytes, signature, publicKey, version) {
  const keyLines = Buffer.from(publicKey, 'base64').toString('utf8').trim().split('\n');
  const lines = Buffer.from(signature, 'base64').toString('utf8').trim().split('\n');
  const key = Buffer.from(keyLines[1] ?? '', 'base64');
  const packet = Buffer.from(lines[1] ?? '', 'base64');
  const globalSignature = Buffer.from(lines[3] ?? '', 'base64');
  const comment = lines[2]?.slice('trusted comment: '.length);
  if (key.length !== 42 || packet.length !== 74 || globalSignature.length !== 64
      || packet.subarray(0, 2).toString() !== 'ED' || !packet.subarray(2, 10).equals(key.subarray(2, 10))
      || !lines[2]?.startsWith('trusted comment: ') || !comment?.split('\t').includes(`version:${version}`)) {
    throw new Error('Invalid updater signature or signed version.');
  }
  const publicObject = createPublicKey({ format: 'der', type: 'spki', key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10),
  ]) });
  if (!verify(null, createHash('blake2b512').update(bytes).digest(), publicObject, packet.subarray(10))
      || !verify(null, Buffer.concat([packet.subarray(10), Buffer.from(comment)]), publicObject, globalSignature)) {
    throw new Error('Updater signature does not match the bundled public key.');
  }
}

export function updateManifest(version, signature) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !signature.trim()) throw new Error('Invalid updater release metadata.');
  const platform = { url: `https://github.com/Tynamix/timi/releases/download/v${version}/${updateArchiveName}`, signature: signature.trim() };
  return { version, platforms: { 'darwin-aarch64': platform, 'darwin-x86_64': platform } };
}

export async function createUpdateArchive({ appPath, directory, version, publicKey, environment = process.env }, run = execFileSync) {
  if (!environment.TAURI_SIGNING_PRIVATE_KEY?.trim()) throw new Error('Signed releases require TAURI_SIGNING_PRIVATE_KEY.');
  const archive = join(directory, updateArchiveName);
  // Archive the final Developer ID signed, notarized and stapled app, never the
  // intermediate ad-hoc Tauri bundle. COPYFILE_DISABLE avoids AppleDouble files.
  run('tar', ['-czf', archive, '-C', dirname(appPath), basename(appPath)], {
    stdio: 'inherit', env: { ...environment, COPYFILE_DISABLE: '1' },
  });
  // Credentials remain in the environment and are never printed or passed as arguments.
  run(resolve('node_modules/.bin/tauri'), ['signer', 'sign', '--app-version', version, archive], {
    stdio: 'ignore', env: { ...environment, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' },
  });
  const signature = (await readFile(`${archive}.sig`, 'utf8')).trim();
  verifyUpdateSignature(await readFile(archive), signature, publicKey, version);
  await writeFile(join(directory, 'latest.json'), JSON.stringify(updateManifest(version, signature), null, 2) + '\n');
  return archive;
}
