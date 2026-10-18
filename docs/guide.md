# Using and developing timi

[← Back to the README](../README.md)

A local, offline menu-bar time tracker for macOS 13 or later. Electron, TypeScript, plain HTML/CSS, and SQLite. MIT licensed. No accounts, synchronization, analytics, remote assets, or runtime network requests.

## Install and run

Download [timi for macOS (Apple Silicon + Intel)](https://github.com/Tynamix/timi/releases/latest/download/timi-mac-universal.zip) from [GitHub Releases](https://github.com/Tynamix/timi/releases/latest), unzip it, and drag **timi.app** into Applications. Requires macOS 13 or later.

The download is ad-hoc signed, without Apple notarization. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway**. Each release includes `SHA256SUMS`; download it beside the ZIP and run `shasum -a 256 -c SHA256SUMS` to verify the archive.

To run from source, use Node.js 22.14 or later and macOS with Xcode Command Line Tools. CI uses Node.js 24.10. Development and packaging download dependencies; the installed application works offline.

```sh
npm ci
npm start
```

Click the clock and today's total in the menu bar. Enter a project name, select an existing suggestion with the arrow keys and Enter, or click a suggestion. Names are trimmed and reused without regard to case. Escape or clicking outside closes entry; tracking continues. There is no permanent Dock icon.

Pause records a projectless break. Play resumes the paused project at that instant. Starting any project ends a break. Stop ends recording and clears Play. The menu-bar context menu also provides Stop, weekly overview, settings, and Quit.

After five minutes without native keyboard, mouse, or trackpad activity, the complete interval since the last activity is excluded from work. Returning opens one question: record as work on the previous project, record as a projectless break, or discard. The interval continues until the choice is made, then the previous project resumes. Locking or sleeping creates the same question immediately; it appears only after both waking and unlocking. Other applications remain usable while the question is open. Stop or Quit fixes the pending endpoint and prevents resumption.

After ten minutes of active use without tracking, an entry reminder offers a project, Later, or Start break. Nothing is backfilled. Manual breaks suppress both kinds of reminder. Both thresholds can be configured independently in Settings using positive whole minutes.

In **Settings → Working time targets**, set hours for Monday through Sunday, for example Monday **7.6**, Tuesday **8**, Saturday **4**, and Sunday **0** (a day off). Decimal commas and points both work; 7.6 hours means 7 hours 36 minutes. The weekly target is the sum of all seven days. Targets start at zero until you configure them. Today's entry and the current weekly overview show worked time alongside the target.

The **Menu bar → Show remaining working time** switch selects the status-item timer: off shows time worked today; on counts down to today's target, reaches **0:00**, then shows overtime as negative time (for example **−0:15** for 15 extra minutes). A partial remaining minute is rounded up so the display does not show zero early. Overtime shows completed minutes, with **−0:00** during the first partial overtime minute. Without a target for the current day, it shows worked time. Configure at least one working day to enable the switch. The choice persists across restarts; hovering over the menu-bar timer also shows today's worked time.

Daily and weekly target notifications can be enabled separately. timi sends a native macOS notification when confirmed working time reaches each target, once per local day or Monday–Sunday week, including across restarts. Breaks and unresolved idle/recovery time are excluded; ongoing work counts through the last confirmed activity. Resolving time as work or correcting records can also reach a target. Changing targets or correcting time does not repeat a notification already shown in that period. Tracking continues after a target is reached. Allow timi under **System Settings → Notifications** to see notifications; macOS Focus and notification preferences control presentation. Clicking a notification opens the weekly overview.

## Reports and corrections

Open **Weekly overview** from entry or the menu-bar context menu. Browse this week and prior weeks. Only projects with working time in the selected week appear as rows, including archived projects with time in that week. Work is grouped by project and Monday–Sunday; breaks have separate totals. The indicator and reports share the same accounting functions. Records are split at current local calendar boundaries, including DST, using actual elapsed milliseconds. Displayed H:MM totals truncate only after summing milliseconds; there is no commercial rounding.

The overview includes record inspection and an editor for missing work/breaks, boundaries, project assignment, splits, and deletion. A replacement or split commits atomically. Conflicts with saved records, current work/breaks, or unanswered periods are rejected and explained without altering other records. Finish current recording before editing that interval. Project management supports names, rename, archive, and restore. Archived projects retain their identity and history and disappear from normal project suggestions.

English and German follow the macOS per-app preferred language, with English fallback. Set this in macOS System Settings, not inside timi. Optional launch at login is available in the packaged app and reflects the actual macOS registration. Every launch begins untracked, including login launches.

## Build and verify

```sh
npm run typecheck
npm test
npm run test:native
npm run package
open release/timi-darwin-arm64/timi.app
```

`npm run package` builds for the host Mac architecture. The Intel output directory is `release/timi-darwin-x64`. `npm run package:universal` builds a single application for Apple Silicon and Intel (and downloads both Electron runtimes), at `release/timi-darwin-universal/timi.app` with `release/timi-mac-universal.zip`. Packaging verifies the ad-hoc signature and creates a ZIP beside the app. Drag `timi.app` into Applications to install. Distributing it to other Macs requires your own Apple Developer signing and notarization. macOS may require **Open Anyway** for an externally downloaded local build.

To run native smoke tests against a packaged app:

```sh
TIMI_TEST_EXECUTABLE="$PWD/release/timi-darwin-arm64/timi.app/Contents/MacOS/timi" npm run test:native
```

The core tests use controlled clocks, real isolated SQLite files, failures and retries, recovery, migration, midnight/week changes, and DST in Europe/Berlin and America/New_York. Native smoke tests run actual Electron windows with isolated data directories; lock/sleep signals and time advancement are injected. Screenshots and the recorded native-check limits are described in [verification](verification.md).

## Pull requests and releases

Every pull request targeting `main` runs type checking, unit tests and the build on Linux and macOS. AI reviews use the native Codex GitHub integration, enabled in Codex repository settings. Review guidance lives in [AGENTS.md](../AGENTS.md); no AI credentials are needed in GitHub Actions. See [automation setup](automation.md) for review configuration and repository settings.

Use Conventional Commit PR titles and squash-merge with that title: `fix: …` creates a patch release, `feat: …` a minor release, and `feat!: …` or a `BREAKING CHANGE:` footer a major release. Documentation, CI and other maintenance-only changes do not create a release. After merges to `main`, successful Linux and macOS checks allow semantic-release to publish a version tag, release notes, a universal macOS ZIP and its checksum. Version metadata is set before packaging; versions are not committed back to `main`. See [automation setup](automation.md) for the recommended branch rules and first-release behavior.

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

`src/core/application.ts` is the platform-neutral application interface. `store.ts` owns SQLite and migrations; `accounting.ts` owns local-calendar totals. `src/main.ts` adapts macOS inactivity, sleep/lock, menu bar, login registration, and window lifetime. `src/preload.ts` exposes a narrow, validated IPC interface to the plain renderer. The core has no Electron imports and can be reused by a future Windows adapter; only macOS is delivered here.

Renderers are sandboxed with context isolation and no Node integration. Navigation, new windows, permissions, downloads, and network requests are blocked; a restrictive content security policy permits local assets only. The app reads the operating system's elapsed inactivity counter and power/lock events, never input contents or application usage. No global shortcuts, CSV exports, invoices, integrations, or project hierarchies are included.

Native integration uses the documented [Electron power monitor](https://www.electronjs.org/docs/latest/api/power-monitor), [application lifecycle and login registration APIs](https://www.electronjs.org/docs/latest/api/app), and [security recommendations](https://www.electronjs.org/docs/latest/tutorial/security).
