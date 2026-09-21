<div align="center">

<img src="design/spidex-logo.png" width="120" alt="Spidex logo" />

# Spidex

**A field guide for the places with no signal.**

The birds and butterflies of Vietnam and Southeast Asia — species accounts,
identification keys, and voice recordings that live entirely on your phone.

[![CI](https://github.com/hanh090/spidex/actions/workflows/ci.yml/badge.svg)](https://github.com/hanh090/spidex/actions/workflows/ci.yml)
[![Staging](https://img.shields.io/badge/staging-spidex--staging.pages.dev-b8232c)](https://spidex-staging.pages.dev)
[![PWA](https://img.shields.io/badge/PWA-offline--first-5b8a3c)](https://spidex-staging.pages.dev)

**[Open the staging app →](https://spidex-staging.pages.dev)**

</div>

---

Field guides fail where they're needed most: deep in a national park, on a
boat, at 3am with no bars. Spidex is a species index designed the other way
around — a checklist downloads once, then every species, plate and
identification key works with **zero connectivity**.

<div align="center">

| | |
|---|---|
| ![Onboarding — pick a checklist](docs/readme/01-home.png) | ![Pack library — regional checklists](docs/readme/03-library.png) |
| *Download once. Everything lives on the device.* | *Each pack is a complete regional guide — specimens, keys, voices.* |

</div>

## What it does

- **Explore** — a browsable specimen catalogue: Vietnam, Thailand, Malaysia;
  birds and butterflies, with every plate credited and licensed
- **Identify** — trait-based keys that narrow a sighting to a species, built
  for wet and gloved hands: oversized touch targets, sun-readable and
  red-shifted night themes
- **Voice** — bird calls stream from [xeno-canto](https://xeno-canto.org) with
  full recordist and licence attribution
- **Sightings** — a personal field log with photos, GPS and a life list,
  stored locally; exportable to CSV/GeoJSON
- **Packs** — regional species packs install to IndexedDB and stay usable
  offline; the catalogue is served remotely so new packs ship without an app
  release
- **Admin** — `/admin`, a D1-backed console for the pack catalogue, resources
  and users, gated by signed sessions and an admin allowlist
- **i18n** — English · Tiếng Việt · Deutsch

## Stack

| Layer | Tech |
|---|---|
| App | React 18 · TypeScript · Vite · `vite-plugin-pwa` |
| Storage | Dexie (IndexedDB) · service-worker image cache |
| Hosting | Cloudflare Pages + Pages Functions + D1 |
| Auth | WorkOS AuthKit · HMAC-signed session cookies |
| Data | Zod-validated pack manifests · Python content pipeline |
| Tests | Vitest + fake-indexeddb |

## Quick start

```bash
npm install
cp .env.example .env   # WorkOS keys, ADMIN_EMAILS, XENO_CANTO_API_KEY
npm run dev            # http://localhost:5173
```

```bash
npm test               # vitest
npm run typecheck      # tsc -b --noEmit
npm run build          # → dist/
```

## How it's put together

[![Spidex architecture](docs/architecture.png)](docs/architecture.html)

*Click through for the interactive version — pan, zoom and trace each
relationship. Spec lives in `docs/architecture.archify.json`.*

```
src/            screens, features, data layer, i18n, ui primitives
functions/      Pages Functions — auth, /api/admin/*, pack index filter
public/packs/   species packs (ndjson + plates), catalogue index.json
data/           source checklists, fetched voices, manifests
scripts/        content pipeline (Python): checklists → packs → voices
migrations/     D1 schema for the admin store
```

**Offline contract.** Online, the library lists every pack in
`packs/index.json`; a pack becomes usable when downloaded, and offline the
library shows only what's installed. Removing a pack never removes your
sightings.

**Bird voices.** `scripts/fetch_bird_voices.py` pulls CC-licensed recordings
from the xeno-canto API (non-commercial licences included — the app is free)
into `data/voices/`, then `apply_voices_to_pack.py` merges `sounds[]` into a
pack's `species.ndjson`. Audio streams at playback — packs stay small.

## Deploy

Merges to `master` deploy to Cloudflare Pages via `.github/workflows/ci.yml`
(secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). One-time D1 setup:

```bash
wrangler d1 create spidex-admin
wrangler d1 execute spidex-admin --file=migrations/0001_admin.sql --remote
```

Manual deploy: `npm run deploy` / `npm run deploy:preview`.

## Acknowledgements

Recordings © their recordists, via [xeno-canto](https://xeno-canto.org) —
each carries its own Creative Commons licence, shown in-app. Specimen plates
and pack photography are credited per image inside each pack manifest.
