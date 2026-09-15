---
name: spidex:specimen-plate
description: "Transform wildlife observation photos (birds, butterflies, dragonflies, insects, plants) into masterwork 19th-century scientific specimen plates on a pure white shadowless background using MAI-Image-2.6 Flash via OpenRouter (Gemini 2.5 Flash Image selectable). Standardizes 1024x1024 square aspect ratio, enforces 75%-85% prominent subject framing with zero squashing, renders anatomical venation with maximum clarity, strictly eliminates drop shadows and all background, runs integrity audits, and compiles production packs."
user-invocable: true
when_to_use: "Use when converting wildlife photos (birds, butterflies, dragonflies/damselflies, plants) to scientific specimen drawings, field guide illustrations, auditing plate aspect ratios and shadows, or compiling natural history packs."
category: ai-ml
keywords: [specimen, plate, botanical, zoological, mai-image, openrouter, gemini, butterfly, bird, dragonfly, damselfly, odonata, shadowless, venation, white-background, natural-history, museum]
argument-hint: "[--taxon bird|butterfly|dragonfly|damselfly|plant] [--input image.jpg] [--name 'Species Name'] [--backend mai|gemini] [--audit] [--batch N]"
metadata:
  author: spidex
  version: 1.3.0
---

# Scientific Specimen Plate Generator (`spidex:specimen-plate`)

A production-grade pipeline for converting real-world wildlife observation photographs into masterwork 19th-century botanical and zoological field guide specimen plates (Audubon / natural history illustration aesthetic).

**Default backend: `microsoft/mai-image-2.6-flash` via the OpenRouter image API** (~$0.022/plate, ~21s).
Chosen after a four-model bake-off: it held pure white backgrounds and clear venation at roughly
one-sixth the cost of GPT-5 Image or Nano Banana Pro. Pass `--backend gemini` for the original
Gemini 2.5 Flash Image path, or `--model microsoft/mai-image-2.6` for the 2x-cost precision tier.

---

## Key Aesthetic & Architectural Principles

1. **Pure White, Shadowless, Backgroundless**:
   - Strictly **NO drop shadow, NO cast shadow, NO ground shadow, NO contact shadow, NO ambient occlusion, NO dark halo, NO soft grey edge**.
   - The specimen sits on a completely flat pure white field (luminance 255/255). There is **no background at all** — no scene, habitat, foliage, branch, perch, prop, paper texture, vignette, gradient, or tint. Every non-specimen pixel is the same pure white.
   - Strictly **NO text, NO numbers, NO letters, NO Latin species names, NO hex color codes, NO hashtags, NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, NO mounting pins, NO frames, NO borders**.

2. **Aspect Ratio Preservation & Zero Distortion**:
   - Raw observation photos often have arbitrary dimensions (e.g. 9:16 vertical smartphone photos or 3:2 landscape).
   - Passing raw non-square photos directly to Gemini causes anisotropic resizing that squashes specimens into wide pancakes or squishes vertical height.
   - **Pre-padding**: Every input photo is pre-padded onto a clean square canvas (`max(W, H)`) using pure white `(255, 255, 255)` before reaching Gemini, guaranteeing a native 1:1 square output.
   - **Post-processing**: Never use anisotropic `.resize((1024, 1024))`. Always scale with `im.thumbnail((1024, 1024), LANCZOS)` and center onto a 1024x1024 pure white canvas.

3. **Prominent Subject Sizing (No Shrunk Specimens)**:
   - Butterfly wingspan spans **80% to 85%** of the canvas width, with generous, symmetrical wing display.
   - Birds occupy **75% to 85%** of the canvas in clean lateral profile, avoiding oversized empty margins.
   - Dragonflies and damselflies span **80% to 85%** of the canvas, dorsal view, all four wings spread flat.

