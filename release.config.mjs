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
      prepareCmd: 'node scripts/prepare-release.mjs',
    }],
    ['@semantic-release/github', {
      assets: [
        { path: 'release/timi-mac-universal.dmg', label: 'timi for macOS (Apple Silicon + Intel)' },
        { path: 'release/timi-mac-universal.app.tar.gz', label: 'Signed in-app update (Apple Silicon + Intel)' },
        { path: 'release/timi-mac-universal.app.tar.gz.sig', label: 'Update signature' },
        { path: 'release/latest.json', label: 'Update manifest' },
        { path: 'release/SHA256SUMS', label: 'SHA-256 checksums' },
      ],
      releaseBodyTemplate: '<%= nextRelease.notes %>\n\n## Download and install\nDownload **timi-mac-universal.dmg** below, open it and drag **timi** to **Applications**. Eject the disk image and launch timi from Applications. Requires macOS 13 or later; supports Apple Silicon and Intel.\n\nThe app and disk image are Developer ID signed and notarized by Apple, with notarization tickets attached for offline verification. macOS may still ask you to confirm opening an app downloaded from the internet.\n\nVerify the download with `shasum -a 256 -c SHA256SUMS` in the directory containing both downloaded files.',
      successCommentCondition: false,
      failCommentCondition: false,
      releasedLabels: false,
    }],
  ],
};
