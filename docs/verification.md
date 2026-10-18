# Verification

Shared overview/settings window verified on 19 October 2026: `npm run check` passes with **79 tests**. A targeted native Electron check with disposable storage passes direct settings entry, gear/back navigation, single-window reuse, saved preferences, draft and selected-week retention, close/reopen, correction-editor suspension/restoration and Escape, renderer reload into the selected view, sandbox preferences, and invalid navigation rejection. German light/dark screenshots at the default and minimum window sizes were visually reviewed (`artifacts/workspace/`). The full `npm run test:native` run stopped twice at the existing independent-native-window focus/entry-blur check, before reaching workspace navigation; the targeted workspace check passed separately. The installed app was not rebuilt.

Notification-receipt retry fix verified on 19 October 2026: `npm run check` passes with **79 tests**, and `npm run test:native` passes. After a failed receipt write, all receipt attempts (including new notification-show events) wait 60 seconds before retrying, using a monotonic clock. Controlled-clock tests cover the busy-timeout interval, partial success, repeated failures, and eventual recovery. A real competing SQLite writer verifies that receipts remain pending and retry once the delay expires, without changing tracking state or advancing the durable checkpoint.

Menu-bar display update verified on 19 October 2026: `npm run check` passes with **76 tests**, and `npm run test:native` passes. The switch persists across restart and storage failures preserve the previous preference. Coverage includes decimal daily targets, partial remaining minutes, completion/overtime, days off, and local weekday changes around DST. The native test saves both switch positions and reads the actual status-item title. Its controlled clock now starts at local noon to keep correction examples in the displayed week during real runs just after Monday midnight.

Work-target update verified on 18 October 2026: `npm run check` passes with **73 tests**. `npm run test:native` passes against the development build, including decimal weekday settings, native notification wiring, and durable notification receipts. English and German settings screenshots were visually reviewed. The goal-notification display was mocked; actual macOS banners, permission prompts and Focus behavior require a manual check. The packaged app was not rebuilt for this update. Added coverage includes target validation, failed settings/receipt writes and retries, v1 migration and rollback, restart deduplication, midnight/Monday resets, future correction endpoints, and elapsed target time across DST. Notification receipts do not advance the durable tracking checkpoint.

Verified on 17 October 2026, on an Apple Silicon Mac running Darwin 27, using Electron 44.7.2. Tests use isolated temporary data folders; the user's normal time records and login items were not modified.

Version 1.0.1 filters weekly project rows to projects with positive working time in the selected week. Typechecking and all 60 tests pass for this update. The universal app was rebuilt and its signature and bundled code verified. The full native smoke results below are from version 1.0.0; that suite was not repeated for this display-filter change.

## Automated core checks

`npm run typecheck` and `npm test` pass: **60 tests**, zero failures or skipped tests. The suite covers:

- Precise switching, idempotent project starts, breaks, resume, Stop and clean quit.
- Idle thresholds, settings changes during a streak, delayed native sampling, overlapping lock/sleep, decision-time endpoints and fixed endpoints after Stop/quit.
- Active-use reminders and their independent settings, Later, startup/Stop resets and suppression during breaks.
- Project identity, case-insensitive reuse, renaming and archived history.
- Add/edit/reassign/split/delete corrections; saved, current and pending overlap rejection; no partial commits.
- Actual temporary SQLite databases, trigger-induced aborts, a competing writer, storage retries, malformed schemas/data, transactional legacy migration with a consistent backup, and several queued legacy questions.
- An actual SIGKILL of a child process using SQLite, crash uncertainty, repeated recovery without duplicate time, no closed-app time, and no automatic startup resumption.
- Midnight and Monday boundaries, spring and autumn DST in Europe/Berlin and America/New_York, millisecond accumulation, nonexistent local correction times and both occurrences of repeated local times.
- Backward-clock rejection and recovery, failed native observations replayed in order, and stale clarification IDs rejected.
- Narrow IPC input validation.

## Native integration checks

`npm run test:native` launches real Electron windows through Playwright. The version 1.0.0 universal packaged app passed the suite with no renderer errors, using `TIMI_TEST_EXECUTABLE` to target its executable. The recorded checks and screenshots are in `artifacts/native-smoke/`. The suite covers:

- Accessory activation and no Dock icon; context isolation, sandboxing and no renderer Node access.
- Native inactivity API availability and readback of actual macOS login registration.
- Keyboard project entry, arrow selection, mouse suggestion selection, blank/typing behavior, Escape, entry focus and native window blur.
- Pause/Play/Stop and manual break suppression through synthetic lock/sleep events.
- Settings validation and persistence; weekly view and correction add/split/delete.
- One clarification window with three actions, blocked Escape/close, no repeated focus stealing, continuing decision-time duration and correct resume.
- Independent screen-lock, session inactivity and sleep flags, including overlapping/reordered signals.
- A real SQLite writer lock: failed Stop and quit preserve tracking; retry works; native Quit's Retry action exits cleanly after storage recovers.
- Active-use reminder, Later and Start break without backfill.
- Unknown IPC commands rejected and a renderer network request blocked by CSP.
- macOS per-app German and unsupported French falling back to English.

A separate computer-use check of the packaged universal app confirmed native keyboard entry, automatic entry closure after starting, continued tracking when reopened, Pause, Play, Stop, and Quit. Entry, settings, overview, corrections and clarification screenshots were visually reviewed.

The build declares macOS 13.0 as its minimum, includes x86_64 and arm64 executable slices, and passes `codesign --verify --deep --strict` with an ad-hoc signature.

## Native checks not performed

- Physical lid sleep, screen lock, wake order, and a real prolonged keyboard/trackpad idle streak. Automated integration emits Electron power-monitor events and controls its idle readings; the native inactivity API itself was read successfully.
- A physical status-item click. The macOS UI automation service timed out while inspecting SystemUIServer; activation, entry behavior, status accounting and window focus were verified separately.
- Enabling launch at login, rebooting/logging in, or granting OS approval. The suite verifies actual registration readback without modifying the user's login items.
- Running on separate Intel hardware or macOS 13. The universal binary and minimum OS metadata were inspected on the available Apple Silicon Mac.
- Developer ID signing, Apple notarization or Gatekeeper assessment of a downloaded distribution. The delivered build is locally ad-hoc signed.

The restricted execution sandbox cannot launch native Electron windows or reliably run `iconutil`; these checks and packaging were successfully performed through the approved native execution path. Ordinary terminal commands on a Mac do not have that automation sandbox restriction.
