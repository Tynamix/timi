import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import releaseConfig from '../release.config.mjs';

const logger = { log() {} };

test('releases require signing and publish only the universal DMG and its final checksum', () => {
  const [, exec] = releaseConfig.plugins.find(plugin => plugin[0] === '@semantic-release/exec');
  const [, github] = releaseConfig.plugins.find(plugin => plugin[0] === '@semantic-release/github');
  assert.equal(exec.prepareCmd, 'npm run package:universal -- --signed && cd release && shasum -a 256 timi-mac-universal.dmg > SHA256SUMS');
  assert.deepEqual(github.assets.map(asset => asset.path), ['release/timi-mac-universal.dmg', 'release/SHA256SUMS']);
  assert.match(github.releaseBodyTemplate, /timi-mac-universal\.dmg/);
  assert.match(github.releaseBodyTemplate, /notarized by Apple/);
  assert.doesNotMatch(github.releaseBodyTemplate, /\.zip|Open Anyway|ad-hoc/);
});

test('CI signing validates every secret before creating files and always removes its temporary keychain', async t => {
  const workflow = await readFile(new URL('../.github/workflows/verify-and-release.yml', import.meta.url), 'utf8');
  const scripts = [...workflow.matchAll(/        run: \|\n((?:          .*(?:\n|$))+)/g)]
    .map(match => match[1].replace(/^          /gm, ''));
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.match(workflow, /name: Remove signing credentials\n\s+if: always\(\)/);
  assert.match(scripts[0], /--keychain "\$keychain"/);
  assert.match(scripts[0], /notarytool store-credentials timi-notarization/);
  assert.doesNotMatch(scripts[0], /list-keychains|default-keychain|add-trusted-cert/);
  assert.match(scripts[1], /security delete-keychain "\$keychain"/);
  const directory = await mkdtemp(join(tmpdir(), 'timi-ci-signing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secrets = {
    MACOS_CERTIFICATE_P12_BASE64: 'test-certificate',
    MACOS_CERTIFICATE_PASSWORD: 'test-export-password',
    APPLE_ID: 'test@example.invalid',
    APPLE_TEAM_ID: 'A123456789',
    APPLE_APP_SPECIFIC_PASSWORD: 'test-app-password',
  };
  for (const missing of Object.keys(secrets)) {
    const environment = { PATH: process.env.PATH, RUNNER_TEMP: directory, ...secrets };
    delete environment[missing];
    const result = spawnSync('bash', ['-c', scripts[0]], { env: environment, encoding: 'utf8' });
    assert.notEqual(result.status, 0, missing);
    assert.match(result.stderr, new RegExp(`Missing ${missing} secret`));
    assert.deepEqual(await readdir(directory), []);
  }
});

test('the configured release analyzer handles patch, feature, breaking and non-release commits', async () => {
  const [, config] = releaseConfig.plugins.find(plugin => plugin[0] === '@semantic-release/commit-analyzer');
  for (const [message, expected] of [
    ['fix: preserve paused project', 'patch'],
    ['feat: add weekly overview', 'minor'],
    ['feat!: change storage format', 'major'],
    ['fix: change schema\n\nBREAKING CHANGE: migrate existing storage', 'major'],
    ['docs: describe install', null],
    ['ci: add automation', null],
  ]) {
    assert.equal(await analyzeCommits(config, { cwd: process.cwd(), commits: [{ hash: 'abc', message }], logger }), expected, message);
  }
});

test('release notes include changes and breaking migrations', async () => {
  const [, config] = releaseConfig.plugins.find(plugin => plugin[0] === '@semantic-release/release-notes-generator');
  const notes = await generateNotes(config, {
    cwd: process.cwd(), options: releaseConfig, logger,
    commits: [{ hash: 'a'.repeat(40), message: 'feat!: change storage format\n\nBREAKING CHANGE: migrate existing storage' }],
    lastRelease: { version: '1.0.0', gitTag: 'v1.0.0' },
    nextRelease: { version: '2.0.0', gitTag: 'v2.0.0' },
  });
  assert.match(notes, /change storage format/);
  assert.match(notes, /migrate existing storage/);
});
