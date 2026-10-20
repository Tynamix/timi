import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createDmg, signingOptions, verifySigning } from '../scripts/distribution.mjs';

const teamId = 'A123456789';
const hash = 'a'.repeat(40);
const identity = (team = teamId, fingerprint = hash) => `  1) ${fingerprint} "Developer ID Application: Example (${team})"\n`;
const environment = { MACOS_SIGNING_KEYCHAIN: '/temporary/signing.keychain-db', APPLE_TEAM_ID: teamId };
const signing = { identity: hash, keychain: environment.MACOS_SIGNING_KEYCHAIN };

test('release signing requires a keychain and valid team, never falling back to ad-hoc signing', () => {
  const unexpected = () => assert.fail('Must reject missing configuration before calling security');
  assert.throws(() => signingOptions({}, unexpected), /MACOS_SIGNING_KEYCHAIN/);
  for (const value of [undefined, '', 'invalid', 'A123456789\n']) {
    assert.throws(() => signingOptions({ ...environment, APPLE_TEAM_ID: value }, unexpected), /APPLE_TEAM_ID/);
  }
});

test('the signed packaging CLI fails before packaging when signing credentials are missing', () => {
  const environment = { ...process.env };
  delete environment.MACOS_SIGNING_KEYCHAIN;
  delete environment.APPLE_TEAM_ID;
  const result = spawnSync(process.execPath, ['scripts/package.mjs', '--universal', '--signed'], { env: environment, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, process.platform === 'darwin' ? /Signed releases require MACOS_SIGNING_KEYCHAIN/ : /Package on macOS/);
  assert.doesNotMatch(result.stderr, /Local development DMG/);
});

test('release signing selects exactly one valid Developer ID identity from the expected team', () => {
  const options = signingOptions(environment, (command, args) => {
    assert.equal(command, 'security');
    assert.deepEqual(args, ['find-identity', '-v', '-p', 'codesigning', environment.MACOS_SIGNING_KEYCHAIN]);
    return identity('B123456789', 'b'.repeat(40)) + identity() + `  3) ${'c'.repeat(40)} "Apple Development: Example (${teamId})"\n`;
  });
  assert.equal(options.identity, hash);
  assert.equal(options.keychain, environment.MACOS_SIGNING_KEYCHAIN);
  assert.equal(options.continueOnError, false);
  const perFile = options.optionsForFile('timi.app');
  assert.equal(perFile.hardenedRuntime, true);
  assert.deepEqual([...readFileSync(perFile.entitlements, 'utf8').matchAll(/<key>([^<]+)<\/key>/g)].map(match => match[1]), ['com.apple.security.cs.allow-jit']);
  assert.deepEqual(options.optionsForFile('timi Helper (Renderer).app'), perFile);
  for (const output of ['', identity('B123456789'), identity() + identity(teamId, 'd'.repeat(40)), `${identity().trimEnd()} (CSSMERR_TP_CERT_EXPIRED)\n`]) {
    assert.throws(() => signingOptions(environment, () => output), /Expected one valid Developer ID Application identity/);
  }
});

test('the signing preflight compiles, signs, verifies and runs a temporary executable using the release identity', async () => {
  const calls = [];
  let executable;
  await verifySigning(environment, (command, args) => {
    calls.push([command, ...args]);
    if (command === 'security') return identity();
    if (command === 'xcrun') {
      executable = args.at(-1);
      assert.equal(readFileSync(args[1], 'utf8'), 'int main(void) { return 0; }\n');
    }
    return '';
  });
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [
    ['security', 'find-identity'], ['xcrun', 'clang'], ['codesign', '--force'], ['codesign', '--verify'], [executable],
  ]);
  const signature = calls[2];
  assert.equal(signature[signature.indexOf('--sign') + 1], hash);
  assert.equal(signature[signature.indexOf('--keychain') + 1], environment.MACOS_SIGNING_KEYCHAIN);
  assert.equal(signature[signature.indexOf('--options') + 1], 'runtime');
  assert.ok(signature.includes('--timestamp'));
  assert.match(signature[signature.indexOf('--entitlements') + 1], /assets\/entitlements\.plist$/);
  await assert.rejects(stat(dirname(executable)), { code: 'ENOENT' });
});