4. **Per-Taxon Anatomy**:
   - Each taxon gets its own prompt branch; do not reuse another taxon's wording. Odonata in particular must never inherit the Lepidoptera prompt — their wings are bare transparent membrane with a dense reticulate vein lattice, nodus and pterostigma, not scaled wings with branching veins.
   - `--taxon dragonfly` and `--taxon damselfly` differ: damselflies get widely separated eyes and fore/hindwings of equal shape; dragonflies get eyes meeting on top of the head and a broader hindwing base.

---

## Quick Start CLI

```bash
# Generate a single butterfly plate from an observation photo
python3 scripts/generate_specimen_plate.py \
  --input photos/troides_helena.jpg \
  --taxon butterfly \
  --sci-name "Troides helena" \
  --common-en "Common Birdwing" \
  --output plates/troides_helena_plate.jpg

# Generate a single bird plate
python3 scripts/generate_specimen_plate.py \
  --input photos/pycnonotus_jocosus.jpg \
  --taxon bird \
  --sci-name "Pycnonotus jocosus" \
  --common-en "Red-whiskered Bulbul" \
  --output plates/pycnonotus_jocosus_plate.jpg

# Generate with the precision tier instead of Flash (2x cost)
python3 scripts/generate_specimen_plate.py \
  --input photos/troides_helena.jpg \
  --taxon butterfly \
  --sci-name "Troides helena" \
  --model microsoft/mai-image-2.6 \
  --output plates/troides_helena_plate.jpg

# Fall back to the Gemini backend
python3 scripts/generate_specimen_plate.py \
  --input photos/troides_helena.jpg \
  --taxon butterfly \
  --sci-name "Troides helena" \
  --backend gemini \
  --output plates/troides_helena_plate.jpg

# Run automated integrity audit on a folder of plates
python3 scripts/audit_specimen_plates.py --dir public/museum_specimens
```

---

## Prompt Engineering Guide

### Butterfly Specimen Prompt Template
```text
A masterwork scientific natural history field guide specimen plate of the {common_en} butterfly ({sci_name} / {common_vi}). 
Centered dorsal view with symmetrical fully spread open wings displaying complete anatomical wing venation and intricate scale patterns. 
Render the wing venation with maximum clarity: every vein must be sharply and continuously drawn in crisp dark fine ink from the wing base to the outer margin, anatomically correct, unbroken, and clearly visible against the wing scales including across dark and heavily pigmented areas. Show the full branching vein structure of both forewing and hindwing, including the discal cell and every radial, medial, cubital and anal vein, plus the fine cross-veins. Veins must read as distinct drawn lines, never blurred, faded, or hidden by colour. 
Distinctive markings: {field_marks}. 
Large, prominent specimen occupying 80% to 85% of the frame with generous natural wingspan, centered on a pure solid flat blank white background. 
Drawn in authentic 19th-century scientific watercolor and fine ink illustration aesthetic with crisp lines and vivid natural colors. 
Accurate biological proportions faithfully derived from the reference photograph. 
CRITICAL REQUIREMENT: Strictly NO shadow, NO drop shadow, NO cast shadow, NO ground shadow, NO contact shadow, NO ambient occlusion, NO dark halo, NO soft grey edge beneath wings or body. The background must be pure solid flat white with no background at all: no scene, no habitat, no foliage, no branch, no perch, no props, no paper texture, no vignette, no gradient, no tint. Every pixel that is not the specimen itself must be the same pure white. Strictly NO text, NO numbers, NO letters, NO words, NO Latin species names, NO hex codes, NO hashtags, NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, NO mounting pins, NO frames, NO borders. Single centered butterfly specimen only.
```

