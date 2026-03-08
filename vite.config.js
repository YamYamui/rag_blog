// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  // Use './' for GitHub Pages compatibility.
  // If your repo is at username.github.io (not /repo-name/), change to '/'.
  base: './',

  optimizeDeps: {
    // Exclude Transformers.js from Vite's pre-bundler.
    // The worker imports it directly from CDN, so Vite never needs to touch it.
    exclude: ['@xenova/transformers'],
  },

  worker: {
    format: 'es',
  },

  build: {
    target: 'es2020',
  },

  server: {
    // These headers are required for SharedArrayBuffer, which ONNX Runtime
    // uses internally. Without them the worker silently falls back.
    // In production on GitHub Pages, coi-serviceworker.js handles this instead.
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