test('the signing preflight propagates failures and always removes its source and executable', async t => {
  for (const phase of ['compile', 'sign', 'verify', 'launch']) {
    await t.test(phase, async () => {
      let directory;
      let launched = false;
      const failure = new Error(`native ${phase} failed`);
      await assert.rejects(verifySigning(environment, (command, args) => {
        if (command === 'security') return identity();
        if (command === 'xcrun') directory = dirname(args.at(-1));
        const current = command === 'xcrun' ? 'compile' : command === 'codesign' ? args.includes('--verify') ? 'verify' : 'sign' : 'launch';
        if (current === 'launch') launched = true;
        if (current === phase) throw failure;
        return '';
      }), error => error === failure);
      assert.equal(launched, phase === 'launch');
      await assert.rejects(stat(directory), { code: 'ENOENT' });
    });
  }
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'timi-distribution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const staging = join(directory, 'staging');
  const appPath = join(directory, 'timi.app');
  const outputPath = join(directory, 'timi-mac-universal.dmg');
  await mkdir(staging);
  await mkdir(appPath);
  await writeFile(join(appPath, 'bundled-code'), 'application');
  await writeFile(outputPath, 'previous release');
  return { staging, appPath, outputPath };
}

function commands(results = ['Accepted', 'Accepted'], fail = () => false) {
  const calls = [];
  let submission = 0;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (fail(command, args)) throw new Error('native command failed');
    if (command === 'ditto' && args.length === 2) cpSync(args[0], args[1], { recursive: true });
    if (command === 'hdiutil' && args[0] === 'create') writeFileSync(args.at(-1), 'new disk image');
    if (command === 'xcrun' && args[0] === 'notarytool' && args[1] === 'submit') {
      submission++;
      return JSON.stringify({ id: `submission-${submission}` });
    }
    if (command === 'xcrun' && args[0] === 'notarytool' && args[1] === 'info') {
      return JSON.stringify({ id: `submission-${submission}`, status: results[submission - 1] });
    }
    return '';
  };
  return { calls, run };
}

test('local DMGs contain the app and Applications shortcut without requiring Apple credentials', async t => {
  const options = await fixture(t);
  const { calls, run } = commands();
  await createDmg(options, run);
  assert.equal(await readFile(options.outputPath, 'utf8'), 'new disk image');
  assert.equal(await readFile(join(options.staging, 'dmg', 'timi.app', 'bundled-code'), 'utf8'), 'application');
  assert.equal(await readlink(join(options.staging, 'dmg', 'Applications')), '/Applications');
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [
    ['codesign', '--verify'], ['ditto', options.appPath], ['hdiutil', 'create'], ['hdiutil', 'verify'],
  ]);
  assert.ok(calls[2].includes('UDZO'));
  assert.ok(calls[2].includes('HFS+'));
});

test('signed DMGs notarize and staple the app before copying, then sign, notarize and staple the image', async t => {
  const options = { ...await fixture(t), signing };
  const { calls, run } = commands();
  const messages = [];
  t.mock.method(console, 'log', message => messages.push(message));
  await createDmg(options, (command, args, commandOptions) => {
    if (command === 'xcrun' && args[0] === 'notarytool' && args[1] === 'wait') {
      assert.ok(messages.includes(`[notarization] Submission ID: ${args[2]}`), 'Submission ID must be visible before waiting');
      assert.equal(commandOptions.stdio, 'inherit', 'Native progress must be streamed to the job log');
    }
    const result = run(command, args);
    if (command === 'xcrun' && args[0] === 'stapler' && args[1] === 'staple' && args[2] === options.appPath) {
      writeFileSync(join(options.appPath, 'stapled-ticket'), 'offline verification');
    }
    return result;
  });
  assert.equal(await readFile(join(options.staging, 'dmg', 'timi.app', 'stapled-ticket'), 'utf8'), 'offline verification');
  assert.equal(await readFile(options.outputPath, 'utf8'), 'new disk image');
  assert.deepEqual(calls.map(call => call.slice(0, call[0] === 'xcrun' ? 3 : 2)), [
    ['codesign', '--verify'],
    ['ditto', '-c'],
    ['xcrun', 'notarytool', 'submit'],
    ['xcrun', 'notarytool', 'wait'],
    ['xcrun', 'notarytool', 'info'],
    ['xcrun', 'stapler', 'staple'],
    ['xcrun', 'stapler', 'validate'],
    ['codesign', '--verify'],
    ['spctl', '--assess'],
    ['ditto', options.appPath],
    ['hdiutil', 'create'],
    ['hdiutil', 'verify'],
    ['codesign', '--force'],
    ['xcrun', 'notarytool', 'submit'],
    ['xcrun', 'notarytool', 'wait'],
    ['xcrun', 'notarytool', 'info'],
    ['xcrun', 'stapler', 'staple'],
    ['xcrun', 'stapler', 'validate'],
    ['codesign', '--verify'],
    ['spctl', '--assess'],
  ]);
  const submissions = calls.filter(call => call[1] === 'notarytool' && call[2] === 'submit');
  for (const call of submissions) {
    assert.equal(call.includes('--wait'), false);
    assert.equal(call.includes('--timeout'), false);
  }
  const waits = calls.filter(call => call[1] === 'notarytool' && call[2] === 'wait');
  assert.equal(waits.length, 2);
  for (const call of waits) {
    assert.equal(call[call.indexOf('--timeout') + 1], '60m');
    assert.equal(call[call.indexOf('--output-format') + 1], 'normal');
    assert.ok(call.includes('--progress'));
  }
  const infos = calls.filter(call => call[1] === 'notarytool' && call[2] === 'info');
  assert.equal(infos.length, 2);
  assert.deepEqual(waits.map(call => call[3]), ['submission-1', 'submission-2']);
  assert.deepEqual(infos.map(call => call[3]), ['submission-1', 'submission-2']);
  for (const call of [...submissions, ...waits, ...infos]) {
    assert.equal(call[call.indexOf('--keychain-profile') + 1], 'timi-notarization');
    assert.equal(call[call.indexOf('--keychain') + 1], signing.keychain);
    assert.equal(call.includes('--password'), false);
  }
  assert.match(submissions[0][3], /\.zip$/);
  assert.match(submissions[1][3], /\.dmg$/);
  const imageSignature = calls.find(call => call[0] === 'codesign' && call[1] === '--force');
  assert.equal(imageSignature[imageSignature.indexOf('--sign') + 1], hash);
  assert.ok(imageSignature.includes('--timestamp'));
  assert.ok(calls.at(-1).includes('context:primary-signature'));
  assert.ok(messages.some(message => message.includes('Creating the DMG')));
  assert.ok(messages.some(message => message.includes('Signing the DMG')));
  assert.equal(messages.at(-1), `[package] DMG ready: ${options.outputPath}`);
});

