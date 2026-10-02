import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { PACK_IMAGE_CACHE, isPackMediaRequest } from './src/data/cache-names'
import { devAuthPlugin } from './server/auth/dev-auth-plugin'
import { trackedPublicPlugin } from './server/vite/tracked-public-plugin'

// vitest picks up dependency test files without an explicit include.

export default defineConfig({
  // public/ is copied by trackedPublicPlugin: untracked pack media stays out.
  build: { copyPublicDir: false },
  plugins: [
    react(),
    devAuthPlugin(),
    trackedPublicPlugin(),
    VitePWA({
      // 'prompt', never 'autoUpdate': an update must never swap content out from
      // under someone mid-session in the field.
      registerType: 'prompt',
      includeAssets: ['icons/*.svg'],
      manifest: false, // authored by hand in public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Pack payload is NEVER precached. It belongs to the pack cache, which
        // the user fills by downloading a pack — precaching it would bundle
        // content into the app shell, re-download it on every service-worker
        // update, and hide the fact that the runtime route below is what
        // actually makes packs work offline.
        globIgnores: ['packs/**'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Serves pack images from the SAME cache `pack-download` fills.
            // Without this route the download succeeds and the gallery is blank
            // offline — the cache is written but nothing reads it on fetch.
            // Self-contained matcher (see cache-names.ts): it is serialised into sw.js.
            urlPattern: isPackMediaRequest,
            handler: 'CacheFirst',
            options: {
              cacheName: PACK_IMAGE_CACHE,
              // No expiration: eviction here is the user's explicit pack
              // delete, never a TTL. A pack must not rot mid-trip.
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'spidex-fonts', expiration: { maxEntries: 24 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['{src,functions,server}/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    // Without this every Dexie path — save, quota recovery, pack delete,
    // integrity — is unexecuted by CI while the suite still reports green.
    setupFiles: ['src/test/setup.ts'],
  },
})
