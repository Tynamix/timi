# Pull request checks and automatic releases

## Workflows

- `Verify and release`: PRs to `main` and pushes to `main` run `npm ci` and `npm run check` on Ubuntu 24.04 and macOS 14 with Node.js 24.10.0. This includes TypeScript checks, all unit tests (including the automation tests) and the build.
- `Conventional PR title`: checks titles on open, edit, update, reopen and ready-for-review events. It accepts `type(scope)!: description` with an optional scope and breaking-change marker.

The CI does not run the interactive native smoke suite, which needs a macOS desktop session. Run `npm run test:native` locally when changing native window behavior. Packaging still verifies the application signature before creating the release archive.

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

The release job runs only on `main` after **both** verification jobs pass. It uses the automatically supplied `GITHUB_TOKEN` with `contents: write`; no npm publishing token is needed. The npm plugin writes the calculated version into package metadata inside CI, then the packaging command creates `release/timi-darwin-universal/timi.app` and `release/timi-mac-universal.zip`. The release uploads the ZIP and `SHA256SUMS`, with installation instructions and automatically generated release notes. No generated version commit is pushed back to the branch. Publishing runs are not canceled by subsequent merges; PR checks can be superseded by newer PR commits.

The stable download URL is:

<https://github.com/Tynamix/timi/releases/latest/download/timi-mac-universal.zip>

The app supports Apple Silicon and Intel on macOS 13+. Builds are ad-hoc signed and checked by `codesign`, without Developer ID signing or Apple notarization. First launch can require **System Settings → Privacy & Security → Open Anyway**. Apple-trusted distribution would additionally need Apple Developer credentials and a signing/notarization integration.

## Repository settings

Workflow files take effect after being pushed to GitHub; this implementation does not change server-side repository settings. Ensure GitHub Actions are enabled and repository/organization policies allow the release job to write repository contents.

For `main`, configure a branch protection rule or ruleset to require pull requests and these checks before merging:

- `Verify (ubuntu-24.04)`
- `Verify (macos-14)`
- `Conventional PR title`

Require branches to be up to date before merging. Review Codex findings alongside the required checks. Branch protection and required checks must be configured in GitHub; adding workflow YAML or enabling AI reviews alone does not enforce them.

To verify locally, run `npm ci && npm run check`. On macOS, also run `npm run package:universal` to validate the download build. The automation tests exercise semantic version rules and release-note generation. A real hosted release and a Codex review must be verified in GitHub after setup.
