import path from 'node:path'

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

export default defineConfig({
  root: 'src',
  server: { port: 3000 },
  plugins: [
    svgr(),
    react(),
    legacy({
      modernTargets: ['edge>=109', 'safari>=14'],
      renderLegacyChunks: false,
      // Auto-detected from the emitted bundle, dependencies included,
      // so post-Safari-14 APIs never depend on extending a manual list.
      modernPolyfills: true,
      additionalModernPolyfills: [
        path.resolve('./src/polyfills/matchMedia.js'),
        path.resolve('./src/polyfills/WeakRef.js'),
        path.resolve('./src/polyfills/RegExp.js'),
      ],
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // The lazy Monaco editor chunk is ~2.7 MB minified: splitting it further
    // cuts Monaco's module graph into mutually dependent chunks, so the
    // threshold sits just above it. An accidental eager import still fails
    // `check:bundle-budget`, which is the regression this guard protects.
    chunkSizeWarningLimit: 2800,
    rollupOptions: {
      input: {
        main: path.resolve('src/index.html'),
      },
      output: {
        // Vendor groups are intentionally narrow: only libraries that every
        // route shares are pinned so route-level code splitting stays intact.
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[/](react|react-dom|scheduler)[/]/,
            },
            { name: 'vendor-mui', test: /node_modules[/]@mui[/]/ },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      '@root': path.resolve('.'),
      'monaco-editor/esm/vs/editor/editor.worker.js':
        'monaco-editor/editor/editor.worker',
    },
  },
  define: {
    OS_PLATFORM: `"${process.platform}"`,
  },
})
