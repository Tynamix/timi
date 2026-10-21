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

test('VS Code builds the Tauri app before launching LLDB with isolated data', async () => {
  const launch = JSON.parse(await readFile(new URL('../.vscode/launch.json', import.meta.url), 'utf8'));
  const tasks = JSON.parse(await readFile(new URL('../.vscode/tasks.json', import.meta.url), 'utf8'));
  const native = launch.configurations.find(config => config.type === 'lldb' && config.request === 'launch');
  const build = tasks.tasks.find(task => task.label === native.preLaunchTask);
  assert.equal(build.type, 'npm');
  assert.equal(build.script, 'build:native');
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.scripts['build:native'], 'node scripts/cargo.mjs build --manifest-path src-tauri/Cargo.toml');
  assert.equal(tasks.tasks.find(task => build.dependsOn.includes(task.label)).script, 'build');
  assert.equal(native.program, '${workspaceFolder}/src-tauri/target/debug/timi');
  assert.deepEqual(native.args, ['--data-directory=${workspaceFolder}/.cache/vscode-debug']);
});

test('development uses bundled local assets and forwards application arguments through Tauri and Cargo', async () => {
  const script = await readFile(new URL('../scripts/start.mjs', import.meta.url), 'utf8');
  assert.match(script, /'dev', '--no-dev-server', '--no-watch', '--', '--', \.\.\.process\.argv\.slice\(2\)/);
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.scripts.start, 'node scripts/start.mjs');
  assert.ok(metadata.devDependencies['@tauri-apps/cli']);
  assert.ok(metadata.dependencies['@tauri-apps/api']);
  assert.equal(metadata.devDependencies.electron, undefined);
  assert.equal(metadata.devDependencies['@electron/packager'], undefined);
});

test('macOS CI verifies native Rust and JavaScriptCore and installs both release architectures', async () => {
  const workflow = await readFile(new URL('../.github/workflows/verify-and-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Verify native Tauri and JavaScriptCore integration\n\s+if: runner\.os == 'macOS'\n\s+run: npm run test:native/);
  assert.match(workflow, /targets: aarch64-apple-darwin,x86_64-apple-darwin/);
});

test('releases require signing and publish only the universal DMG and its final checksum', () => {
  const [, exec] = releaseConfig.plugins.find(plugin => plugin[0] === '@semantic-release/exec');
  const [, github] = releaseConfig.plugins.find(plugin => plugin[0] === '@semantic-release/github');
  assert.equal(exec.prepareCmd, 'npm run package:universal -- --signed && cd release && shasum -a 256 timi-mac-universal.dmg > SHA256SUMS');
  assert.deepEqual(github.assets.map(asset => asset.path), ['release/timi-mac-universal.dmg', 'release/SHA256SUMS']);
  assert.match(github.releaseBodyTemplate, /timi-mac-universal\.dmg/);
  assert.match(github.releaseBodyTemplate, /notarized by Apple/);
  assert.doesNotMatch(github.releaseBodyTemplate, /\.zip|Open Anyway|ad-hoc/);
});

test('CI signing validates every secret, delegates keychain setup to the import action and cleans up certificate files', async t => {
  const workflow = await readFile(new URL('../.github/workflows/verify-and-release.yml', import.meta.url), 'utf8');
  const scripts = [...workflow.matchAll(/        run: \|\n((?:          .*(?:\n|$))+)/g)]
    .map(match => match[1].replace(/^          /gm, ''));
  assert.equal(scripts.length, 3);
  assert.match(workflow, /  release:\n[\s\S]*?timeout-minutes: 150\n/);
  for (const script of scripts) {
    const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.match(workflow, /name: Remove signing files\n\s+if: always\(\)/);
  assert.match(workflow, /uses: apple-actions\/import-codesign-certs@v6/);
  assert.match(workflow, /keychain: \$\{\{ runner\.temp \}\}\/timi-signing\n/);
  assert.match(workflow, /keychain-password: \$\{\{ steps\.signing-inputs\.outputs\.keychain-password \}\}/);
  assert.match(workflow, /p12-filepath: \$\{\{ runner\.temp \}\}\/timi-signing\.p12/);
  assert.equal([...workflow.matchAll(/MACOS_SIGNING_KEYCHAIN: \$\{\{ runner\.temp \}\}\/timi-signing\.keychain\n/g)].length, 2);
  assert.match(scripts[0], /openssl rand -base64 32/);
  assert.match(scripts[0], /::add-mask::\$keychain_password/);
  assert.doesNotMatch(scripts.join('\n'), /create-keychain|unlock-keychain|set-key-partition-list|default-keychain|add-trusted-cert|delete-keychain/);
  assert.match(scripts[1], /--keychain "\$keychain"/);
  assert.ok(scripts[1].indexOf('node scripts/signing-check.mjs') < scripts[1].indexOf('notarytool store-credentials'));
  assert.match(scripts[1], /node scripts\/signing-check\.mjs/);
  assert.match(scripts[2], /rm -f "\$RUNNER_TEMP\/timi-signing\.p12" "\$RUNNER_TEMP\/timi-developer-id-g2\.cer"/);
  assert.ok(workflow.indexOf('uses: apple-actions/import-codesign-certs@v6') < workflow.indexOf('node scripts/signing-check.mjs'));
  assert.ok(workflow.indexOf('node scripts/signing-check.mjs') < workflow.indexOf('run: npm run release'));
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
