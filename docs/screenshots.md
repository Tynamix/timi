# README screenshots

The README uses captures of the actual Electron app with fictional projects and records. `hero.png` combines the tracking and overview captures with a presentation background; the other images show the app UI directly. All assets are committed under `docs/images/`, so the product screenshots do not rely on an external image host.

To refresh them on a Mac with an active desktop session:

```sh
npm ci
npm run build
node scripts/screenshots.mjs
```

The script opens a separate Electron instance with a temporary data directory, English UI, light appearance, and a fixed demo clock in Europe/Berlin. It does not use your normal tracking database or modify login registration. It removes its temporary data after closing the demo instance.

The captures show tracking, the weekly overview, a split correction before saving, and an unresolved absence. The fixed clock and synthetic lock event are for reproducible illustrations; they do not verify physical sleep or lock behavior. See [verification notes](verification.md) for native test coverage.

Visually check all five PNGs after regenerating, especially labels, dialog boundaries, and the composed header. Screenshot capture requires permission to launch local Electron windows in restricted automation environments.
