# Using and developing timi

[← Back to the README](../README.md)

A local, offline menu-bar time tracker for macOS 13 or later. Tauri 2, Rust, TypeScript, system WebKit/JavaScriptCore, plain HTML/CSS, and SQLite. MIT licensed. No accounts, synchronization, analytics, remote assets, or runtime network requests.

## Install and run

Download [timi for macOS (Apple Silicon + Intel)](https://github.com/Tynamix/timi/releases/latest/download/timi-mac-universal.dmg) from [GitHub Releases](https://github.com/Tynamix/timi/releases/latest), open the DMG, and drag **timi** onto the **Applications** shortcut. Eject the disk image and launch timi from Applications. Requires macOS 13 or later.

Official releases are Developer ID signed and notarized by Apple. Both the app and DMG have attached notarization tickets for offline verification. macOS may still ask you to confirm the first launch of an internet download; this is different from an unidentified-developer warning. Each release includes `SHA256SUMS`; download it beside the DMG and run `shasum -a 256 -c SHA256SUMS` to verify the download.

To run from source, use Node.js 22.14 or later, stable Rust (installed with rustup), and macOS with Xcode Command Line Tools. CI uses Node.js 24.10. Development and packaging download dependencies; the installed application works offline.

```sh
npm ci
npm start
```

Click the clock and today's total in the menu bar. Enter a project name, select an existing suggestion with the arrow keys and Enter, or click a suggestion. Names are trimmed and reused without regard to case. Escape or clicking outside closes entry; tracking continues. There is no permanent Dock icon.

Pause records a projectless break. Play resumes the paused project at that instant. Starting any project ends a break. Stop ends recording and clears Play. The menu-bar context menu also provides Stop, weekly overview, settings, and Quit. Weekly overview and settings share one resizable window. Use the labeled Settings button in the overview to open settings and the back button to return. Settings from the tracker or menu opens that view directly in the same window. Unsaved preferences and the selected week are preserved while switching views.

After five minutes without native keyboard, mouse, or trackpad activity, the complete interval since the last activity is excluded from work. Returning opens one question: record as work on the previous project, record as a projectless break, or discard. The interval continues until the choice is made, then the previous project resumes. Locking or sleeping creates the same question immediately; it appears only after both waking and unlocking. The question stays above other windows, including across Spaces and over full-screen apps, until answered. Other applications remain usable without the question repeatedly taking keyboard focus. Stop or Quit fixes the pending endpoint and prevents resumption.

After ten minutes of active use without tracking, an entry reminder offers a project, Later, or Start break. Nothing is backfilled. Manual breaks suppress both kinds of reminder. Both thresholds can be configured independently in Settings using positive whole minutes.

In **Settings → Working time targets**, set hours for Monday through Sunday, for example Monday **7.6**, Tuesday **8**, Saturday **4**, and Sunday **0** (a day off). Decimal commas and points both work; 7.6 hours means 7 hours 36 minutes. The weekly target is the sum of all seven days. Targets start at zero until you configure them. Today's entry and the current weekly overview show worked time alongside the target.

The **Menu bar → Show remaining working time** switch selects the status-item timer: off shows time worked today; on counts down to today's target, reaches **0:00**, then shows overtime as negative time (for example **−0:15** for 15 extra minutes). A partial remaining minute is rounded up so the display does not show zero early. Overtime shows completed minutes, with **−0:00** during the first partial overtime minute. Without a target for the current day, it shows worked time. Configure at least one working day to enable the switch. The choice persists across restarts; hovering over the menu-bar timer also shows today's worked time.

Daily and weekly target notifications can be enabled separately. timi sends a native macOS notification when confirmed working time reaches each target, once per local day or Monday–Sunday week, including across restarts. Breaks and unresolved idle/recovery time are excluded; ongoing work counts through the last confirmed activity. Resolving time as work or correcting records can also reach a target. Changing targets or correcting time does not repeat a notification already shown in that period. Tracking continues after a target is reached. Allow timi under **System Settings → Notifications** to see notifications; macOS Focus and notification preferences control presentation. Clicking a notification opens the weekly overview.

## Reports and corrections

Open **Weekly overview** from entry or the menu-bar context menu. Browse this week and prior weeks. Only projects with working time in the selected week appear as rows, including archived projects with time in that week. Work is grouped by project and Monday–Sunday; breaks have separate totals. The indicator and reports share the same accounting functions. Records are split at current local calendar boundaries, including DST, using actual elapsed milliseconds. Displayed H:MM totals truncate only after summing milliseconds; there is no commercial rounding.

The overview includes record inspection and an editor for missing work/breaks, boundaries, project assignment, splits, and deletion. A replacement or split commits atomically. Conflicts with saved records, current work/breaks, or unanswered periods are rejected and explained without altering other records. Finish current recording before editing that interval. Project management supports names, rename, archive, and restore. Archived projects retain their identity and history and disappear from normal project suggestions.

Times are displayed and entered to the minute, without seconds or milliseconds. Editing a boundary sets it to the selected minute; unchanged boundaries retain their exact saved timestamps, including when changing projects or splitting a record. Internal tracking and totals still use actual elapsed milliseconds. During the autumn clock change, the editor lets you choose between repeated local times; nonexistent spring-forward times are rejected.

English and German follow the macOS per-app preferred language, with English fallback. Set this in macOS System Settings, not inside timi. Optional launch at login is available in the packaged app and reflects the actual macOS registration. Every launch begins untracked, including login launches.

## Build and verify

```sh
npm run typecheck
npm test
npm run test:native
npm run package
open release/timi-darwin-arm64/timi.app
```

`npm run package` builds for the host Mac architecture, with a DMG at `release/timi-mac-arm64.dmg` or `release/timi-mac-x64.dmg`. The Intel app output directory is `release/timi-darwin-x64`. `npm run package:universal` builds a single application for Apple Silicon and Intel, at `release/timi-darwin-universal/timi.app` with `release/timi-mac-universal.dmg`. Install both Rust targets first with `rustup target add aarch64-apple-darwin x86_64-apple-darwin`. Each DMG contains the app and an Applications shortcut. Tauri compiles the native executable and embeds the local interface and tracking core; it does not bundle a browser or Node runtime.

Local packaging defaults to ad-hoc signing, verifies the signature and disk image, and does not contact Apple's notary service or require credentials. These are development builds, not trusted downloads for other Macs; macOS may require **Open Anyway** for an externally downloaded local build. Public releases explicitly use `npm run package:universal -- --signed`, with Developer ID signing, Hardened Runtime, notarization, stapling, and Gatekeeper checks. Missing credentials or failed checks abort packaging rather than falling back to an ad-hoc release. See [release signing](#release-signing).

The core tests use controlled clocks, real isolated SQLite files, failures and retries, recovery, migration, midnight/week changes, and DST in Europe/Berlin and America/New_York. `npm run test:native` compiles and runs native JavaScriptCore/SQLite integration, macOS platform/WebKit checks and Rust tests. WebKit checks compile the actual content-blocking rules; desktop-dependent window and loopback-network probes report an explicit skip when the environment cannot run them. `npm run test:engine` runs only the JavaScriptCore/SQLite checks. These tests use temporary data. Engine and Rust checks do not require a desktop session; full native WebKit/window checks do. Linux CI runs the platform-neutral TypeScript tests and asset build; macOS CI also runs native integration tests.

WKWebView does not expose Electron’s Playwright automation interface. The native tests therefore do not claim end-to-end desktop UI coverage. Verify a packaged app in a macOS desktop session before distribution:

- Start with a separate `--data-directory`, verify startup is untracked, then start, switch, pause, resume and stop projects from the tracker and tray.
- Check entry positioning and dismissal, the shared overview/settings window, keyboard entry, corrections, English/German, and both light/dark appearances.
- Exercise actual inactivity, screen lock and sleep, including overlapping lock/sleep, Spaces and full-screen apps. Confirm that the whole absence remains unresolved until classified and that the question stays above other windows without repeatedly stealing focus.
- Test daily/weekly notification delivery and clicks, actual launch at login, and reopening with a durable checkpoint after forced termination.
- Launch the installed app offline and confirm that denied external navigation, requests and malformed commands cannot escape the local interface.

Use `open release/timi-darwin-arm64/timi.app --args --data-directory=/tmp/timi-packaged-test` for an isolated packaged launch. Universal binaries still require testing on Intel hardware and the minimum supported macOS. See the [screenshot instructions](screenshots.md) for reproducible renderer captures, which do not replace native UI checks.

### Debug in VS Code

Install dependencies with `npm ci`, stable Rust from [rustup.rs](https://rustup.rs), Xcode Command Line Tools, and the recommended **CodeLLDB** VS Code extension (`vadimcn.vscode-lldb`). Open **Run and Debug**, select **timi: Tauri native**, and press **F5**. The task builds the frontend/backend bundles and runs `npm run build:native` before attaching LLDB. Build scripts also find Cargo in `$CARGO_HOME/bin` or the standard `~/.cargo/bin` location when an already-open editor has an older PATH. Rust must be installed permanently; a toolchain in `/tmp` is not a development setup. Set Rust breakpoints in `src-tauri/src/`; debug the renderer with WebKit’s inspector in a development build. A Chromium remote-debugging port is no longer used.

Debug launches use `.cache/vscode-debug/`, separate from normal records, and their own instance identifier so they can run alongside the installed release app. Development uses local embedded assets without a development HTTP server. After TypeScript or CSS changes, stop and rebuild. `npm start -- --data-directory=/tmp/timi-sandbox` also runs a development instance without a watcher. Use **Quit timi** for a durable shutdown; stopping a debugger forcibly exercises crash recovery in the isolated database.

## Pull requests and releases

Every pull request targeting `main` and push to `main` runs type checking, unit tests and the build on Linux and macOS. Protect `main` with required pull requests and the checks `Verify (ubuntu-24.04)`, `Verify (macos-14)` and `Conventional PR title`. AI reviews use the native Codex GitHub integration, configured in Codex repository settings. Review guidance lives in [AGENTS.md](../AGENTS.md); no AI credentials are needed in GitHub Actions.

Use Conventional Commit PR titles and squash-merge with that title: `fix: …` creates a patch release, `feat: …` a minor release, and `feat!: …` or a `BREAKING CHANGE:` footer a major release. Documentation, CI and other maintenance-only changes do not create a release unless breaking. After merges to `main`, successful Linux and macOS checks allow semantic-release to publish a version tag, release notes, a signed and notarized universal macOS DMG and its checksum. Versions are calculated from reachable `vX.Y.Z` tags; without a previous release tag the first release is `1.0.0`. Version metadata is set before packaging, not committed back to `main`. The automatic `GITHUB_TOKEN` needs `contents: write`; no npm publishing token is needed.

### Release signing

An active paid Apple Developer Program membership and a **Developer ID Application** certificate are required. Export the certificate together with its private key as a password-protected `.p12` and add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded `.p12`, including the private key |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_ID` | Apple Account email for notarization |
| `APPLE_TEAM_ID` | The certificate's ten-character Developer Team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific Apple password, not the normal account password |

Base64 is not encryption. Never commit certificates containing private keys or passwords. The workflow imports the certificate into a temporary keychain using `apple-actions/import-codesign-certs`, checks actual signing, then signs and notarizes both the app and DMG. Tickets are stapled for offline verification; publication requires Apple's `Accepted` status and successful signature/Gatekeeper checks. Temporary credentials are cleaned up after the job.

Each Apple submission can wait up to 60 minutes; the release-job limit is 150 minutes. Phase messages, submission IDs and native progress appear in the job log. Apple may continue processing after a timeout; query the existing submission before retrying. A later acceptance does not automatically finish an aborted release or cover a differently rebuilt app.

Local signed builds require `APPLE_TEAM_ID`, `MACOS_SIGNING_KEYCHAIN`, and a `timi-notarization` profile stored in that keychain with `xcrun notarytool store-credentials`. Use its interactive password prompt. `node scripts/signing-check.mjs` checks signing without uploading an app; `npm run package:universal -- --signed` builds the trusted DMG.

Before distributing a release, browser-download the DMG, verify its checksum, drag timi to Applications, eject the image and test launch, including offline. Do not bypass Gatekeeper or remove quarantine attributes for this check. Test results belong in CI logs and pull requests, not a running verification diary.

## Data and recovery

Records are stored at `~/Library/Application Support/timi/tracking.sqlite`. To use an isolated development or testing directory:

```sh
npm start -- --data-directory=/tmp/timi-sandbox
```

The app uses SQLite transactions, WAL, full synchronous writes, and macOS full-fsync. Transitions, classifications, corrections, and checkpoints persist through one application interface. Failed writes retain the prior state and can be retried. A failed quit leaves the app open. The menu-bar exclamation mark and localized errors make failures visible.

An intentional quit saves through the quit instant, ends tracking, and records a clean exit. A crash is durably distinguishable from a clean exit. On restart, certain saved work is retained; recoverable uncertainty is bounded by the latest durable checkpoint, never the restart time. One question allows work, break, or discard; only crash recovery allows a different project. Existing unanswered idle questions retain their original project and fixed endpoint. Nothing resumes automatically. Time after the last durable checkpoint cannot be inferred and can be added explicitly through corrections.

The earlier unversioned timi schema (`projects`, `periods`, `breaks`, `idle_periods`, `settings`) is migrated in one transaction. A consistent `tracking.sqlite.pre-v1-….sqlite` backup is created first and the original tables are retained. Stable project identities, existing endpoints, settings, and unanswered questions survive. Unknown schemas, invalid rows, and unreadable databases are refused; the app never resets them. Quit the older timi version before opening this version and do not run both against one database. To back up manually, quit timi and copy the whole data directory.

Schema v1 databases receive a consistent `tracking.sqlite.pre-v2-….sqlite` backup before the atomic upgrade for work targets and notification receipts. Receipt writes leave the durable tracking checkpoint unchanged.

## Architecture and privacy

`src/core/application.ts` remains the platform-neutral application interface. `store.ts` owns SQLite and migrations; `accounting.ts` owns local-calendar totals. The existing TypeScript tracking core is bundled into a dedicated system JavaScriptCore context through `src/native/backend.ts`. Native bridges provide UUIDs and prepared SQLite statements; the core is never loaded into a webview. No tracking rules are duplicated in Rust.

`src-tauri/` provides the Tauri application, native inactivity/power/lock observation, menu bar, notifications, login registration and window lifecycle. `src/desktop.ts` exposes the same narrow typed application interface to the existing HTML/CSS renderer, using validated Tauri commands and application events. The macOS adapter uses system APIs; only macOS is delivered here.

WebKit runs the interface in a separate process with no Node integration or direct database/filesystem access. A restrictive content security policy and native request/navigation handling block runtime network requests and external navigation. Tauri capabilities do not grant general shell, HTTP or filesystem access to the renderer. The app reads the operating system’s elapsed inactivity counter and power/lock events, never input contents or application usage. No global shortcuts, CSV exports, invoices, integrations, or project hierarchies are included.

See Tauri’s [process model](https://v2.tauri.app/concept/process-model/), [IPC](https://v2.tauri.app/concept/inter-process-communication/) and [capabilities](https://v2.tauri.app/security/capabilities/), and Apple’s [JavaScriptCore framework](https://developer.apple.com/documentation/javascriptcore).
