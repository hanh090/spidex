# Authoring a species pack

Spidex is an open catalogue — any species, any region, any taxon. Anyone with
an account can publish a pack; every submission is reviewed before it goes
live in everyone's library.

## The pack format

A pack is one folder:

```
my-pack/
  pack.json        manifest — metadata + the trait schema
  species.ndjson   one species record per line
  img/             plates, thumbnails, trait referent images
  audio/           optional bundled audio (streaming URLs are preferred)
```

### pack.json

```jsonc
{
  "id": "birds-of-home",            // lowercase letters, digits, dashes — becomes /packs/<id>/
  "name": { "en": "Birds of Home", "vi": "…", "de": "…" },  // en required
  "taxonGroup": "aves",             // free text — drives nothing, describes everything
  "region": "Global",               // free text — "Peru", "SE Asia", "Worldwide"
  "version": 1,
  "license": "CC BY-SA 4.0",        // licence for the pack's compiled content
  "sources": ["eBird/Clements 2024", "…"],
  "speciesCount": 132,              // must equal the line count of species.ndjson
  "sizeBytes": { "thumb": 12000000, "full": 48000000 },
  "idRemap": [],                    // [{from, to}] for taxonomic splits between versions
  "traitSchema": {
    "traits": [ /* filter vocabulary — see an existing pack.json */ ],
    "aspects": { "required": ["default"], "optional": [] },
    "sections": []
  }
}
```

The `traitSchema` is what makes a pack work for *any* taxon: it declares the
identification traits (each with a `render`: `chip`, `swatch`, or
`referent-image`), which image aspects every species must carry, and which
extra sections species detail renders. Nothing in the app knows what a bird
is — your schema does.

### species.ndjson

One JSON object per line:

```jsonc
{
  "id": "pica-pica",                       // stable, pack-scoped
  "sciName": "Pica pica",
  "commonNames": { "en": "Eurasian Magpie" },
  "family": "Corvidae",
  "traits": { "size": "crow", "colour": ["black", "white"] },
  "keyFeatures": [{ "en": "…" }],
  "months": [1,2,3,4,5,6,7,8,9,10,11,12],
  "sensitivity": 0,                        // 0–3, GBIF sensitive-species scale
  "images": [{
    "id": "img-1", "aspect": "default",
    "thumbUrl": "img/pica-pica.webp",      // pack-relative
    "credit": "Jane Doe",                  // required
    "license": "CC BY-SA 4.0"              // required — no attribution, no pack
  }],
  "sounds": [{
    "id": "xc123", "url": "https://…/123/download",
    "credit": "J. Doe", "license": "CC BY-NC-SA 4.0",
    "type": "song", "source": "xeno-canto",
    "sourceUrl": "https://xeno-canto.org/123",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/"
  }]
}
```

Hard rules, enforced at validation and again at download:

- every image and every sound carries `credit` + `license`
- every species declares `sensitivity` (0–3)
- `images` is non-empty; `thumbUrl` paths must exist in the folder
- English (`en`) is required for localized fields; `de`/`vi` are optional

## Validate before you upload

```bash
npx vite-node scripts/validate-pack.ts path/to/my-pack
```

This runs the exact schema the app enforces — manifest, every species record,
required aspects, and that every referenced file exists.

## Publish

1. Sign in → Library → **Publish a pack** (or `/contribute`).
2. Pick the pack folder. The app validates it before anything uploads.
3. Upload, add a note for reviewers, submit. Files go to object storage and
   are **not public** while in review.
4. An admin approves → the pack appears in every user's catalogue and is
   downloadable like any bundled pack. Rejections delete the upload.

Limits: ≤ 8,000 files, ≤ 600 MB total, ≤ 3 open submissions per account.
Allowed files: `pack.json`, `species.ndjson`, and media under `img/`,
`audio/`, `fonts/` — no scripts or HTML can be served from a pack, and all
community files are delivered with `script-src 'none'` regardless.

## Updating a published pack

Bump `version`, re-upload through the same flow with the same `id`, and note
what changed. `idRemap` entries keep users' sightings attached across
taxonomic renames.
