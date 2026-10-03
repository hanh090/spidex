# Rollout decisions

Decisions taken to ship Spidex quickly, each meant to be revisited. Every row
says what was chosen, why, and how to change it.

| # | Area | Decision | Why | To revisit |
|---|---|---|---|---|
| 1 | Licence | Code is AGPL-3.0-or-later; repo is public | Free and open, and a hosted fork must publish its changes | Relicensing needs every contributor's consent, so decide before outside PRs land |
| 2 | Hosting | Cloudflare Pages project `spidex-app` (https://spidex-app.pages.dev) on the lehanh.bk.mt1002 account | `spidex.pages.dev` belongs to an unrelated site | Add a custom domain in Pages → Custom domains; nothing in code depends on the name |
| 3 | Old staging | `spidex-staging` (work account) left running, not deleted | It sits on another Cloudflare login | Delete it in the work dashboard; its D1 can be exported first with `wrangler d1 export spidex-admin --remote` |
| 4 | Admin data | New D1 database starts empty (schema from `migrations/`) | The old database is on the work account | Import an export of the old database if its rows matter |
| 5 | Pack media | All bundled pack media lives in R2 `spidex-packs` under `bundled/<packId>/`, not in git or the deploy | Keeps the repo small and lets CI deploy a complete site | `npm run upload:media` after changing media |
| 6 | Deploys | Deploys are manual (`npm run build && npm run deploy`) until `CLOUDFLARE_API_TOKEN` is set in GitHub; the CI deploy job skips itself without it | Creating an API token needs the dashboard | Create a token with "Cloudflare Pages: Edit", then `gh secret set CLOUDFLARE_API_TOKEN` |
| 7 | Admins | `ADMIN_EMAILS` = hanh.le@original.ventures, lehanh.bk.mt1002@gmail.com | The owner's two addresses | `wrangler pages secret put ADMIN_EMAILS --project-name spidex-app` |
| 8 | Sessions | New random `SESSION_SECRET`; sessions last 30 days; old cookies are rejected once | Fresh deployment, and expiry closes an unrevocable-session hole | Rotate the secret to sign everyone out |
| 9 | Sign-up | Registration whose sign-in WorkOS defers (e.g. email verification) creates the account but no session | Prevents claiming an admin email without proving it | — |
| 10 | Google sign-in | Not working on spidex-app until `https://spidex-app.pages.dev/auth/callback` is added as a WorkOS redirect URI; email/password works | WorkOS redirect URIs are dashboard-only | Add it in WorkOS → Redirects |
| 11 | Image licences | NoDerivatives plates removed from bird-th / butterfly-th (150 species show their family archetype); NonCommercial plates kept | ND forbids the redrawn plates even in a free app; NC is fine while the app and packs are free | Re-source those species from CC0/BY/BY-SA photos (#26) before any pack is priced |
| 12 | Paid packs | Not built; all packs are free | Owner deferred the payment model (#20) | NC content (decision 11) must be gone from any pack that gets a price |
| 13 | Butterflies of Thailand | `ventral` plate made optional | 1,087 of 1,119 species have one dorsal plate; requiring ventral made the pack uninstallable | Make it required again once ventral plates exist |
| 14 | Community packs | Submissions are staged per submission and go live only on admin approval | Uploads previously replaced live files before review | — |
| 15 | Preview deploys | `deploy:preview` removed | Preview deployments share the production D1 and R2 bindings, so approving a pack on preview would publish it to production | Add `[env.preview]` bindings with their own D1/R2 before bringing previews back |
| 16 | Media cost | Bundled media is served by a Function from R2 behind the edge cache; the service worker keeps downloaded media on the device | No custom domain yet for a public R2 bucket | On the Workers Free plan (100k requests/day) roughly 50–100 full pack downloads a day is the ceiling; move media to an R2 custom domain or Workers Paid if traffic grows |
| 17 | Pack links | Sound `sourceUrl`/`licenseUrl` must be http(s), in the app schema, the submission check and at render | Community packs are author data rendered as links | — |
| 18 | Master plan | The 2026-09-07 master plan (`plans/260907-1034-spidex-offline-field-guide/`, local) is the scope reference; gaps were audited against it | It was the last agreed scope | Re-audit after each phase lands |
| 19 | Backend | Pages Functions + D1 + R2 instead of the plan's Go/Node + Postgres; routes under `/api/*` instead of `/v1/*`; one R2 bucket with prefixes (`bundled/`, `overrides/`, `submissions/`, `user-photos/`) instead of three buckets | One free-tier platform, already in production | Split buckets if access policies diverge |
| 20 | Admin image edits | Media edits to bundled packs live in R2 `overrides/<id>/` with pack version +1; a deploy that ships a pack.json version at or above the override supersedes it | Edits work without a code deploy, and a later content release is never shadowed by an old edit | Delete `overrides/<id>/` to drop an edit early |
| 21 | Sync | Foreground only (sign-in, back online, app focus, "Sync now"); conflicts never overwrite, the user picks a side | iOS has no background sync; losing a field note is worse than asking | — |
| 22 | Credits | Ledger is live and metered (10,000 welcome credits, 5 per synced photo) but `CREDITS_ENFORCED` is off, so nothing is ever blocked | Collect real usage before choosing a revenue model (#20) | Set `CREDITS_ENFORCED=1` on the Pages project to start charging |
| 23 | Navigation | Three tabs (Explore, Identify, Sightings) plus a drawer, instead of the plan's four tabs with "More" | Matches the field-native redesign already shipped | — |
| 24 | Content process | The plan's expert review, 10-species pilot and image-bitrate bake-off are not done; packs ship from the iNaturalist/xeno-canto pipeline with licence filtering | These need a human expert; code cannot replace them | Engage an expert before marketing species accuracy |
| 25 | Account linking | No "link another sign-in method" UI; WorkOS matches accounts by verified email | Rare need at launch | Add when users ask |
| 26 | Cloudflare plan | Everything is sized for the Workers Free plan: sync batches of 12 records (≤39 D1 queries per request, tested), admin pack list under 50 subrequests | Free is the current plan and the per-request limit is hard | Raise `MAX_BATCH`/`PUSH_BATCH` together on Workers Paid |
| 27 | Sync conflicts | A delete beats a stale edit from another device; a sighting only comes back by an explicit "Keep mine", and photos are never dropped while their sighting is unresolved | Never lose a field note silently, never resurrect without asking | — |
| 28 | Media files | Media is immutable: replacing an image writes a new content-hashed filename, so phones fetch only changed images on a pack update; bundled media must be renamed when its bytes change (`upload:media` refuses otherwise) | A version bump must not re-download a whole pack on the Free plan | `--force` overwrites, but phones that cached the old bytes keep them |
| 29 | Merging | `master` requires the CI `build` check (admins included) | A PR was merged red once | Settings → Branches |
| 30 | Dev pack media | `npm run dev` fetches bundled pack media missing from the checkout from the live site (`SPIDEX_MEDIA_ORIGIN`, default https://spidex-app.pages.dev); the two fixture packs ship in git and work offline | A fresh clone must be able to install a real pack without bucket credentials | Each full-pack install in dev sends ~1–2k requests through the production Function, counted toward the Free plan's 100k/day (see 16, 26); set `SPIDEX_MEDIA_ORIGIN=off` to stop it, or point it at a public R2 domain once one exists |

## Code review

A full review of the rollout changes is in
`plans/reports/code-reviewer-261003-0800-rollout-review.md` (local). No P1
issues; the P2s were fixed (link scheme, withdraw admin check) or recorded
above (15, 16). Known P3s left for later: a failed contribute upload needs a
manual withdraw before retrying; approving a new community pack version
deletes the old files at once. Media is immutable: clients refetch only URLs
they do not hold, so changed bytes must ship under a new filename (admin
replaces do this automatically; `upload:media` refuses to overwrite).
