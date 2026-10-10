import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * One self-contained IIFE per entry. A content script is injected by the
 * browser and the page-world hook is injected by a <script> tag the content
 * script creates, so neither may contain an import statement.
 *
 * The entry is chosen with KIDNAP_ENTRY.
 */
const entry = process.env.KIDNAP_ENTRY ?? 'content';

const inputs = {
  content: resolve(import.meta.dirname, 'src/content/index.ts'),
  'page-hook': resolve(import.meta.dirname, 'src/content/page-hook.ts'),
  sandbox: resolve(import.meta.dirname, 'src/sandbox/convert.ts'),
} as const;

export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  publicDir: false,
  define: {
    // The page hook must not be treated as an extension context.
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    minify: 'esbuild',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: inputs[entry as keyof typeof inputs] ?? inputs.content,
      formats: ['iife'],
      name: 'kidnap',
      fileName: () => {
        if (entry === 'page-hook') return 'page-hook.js';
        if (entry === 'sandbox') return 'sandbox/convert.js';
        return 'content/index.js';
      },
    },
  },
});
