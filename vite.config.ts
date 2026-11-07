import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import UnoCSS from 'unocss/vite';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '.');
const upstream = resolve(ROOT, '..', 'AionUi', 'package.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { readFileSync } from 'node:fs';
const upstreamVersion = JSON.parse(readFileSync(upstream, 'utf8')).version as string;

export default defineConfig({
  root: resolve(ROOT, 'src/renderer'),
  base: './',
  publicDir: resolve(ROOT, 'public'),
  plugins: [UnoCSS(resolve(ROOT, 'uno.config.ts')), react()],
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  resolve: {
    alias: {
      '@': resolve(ROOT, 'src'),
      '@common': resolve(ROOT, 'src/common'),
      '@renderer': resolve(ROOT, 'src/renderer'),
      streamdown: resolve(ROOT, 'node_modules/streamdown/dist/index.js'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.css', '.json'],
    dedupe: ['react', 'react-dom', 'react-router-dom', 'react-i18next', 'i18next'],
  },
  build: {
    outDir: resolve(ROOT, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { index: resolve(ROOT, 'src/renderer/index.html') },
      external: ['node:crypto', 'crypto', 'electron'],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'process.env.AIONUI_MULTI_INSTANCE': JSON.stringify(process.env.AIONUI_MULTI_INSTANCE ?? ''),
    'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? ''),
    __APP_VERSION__: JSON.stringify(upstreamVersion),
    __IS_DISCONTINUED_BUILD__: JSON.stringify(false),
    global: 'globalThis',
  },
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-router-dom', 'react-i18next', 'i18next',
      '@arco-design/web-react', '@icon-park/react', 'react-markdown',
      'react-syntax-highlighter', 'classnames', 'swr', 'eventemitter3',
      'katex', 'diff2html', 'remark-gfm', 'remark-math', 'remark-breaks',
      'rehype-raw', 'rehype-katex',
    ],
  },
});
