import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Everything that ships as a module: the service worker and the extension
 * pages. Content scripts and the page-world hook are built by vite.iife.config.ts
 * because they must be single self-contained files with no import statements.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome116',
    minify: 'esbuild',
    // Release builds ship without maps. A published package is 3.9 MB with them
    // and 0.5 MB without, and the extra weight buys a downloader nothing.
    sourcemap: process.env.KIDNAP_RELEASE !== '1',
    // Vite's polyfill touches document and window at module scope, which a
    // service worker does not have. Chrome 116 supports modulepreload natively,
    // so there is nothing to polyfill.
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
        panel: resolve(import.meta.dirname, 'src/panel/index.html'),
        offscreen: resolve(import.meta.dirname, 'src/offscreen/index.html'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background/index.js';
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
