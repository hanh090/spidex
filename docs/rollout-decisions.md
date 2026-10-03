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

## Code review

A full review of the rollout changes is in
`plans/reports/code-reviewer-261003-0800-rollout-review.md` (local). No P1
issues; the P2s were fixed (link scheme, withdraw admin check) or recorded
above (15, 16). Known P3s left for later: a failed contribute upload needs a
manual withdraw before retrying; approving a new community pack version
deletes the old files at once; media changed under an unchanged filename is
not refetched by clients that cached it.