test('a notarization timeout preserves the prior DMG and leaves the submission ID visible without resubmitting', async t => {
  const options = { ...await fixture(t), signing };
  const messages = [];
  t.mock.method(console, 'log', message => messages.push(message));
  const { calls, run } = commands();
  const timeout = new Error('Timeout of 3600 second(s) was reached before processing completed.');
  await assert.rejects(createDmg(options, (command, args) => {
    const result = run(command, args);
    if (command === 'xcrun' && args[0] === 'notarytool' && args[1] === 'wait') throw timeout;
    return result;
  }), error => error === timeout);
  assert.equal(await readFile(options.outputPath, 'utf8'), 'previous release');
  assert.ok(messages.includes('[notarization] Submission ID: submission-1'));
  assert.equal(calls.filter(call => call[1] === 'notarytool' && call[2] === 'submit').length, 1);
  assert.equal(calls.some(call => call[1] === 'notarytool' && call[2] === 'info'), false);
  assert.equal(calls.some(call => call[1] === 'stapler'), false);
  assert.equal(messages.some(message => message.includes('DMG ready')), false);
});

test('an accepted status for a different submission is rejected before stapling or replacing the DMG', async t => {
  const options = { ...await fixture(t), signing };
  const { calls, run } = commands();
  await assert.rejects(createDmg(options, (command, args) => {
    const result = run(command, args);
    return command === 'xcrun' && args[0] === 'notarytool' && args[1] === 'info'
      ? JSON.stringify({ id: 'different-submission', status: 'Accepted' })
      : result;
  }), /invalid response/);
  assert.equal(await readFile(options.outputPath, 'utf8'), 'previous release');
  assert.equal(calls.some(call => call[1] === 'stapler'), false);
});

test('rejected or incomplete notarization preserves the previous DMG and reports Apple diagnostics', async t => {
  for (const statuses of [['Invalid'], ['In Progress'], ['Accepted', 'Invalid']]) {
    await t.test(statuses.join(', '), async t => {
      const options = { ...await fixture(t), signing };
      const { calls, run } = commands(statuses);
      await assert.rejects(createDmg(options, run), /was not accepted/);
      assert.equal(await readFile(options.outputPath, 'utf8'), 'previous release');
      assert.equal(calls.at(-1)[1], 'notarytool');
      assert.equal(calls.at(-1)[2], 'log');
      const expectedStaples = statuses[0] === 'Accepted' ? 1 : 0;
      assert.equal(calls.filter(call => call[1] === 'stapler' && call[2] === 'staple').length, expectedStaples);
    });
  }
});

test('malformed Apple responses and native command failures never produce a release DMG', async t => {
  for (const response of ['not json', '{}', 'null', '{"id":"submission-1","status":null}']) {
    await t.test(response, async t => {
      const options = { ...await fixture(t), signing };
      const { run } = commands();
      await assert.rejects(createDmg(options, (command, args) =>
        command === 'xcrun' && args[0] === 'notarytool' ? response : run(command, args)));
      assert.equal(await readFile(options.outputPath, 'utf8'), 'previous release');
    });
  }
  for (const target of ['codesign', 'ditto', 'create', 'verify', 'submit', 'wait', 'info', 'staple', 'validate', 'spctl', '--force']) {
    await t.test(target, async t => {
      const options = { ...await fixture(t), signing };
      const { run } = commands(['Accepted', 'Accepted'], (command, args) => command === target || args.includes(target));
      await assert.rejects(createDmg(options, run), /native command failed/);
      assert.equal(await readFile(options.outputPath, 'utf8'), 'previous release');
    });
  }
});
