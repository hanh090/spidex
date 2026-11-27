# Species-content source and rights matrix (2026-11-27)

This matrix records what was actually reusable for the audited preview packs. It separates **structured facts** (names, measurements, month presence, hostplant associations) from copyrighted expression (descriptive prose, photographs and artwork). A permissive data licence does not license a source book's prose or plates, and a downloadable image is not evidence of derivative rights.

## Adopted in this branch

| Source | Rights verified | Reuse here | Attribution / redistribution / derivatives | Main limits |
| --- | --- | --- | --- | --- |
| [LepTraits 1.0](https://doi.org/10.6084/m9.figshare.19874602.v1), Shirey et al. 2022 | Figshare metadata: **CC0 1.0** | Exact scientific-name matches. Wingspan ranges, controlled habitat-affinity categories, hostplant families; exact record rows for regional month presence. | Public-domain dedication. Redistribution and derivatives are permitted; the dataset and paper are still cited. | Consensus rows are global, not proof of Thailand/Vietnam seasonal timing. Month rows are sparse and many records omit names. Voltinism codes and prose field-guide content are not copied. |
| [HOSTS — a Database of the World's Lepidopteran Hostplants](https://data.nhm.ac.uk/dataset/hosts), Natural History Museum 2023 | Dataset page/metadata: **CC0 1.0** | Exact insect-binomial matches for caterpillar hostplant names. Rows marked `Lab Rearing` are excluded. | Public-domain dedication. Redistribution and derivatives are permitted; citation retained. | Archival dataset, no longer updated; plant taxonomy and old literature records need review. Exact-name matching misses synonyms. It is not adult nectar/feeding data. |
| [AVONET](https://doi.org/10.6084/m9.figshare.16586228.v7), Tobias et al. 2022 | Figshare metadata and paper: **CC BY 4.0** | Exact BirdLife scientific-name matches for species-average mass/wing/culmen, habitat, habitat density and migration category. | Attribution required and present in pack provenance/manifests. Derivatives and redistribution are permitted. | BirdLife taxonomy does not match every checklist name. Measurements are species averages, not visual field marks. Migration category is not a Thailand month calendar. |
| [GBIF Backbone](https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c) | Dataset: **CC BY 4.0** | Already used only for the committed strict family-match snapshot. | Attribution and usage keys retained. | Backbone matching is taxonomic interpretation, not expert validation. Occurrence data are separately licensed and are not used here for seasonality. |

## Investigated but not adopted as content sources

| Source | Rights position | Why not used now |
| --- | --- | --- |
| GBIF occurrence records | Individual datasets are CC0, CC BY or CC BY-NC and carry dataset-specific citations; images can be more restricted. | Country/month histograms would need dataset-by-dataset licence aggregation, DOI citation tracking and filtering of observation bias. That is a separate analysis pipeline, not a safe blanket source. |
| iNaturalist observations and photos | Research-grade observation data may be reusable under stated terms, but **photo rights are per uploader/photo** and commonly CC BY-NC, CC BY-ND or all-rights-reserved. | Existing plate provenance already shows large NC/ND/unrecorded exposure. A photo can support redrawn art only when its actual licence permits the intended derivative and use. No mass plate remediation was attempted. |
| EOL TraitBank | EOL aggregates partner data with different partner-level licences and attribution requirements; bulk archives are very large. | Redundant with LepTraits/HOSTS/AVONET for the highest-value facts, and per-record provenance would require substantial cleaning. |
| GloBI interactions | GloBI states open reuse, but each interaction still needs its original dataset citation and many rows are noisy OCR/EOL/Wikipedia duplicates. | `eats` mixes larval hostplants with adult food; `hasHost` is closer but noisy. Useful as a gap filler only after dedupe and validation, not as the primary hostplant source. |
| Wikidata | Structured data are CC0. | Coverage and references for these regional species are sparse/inconsistent; did not justify another low-confidence merge path. |
| Wikipedia/Wikimedia text | Article prose is generally CC BY-SA; images are individually licensed. | Copying or close paraphrase would impose attribution/share-alike obligations and is not the desired original guide voice. No prose was copied. |
| Wikimedia Commons images | Individual files may be freely licensed, but licence, author, source and species identification are file-specific. | A plate pipeline still needs image-by-image rights capture, species verification, derivatives review, generation cost and R2 upload. Not attempted without a curation decision. |
| Biodiversity Heritage Library scans/OCR | Metadata may be open; page scans and OCR have jurisdiction/work-specific rights, and old books often mix public-domain and later material. | Plate extraction requires bibliographic rights review and manual taxonomic mapping, not just downloading scans. |
| IUCN Red List | Terms restrict redistribution/derivative reuse; API data are not a general open-content licence. | Not reusable as a bulk content source. Use public links/citations where needed instead. |
| BirdLife Data Zone, HBW/Birds of the World, eBird/Avibase species accounts | Copyrighted species accounts/media; broad redistribution and derivative rights were not established. | Not reusable for pack prose or traits without permission/licence. They remain expert references, not ingestible content sources. |
| xeno-canto | Individual recordings have their own Creative Commons terms. | Existing audio integration is separate from field-content remediation; no new use was needed. |

## Fact coverage after `species-content-2026-11-27`

Counts are exact rows in the working tree. “Key features” here means sourced measurements/wingspan, **not visual diagnostic markings**.

| Pack | Rows | Key features | Habitat | Filter trait values | Month rows | Hostplant rows | Remaining major blockers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `bird-th` | 1,493 | 1,221 (81.8%) | 1,221 (81.8%) | 0 | 0 | n/a | No visual field-mark source; no verified seasonal month source; 272 exact-name AVONET misses; plate rights unresolved. |
| `butterfly-th` | 1,119 | 926 (82.8%) | 609 (54.4%) | 923 (82.5%) | 59 (5.3%) | 655 (58.5%) | Visual pattern/colour traits absent; regional phenology extraction sparse; synonyms/taxonomic mismatches; plates unresolved. |
| `butterfly-vn` | 1,429 | 770 (53.9%) | 753 (52.7%) | 769 (53.8%) | 69 (4.8%) | 764 (53.5%) | Same butterfly blockers; Vietnam direct literature extraction especially sparse; every plate remains an archetype. |

Across the 1,919 unique butterfly species in the two packs, exact-name LepTraits data cover 1,467 (76.4%) and non-lab HOSTS rows cover 700 (36.5%); only 93 have extractable exact-name regional month rows. These numbers are coverage, not editorial completeness.

## Plate remediation blockers, quantified

| Pack | Archetype images | Other displayed images | Rows flagged placeholder | Dominant rights problem |
| --- | ---: | ---: | ---: | --- |
| `bird-th` | 1,390 | 103 | 1,408 | 558 unrecorded references; 450 CC BY-NC; 248 all-rights-reserved; 97 ND/NC-ND rows. |
| `butterfly-th` | 941 | 178 | 946 | 578 CC BY-NC; 151 all-rights-reserved; 105 unrecorded; 53 ND/NC-ND rows. |
| `butterfly-vn` | 1,429 | 0 | 1,429 | Reference rights were never recorded; local JPG files do not establish reuse rights. |

A viable plate programme requires (1) a source image whose actual licence permits derivative illustration and the intended distribution, (2) author/source/licence captured per file, (3) species-level identification review, (4) plate generation/manual correction, and (5) media upload/deployment. Wikimedia Commons or suitably licensed iNaturalist photos are candidate inputs, but coverage must be measured after those filters. Mass generation from NC/ND/all-rights-reserved/unrecorded references is not defensible.

## What expert or permission input is still required

- A regional taxonomist/editor must review synonym mapping before exact-name misses are filled through alternate taxonomies.
- A Thailand bird field-guide author/editor or a truly open species-account dataset is needed for visual diagnostic marks, vocalisation text and local seasonal occurrence. AVONET does not supply those.
- A regional lepidopterist/editor must review visual wing-pattern traits, validate hostplants for local relevance, and interpret sparse/incomplete LepTraits record extraction for Vietnam and Thailand seasonality.
- A rights holder or explicitly licensed replacement image is required for each restricted/untraceable plate. Expert review is still needed even when the licence is valid.
- The adjacent `bird-vn` pack still contains legacy generated-looking accounts and is outside this three-pack migration; it needs the same audit before release claims are trusted.
