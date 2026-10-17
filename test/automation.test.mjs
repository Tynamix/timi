import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import releaseConfig from '../release.config.mjs';

const logger = { log() {} };

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