### Dragonfly / Damselfly (Odonata) Specimen Prompt Template
```text
A masterwork scientific natural history field guide specimen plate of the {common_en} dragonfly ({sci_name} / {common_vi}).
Centered dorsal view from directly above with all four wings spread flat and held horizontally outward, fully separated and not overlapping, forewings and hindwings both clearly visible.
Slender cylindrical abdomen of ten clearly segmented divisions, broad thorax, and a large head dominated by two very large compound eyes. The eyes are large and meet or nearly meet on top of the head, and the hindwing is distinctly broader at its base than the forewing, as in true dragonflies. Six slender spined legs held beneath the thorax.
Render the wing venation with maximum clarity: all four wings are transparent and membranous, crossed by a dense reticulate lattice of fine dark veins forming many small quadrangular cells. Draw every longitudinal vein and cross-vein as a crisp unbroken dark ink line, including the nodus at the midpoint of the leading edge and the distinct opaque pterostigma cell near each wing tip. The vein network must read as sharp drawn linework across the whole wing, never blurred, faded, or simplified into a smooth wash.
Distinctive markings: {field_marks}.
Large, prominent specimen occupying 80% to 85% of the frame with generous natural wingspan, centered on a pure solid flat blank white background.
This is an odonate, not a butterfly or moth: the wings are bare transparent membrane with no scales, no powdery dust, and no butterfly wing patterning.
{STRICT_NEGATIVE_PROMPT}
```

> [!NOTE]
> `--taxon damselfly` swaps the two clauses above for widely separated eyes and fore/hindwings of equal shape and size.

### Bird Specimen Prompt Template
```text
A high quality scientific natural history field guide specimen plate of a single {common_en} bird ({sci_name}). 
Large, prominent specimen occupying 75% to 85% of the frame. Clean lateral profile view of a single bird {pose_description}, centered on a pure solid flat blank white background. 
Authentic botanical illustration aesthetic, crisp plumage feather textures, accurate natural coloration and morphology faithfully based on the reference photo, no background clutter. 
Render feather structure with maximum clarity: crisply drawn individual primary and secondary flight feathers with visible rachis and vane detail, clean separation between every wing covert row, and sharply defined tail feather shafts. Feather edges must read as distinct drawn lines, never blurred or smudged. 
CRITICAL REQUIREMENT: Strictly NO shadow, NO drop shadow, NO cast shadow, NO ground shadow, NO contact shadow, NO ambient occlusion, NO dark halo, NO soft grey edge beneath wings or body. The background must be pure solid flat white with no background at all: no scene, no habitat, no foliage, no branch, no perch, no props, no paper texture, no vignette, no gradient, no tint. Every pixel that is not the specimen itself must be the same pure white. Strictly NO text, NO numbers, NO letters, NO words, NO Latin species names, NO hex codes, NO hashtags, NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, NO mounting pins, NO frames, NO borders. Single centered bird specimen only.
```

> [!CAUTION]
> **Never include literal hex strings (e.g. `#f8f6f0`) in prompts!**
> Diffusion and multimodal models can interpret hex codes literally and render `#f860` or text strings in the margin as watermarks. Always describe the background textually (e.g. "pure solid flat blank white background").

---

## Automated Quality Audit Criteria

Every generated plate must pass the following integrity checks:

| Check | Passing Threshold | Rationale |
| :--- | :--- | :--- |
| **Resolution** | Exactly `1024×1024` | Universal square plate standard |
| **Format** | `JPEG` (RGB, quality 95) | High compression efficiency & universal rendering |
| **File Size** | `>= 50,000 bytes` | Ensures no corrupt or blank images |
| **Border Luminance** | `>= 248` (out of 255) | Guarantees shadowless pure white; flags halos, tints, or dark background bleed |
| **Coverage** | `70% - 95%` | Prevents shrunk specimens (<65%) and boundary clipping (>98%) |

---

## Gallery & Showcase Integration

In frontend showcases, configure container CSS to prevent pillarbox bars and preserve zoom inspection:
```css
/* Gallery tile for raw photo */
.raw-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

/* Gallery tile for specimen plate */
.plate-bg img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
}

/* Zoom lightbox modal */
.modal-img {
  max-width: 85vw;
  max-height: 80vh;
  object-fit: contain;
}
```
