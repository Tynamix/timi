export default {
  branches: ['main'],
  repositoryUrl: 'https://github.com/Tynamix/timi.git',
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    // Update package.json and the lockfile in CI before packaging, without
    // publishing to npm or committing generated versions back to main.
    ['@semantic-release/npm', { npmPublish: false }],
    ['@semantic-release/exec', {
      prepareCmd: 'npm run package:universal && cd release && shasum -a 256 timi-mac-universal.zip > SHA256SUMS',
    }],
    ['@semantic-release/github', {
      assets: [
        { path: 'release/timi-mac-universal.zip', label: 'timi for macOS (Apple Silicon + Intel)' },
        { path: 'release/SHA256SUMS', label: 'SHA-256 checksums' },
      ],
      releaseBodyTemplate: '<%= nextRelease.notes %>\n\n## Download and install\nDownload **timi-mac-universal.zip** below, unzip it and drag **timi.app** to Applications. Requires macOS 13 or later; supports Apple Silicon and Intel.\n\nThis build is ad-hoc signed, not Apple-notarized. macOS may require **System Settings → Privacy & Security → Open Anyway** on first launch.\n\nVerify the download with `shasum -a 256 -c SHA256SUMS` in the directory containing both downloaded files.',
      successCommentCondition: false,
      failCommentCondition: false,
      releasedLabels: false,
    }],
  ],
};
