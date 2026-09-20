# Spidex

A field-native species guide PWA for the birds and butterflies of Vietnam and
Southeast Asia. Offline-first and installable: regional species packs download
to the device so the guide works without a signal.

## Features

- **Explore** — browsable species catalogue from downloadable packs
  (Vietnam, Thailand, Malaysia; birds and butterflies)
- **Identify** — trait-based filtering to narrow down a sighting
- **Sightings** — personal field log with photos and life list, stored locally
- **Compare** — side-by-side species comparison
- **Packs** — offline species packs with hand-drawn archetype plates and
  bird voices (xeno-canto)
- **Admin console** — `/admin`, a D1-backed resource store gated by
  `ADMIN_EMAILS`
- **i18n** — English, Vietnamese, German
- **PWA** — installable, service-worker precache for offline use

## Stack

- React 18 + TypeScript + Vite + `vite-plugin-pwa`
- Cloudflare Pages (static hosting) + Pages Functions (`functions/`) +
  D1 (`spidex-admin` resource store)
- WorkOS AuthKit for sign-in; signed session cookies (`functions/lib/session.ts`)
- Dexie (IndexedDB) for offline storage, React Router, i18next, Zod
- Vitest + fake-indexeddb for tests
- Python 3 pipeline in `scripts/` for pack content

## Development

```bash
npm install
npm run dev         # vite dev server
npm test            # vitest
npm run typecheck   # tsc -b --noEmit
npm run build       # → dist/
```

Copy `.env.example` to `.env` and fill in the values: WorkOS keys for auth,
`ADMIN_EMAILS` for the admin console, `XENO_CANTO_API_KEY` for the
bird-voice pipeline.

## CI/CD

`.github/workflows/ci.yml` runs typecheck, tests, and a production build on
every pull request and push to `master`. Merges to `master` deploy to
Cloudflare Pages. Required repo secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Manual deploy: `npm run deploy` (uses `wrangler pages deploy`).

D1 one-time setup:

```bash
wrangler d1 create spidex-admin
wrangler d1 execute spidex-admin --file=migrations/0001_admin.sql --remote
```

## Data pipeline

`scripts/` compiles source checklists (`data/checklists/`) into pack files
(`public/packs/*/species.ndjson`), generates the archetype SVG plates, and
fetches bird voices. Pack photography is bulk content and stays out of git —
see `.gitignore`.

## Layout

```
src/            app code (screens, features, data layer, i18n, ui)
functions/      Cloudflare Pages Functions (auth, admin API, pack index)
public/packs/   species packs (ndjson + archetype plates)
data/           source checklists, voices, manifests
scripts/        pack/content pipeline (Python)
migrations/     D1 schema
docs/           source checklist notes
```
