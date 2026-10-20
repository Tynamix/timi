# Pull request checks and automatic releases

## Workflows

- `Verify and release`: PRs to `main` and pushes to `main` run `npm ci` and `npm run check` on Ubuntu 24.04 and macOS 14 with Node.js 24.10.0. This includes TypeScript checks, all unit tests (including the automation tests) and the build.
- `Conventional PR title`: checks titles on open, edit, update, reopen and ready-for-review events. It accepts `type(scope)!: description` with an optional scope and breaking-change marker.

The CI does not run the interactive native smoke suite, which needs a macOS desktop session. Run `npm run test:native` locally when changing native window behavior. Packaging verifies the application signature and disk image; public releases additionally require successful Apple notarization and Gatekeeper assessment.

## Codex reviews

AI code reviews use the native Codex GitHub integration, enabled in Codex settings for this repository. Reviews run independently of GitHub Actions; no AI workflow, API key or exported OAuth credentials are required in the repository.

To manage the integration, connect `Tynamix/timi` to Codex, select the repository under **Review code**, and configure **Automatic review**, the PR scope and the review trigger. Check that the selected policy covers the PRs and subsequent pushes you want reviewed. To request a review manually, comment `@codex review` on a PR. See the [official setup documentation](https://learn.chatgpt.com/docs/third-party/github).

Repository-specific review guidance is in [AGENTS.md](../AGENTS.md), covering durable storage, recovery, time accounting and Electron security. Codex posts its findings directly on GitHub. Check the next eligible PR for a review to verify the integration; the local test suite does not exercise the hosted service.

## Semantic releases

Use **squash merge**, keeping the validated PR title as the resulting commit subject. GitHub can be configured under **Settings → General → Pull Requests → Allow squash merging → Default commit message → Pull request title**. Disable other merge methods if you want every merged change to follow this convention. Direct pushes to `main` also trigger verification and release analysis; their commit messages must follow the same convention.

| Commit | Release |
| --- | --- |
| `fix: preserve paused project` | Patch (`1.2.3` → `1.2.4`) |
| `perf: reduce idle polling` | Patch |
| `feat: add a report` | Minor (`1.2.3` → `1.3.0`) |
| `feat!: change storage format` | Major (`1.2.3` → `2.0.0`) |
| Any supported type with a `BREAKING CHANGE:` body/footer | Major |
| `docs:`, `test:`, `ci:`, `chore:`, `build:`, `style:`, `refactor:` | No release unless breaking |

semantic-release determines the next version from reachable `vX.Y.Z` tags and commits since the previous release. If there are no previous release tags, the first releasable commit produces **v1.0.0**; the development version in `package.json` is not a release baseline. If an earlier version was actually distributed, tag its original commit before enabling this workflow. Do not tag an unpublished version merely to force an increment.

The release job runs only on `main` after **both** verification jobs pass. It uses the automatically supplied `GITHUB_TOKEN` with `contents: write`; no npm publishing token is needed. The npm plugin writes the calculated version into package metadata inside CI, then `npm run package:universal -- --signed` creates `release/timi-darwin-universal/timi.app` and `release/timi-mac-universal.dmg`. The release uploads only the DMG and `SHA256SUMS`, with installation instructions and automatically generated release notes. The checksum is calculated after signing, notarization and stapling finish. No generated version commit is pushed back to the branch. Publishing runs are not canceled by subsequent merges; PR checks can be superseded by newer PR commits.

The stable download URL is:

<https://github.com/Tynamix/timi/releases/latest/download/timi-mac-universal.dmg>

The app supports Apple Silicon and Intel on macOS 13+. Public releases are Developer ID signed and notarized, with tickets stapled to both the app and the DMG. A normal first-launch confirmation for an internet download may still appear. The installed app retains its sandboxed renderers, blocked runtime network access and offline behavior.

## Developer ID signing and notarization

An active paid Apple Developer Program membership is required. Create a **Developer ID Application** certificate and export it together with its private key as a password-protected `.p12`. A Developer ID Installer certificate is not needed for this drag-to-Applications DMG.

Under **Settings → Secrets and variables → Actions**, add these repository secrets:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded `.p12`, including the private key |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_ID` | The Apple Account email used for notarization |
| `APPLE_TEAM_ID` | The ten-character Developer Team ID matching the certificate |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple Account, not its normal login password |

On macOS, `base64 -i /path/to/certificate.p12 | pbcopy` copies the encoded certificate to the clipboard. Paste it directly into the GitHub secret and then clear the clipboard with `printf '' | pbcopy`. Base64 is not encryption. Never commit or paste private keys or passwords into issues, logs or chat; retain a secure backup of the certificate and export password.

The release job:

1. Validates that all five secrets are present, creates a temporary keychain with a random masked password, and imports the certificate. It also imports Apple's official Developer ID G2 intermediate certificate without trust overrides or replacing the user's default keychain/search list.
2. Saves validated notarization credentials as the `timi-notarization` profile in that keychain. The packaging process receives only the keychain path and Team ID, not the Apple password.
3. Selects exactly one valid Developer ID Application identity for the expected team. Electron Packager signs the final merged universal app, including nested code, with Hardened Runtime, secure timestamps and only the JIT entitlement needed by Electron. Signing errors are fatal.
4. Submits a temporary ZIP of the signed app to Apple, requires an `Accepted` response, then staples and validates the app's ticket. The ZIP is an internal submission format, not a downloadable release asset.
5. Creates a compressed, read-only HFS+ DMG containing the stapled app and an Applications shortcut. It signs the DMG, submits it to Apple, and staples and validates the DMG's ticket.
6. Verifies signatures, disk-image integrity and Gatekeeper acceptance. Only then replaces the final DMG and generates its checksum. Native command failures, missing credentials, invalid Apple responses or rejected submissions abort the release; there is no unsigned fallback.
7. Removes the temporary keychain and credential files in an `always()` cleanup step, including after failures.

Each notarization submission waits up to 20 minutes, within the 60-minute release-job timeout. Apple may take longer, especially for a new developer account. A timeout aborts publication even though Apple may continue processing the submission. Check the submission ID in the job output and retry after investigating; rejected submissions print Apple's diagnostic log.

For a local trusted build, provide `APPLE_TEAM_ID` and `MACOS_SIGNING_KEYCHAIN`, store a `timi-notarization` profile in that same keychain using `xcrun notarytool store-credentials`, and run `npm run package:universal -- --signed`. Prefer the interactive credential prompts rather than putting passwords into shell history. The default packaging commands remain credential-free, ad-hoc-signed development builds and must not be published as trusted releases.

Before announcing the first signed release, download the published DMG through a browser on another Mac if possible. Confirm the checksum, open it, drag timi to Applications, eject it, and launch from Applications. Check both tickets with `xcrun stapler validate`, assess the installed app with `spctl --assess --type execute --verbose=2 /Applications/timi.app`, and test first launch without a network connection. Do not remove quarantine attributes or bypass Gatekeeper for this test. Local unit tests cannot verify Apple's hosted service or the downloaded-app experience.

## Repository settings

Workflow files take effect after being pushed to GitHub; this implementation does not change server-side repository settings. Ensure GitHub Actions are enabled and repository/organization policies allow the release job to write repository contents.

For `main`, configure a branch protection rule or ruleset to require pull requests and these checks before merging:

- `Verify (ubuntu-24.04)`
- `Verify (macos-14)`
- `Conventional PR title`

Require branches to be up to date before merging. Review Codex findings alongside the required checks. Branch protection and required checks must be configured in GitHub; adding workflow YAML or enabling AI reviews alone does not enforce them.

To verify locally, run `npm ci && npm run check`. On macOS, also run `npm run package:universal` to validate the development DMG, and `npm run test:native` against the packaged executable when needed. The automation tests exercise semantic version rules, release-note generation, mandatory signing and DMG assets, missing-secret handling, and temporary-keychain cleanup configuration. Distribution tests exercise identity selection, minimal entitlements, DMG contents, signing/notarization order, stapling before copying, and failures preserving a previous DMG. A real hosted signed release and a Codex review must be verified in GitHub after setup.
