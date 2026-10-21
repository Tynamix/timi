import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Never leave obsolete desktop bundles in the assets embedded by Tauri.
await rm('dist', { recursive: true, force: true });
await rm('dist-native', { recursive: true, force: true });
await Promise.all([mkdir('dist', { recursive: true }), mkdir('dist-native', { recursive: true })]);
await Promise.all([
  build({ entryPoints: ['src/renderer/index.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', target: 'safari16', sourcemap: true }),
  build({ entryPoints: ['src/native/backend.ts'], outfile: 'dist-native/backend.js', bundle: true, platform: 'browser', format: 'iife', target: 'safari15',
    alias: { 'node:sqlite': resolve('src/native/sqlite.ts'), 'node:crypto': resolve('src/native/crypto.ts') } }),
  ...['index.html', 'style.css'].map(file => copyFile(`src/renderer/${file}`, `dist/${file}`)),
]);
