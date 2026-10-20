import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', target: 'node24', external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', target: 'node24', external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/renderer/index.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', target: 'chrome152', sourcemap: true }),
  ...['index.html', 'style.css'].map(file => copyFile(`src/renderer/${file}`, `dist/${file}`)),
]);
