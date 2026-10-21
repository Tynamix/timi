# README screenshots

The README shows the app interface with fictional projects and records. Existing screenshots are retained to preserve the visual reference during the Tauri migration. `hero.png` combines tracker and overview images on a presentation background; the other images show interface views. All assets live under `docs/images/`.

To refresh renderer captures on macOS, where the app’s system fonts are available:

```sh
npm ci
npx playwright install webkit
npm run screenshots
```

The script runs the exact HTML/CSS/TypeScript renderer in Playwright WebKit, with a temporary test-only desktop bridge backed by the real tracking core and a disposable SQLite database. The production Tauri bridge is not altered. It uses English, light appearance, a fixed clock and Europe/Berlin local time. The fixtures neither open the normal database nor change login registration. Browser and temporary data are cleaned up after capture.

These are renderer captures, not native Tauri window automation. They validate the interface, totals, navigation and correction dialog. They do not verify the system WKWebView version, native tray/window behavior, native IPC, notification banners, physical sleep/lock, or login registration. Follow the [native verification guide](guide.md#build-and-verify) for those checks. The old Electron Playwright driver has been removed.

Captures show a 38-hour weekly target: eight hours Monday through Thursday, six on Friday, and weekends off. They include tracking, weekly overview, settings, a split correction before saving and an unresolved 18-minute absence. Sample work remains below daily and weekly targets.

Visually check all six PNGs before committing them, especially totals, settings layout and dialog boundaries. To capture into a disposable review directory instead, run `TIMI_SCREENSHOT_DIRECTORY=artifacts/webkit-screenshots npm run screenshots`.

Set `TIMI_SCREENSHOT_THEME=dark` with a separate output directory to review dark appearance.
