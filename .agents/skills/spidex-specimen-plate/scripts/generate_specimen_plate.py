#!/usr/bin/env python3
"""
Scientific Specimen Plate Generator CLI
Part of spidex:specimen-plate skill.
Converts any wildlife observation photo into a 1024x1024 shadowless museum plate.

Default backend is MAI-Image-2.6 Flash via OpenRouter; Gemini 2.5 Flash Image
remains selectable with --backend gemini.
"""
import os
import sys
import json
import base64
import time
import argparse
import urllib.request
from PIL import Image
import io
import numpy as np

# Default production backend. MAI-Image-2.6 Flash is served only by OpenRouter's
# image API; swap to "microsoft/mai-image-2.6" for the 2x-cost precision tier.
MAI_MODEL = "microsoft/mai-image-2.6-flash"

# OpenAI direct (not OpenRouter). Chosen for accuracy: gpt-image-2 was the only
# model to render every diagnostic field mark across butterflies, birds and
# dragonflies in the bake-off.
OPENAI_MODEL = "gpt-image-2"

# Key file locations checked after $OPENAI_API_KEY. Keep keys out of the repo.
OPENAI_KEY_FILES = [
    os.path.expanduser("~/.config/spidex/openai_key"),
]

# Per-taxon model routing. Odonata morphology is stereotyped enough that the
# cheaper Krea tier reproduces it accurately, but the same model drops
# diagnostic field marks on Lepidoptera and Aves (missing hindwing patches,
# wrong plumage), so those stay on MAI. Measured, not assumed - see SKILL.md.
TAXON_MODELS = {
    "dragonfly": "krea/krea-2-medium-turbo",
    "damselfly": "krea/krea-2-medium-turbo",
    "odonata": "krea/krea-2-medium-turbo",
    "odonate": "krea/krea-2-medium-turbo",
}


def model_for_taxon(taxon):
    return TAXON_MODELS.get(taxon.lower(), MAI_MODEL)

ENV_CANDIDATES = [
    "/Users/hanhle/projects/gabo/flexlane-api/.env.dev",
    "/Users/hanhle/projects/personal-stuff/vinanonwoven/.claude/.env",
    "/Users/hanhle/projects/gabo/flexlane-api-main/.env.dev",
]


def get_gemini_key():
    for p in ENV_CANDIDATES:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("GEMINI_API_KEY="):
                        return line.split("=", 1)[1].strip().strip("\"'")
    return os.environ.get("GEMINI_API_KEY")

STRICT_NEGATIVE_PROMPT = (
    "CRITICAL REQUIREMENT: Strictly NO shadow, NO drop shadow, NO cast shadow, NO ground shadow, "
    "NO contact shadow, NO ambient occlusion, NO dark halo, NO soft grey edge beneath wings or body. "
    "The background must be pure solid flat white with no background at all: no scene, no habitat, "
    "no foliage, no branch, no perch, no props, no paper texture, no vignette, no gradient, no tint. "
    "Every pixel that is not the specimen itself must be the same pure white. "
    "Strictly NO text, NO numbers, NO letters, NO words, NO Latin species names, NO hex codes, NO hashtags, "
    "NO captions, NO specimen numbers, NO label boxes, NO scale bars, NO rulers, "
    "NO mounting pins, NO frames, NO borders. Single centered specimen only."
)

# Venation is the primary identification feature on a field guide plate, so it
# gets its own emphasis block rather than a clause buried in the pose sentence.
BUTTERFLY_VENATION_PROMPT = (
    "Render the wing venation with maximum clarity: every vein must be sharply and continuously "
    "drawn in crisp dark fine ink from the wing base to the outer margin, anatomically correct, "
    "unbroken, and clearly visible against the wing scales including across dark and heavily "
    "pigmented areas. Show the full branching vein structure of both forewing and hindwing, "
    "including the discal cell and every radial, medial, cubital and anal vein, plus the fine "
    "cross-veins. Veins must read as distinct drawn lines, never blurred, faded, or hidden by colour."
)

BIRD_FEATHER_PROMPT = (
    "Render feather structure with maximum clarity: crisply drawn individual primary and secondary "
    "flight feathers with visible rachis and vane detail, clean separation between every wing covert "
    "row, and sharply defined tail feather shafts. Feather edges must read as distinct drawn lines, "
    "never blurred or smudged."
)

# Odonata venation is a dense reticulate net, not the branching Lepidoptera
# pattern, so it needs its own emphasis block rather than reusing the butterfly one.
ODONATE_VENATION_PROMPT = (
    "Render the wing venation with maximum clarity: all four wings are transparent and membranous, "
    "crossed by a dense reticulate lattice of fine dark veins forming many small quadrangular cells. "
    "Draw every longitudinal vein and cross-vein as a crisp unbroken dark ink line, including the "
    "nodus at the midpoint of the leading edge and the distinct opaque pterostigma cell near each "
    "wing tip. The vein network must read as sharp drawn linework across the whole wing, never "
    "blurred, faded, or simplified into a smooth wash."
)


def build_prompt(taxon, sci_name, common_en, common_vi="", field_marks=""):
    if taxon.lower() in ["dragonfly", "damselfly", "odonata", "odonate"]:
        damsel = taxon.lower() == "damselfly"
        wing_pose = (
            "all four wings spread flat and held horizontally outward, fully separated and not "
            "overlapping, forewings and hindwings both clearly visible"
        )
        body_note = (
            "Slender cylindrical abdomen of ten clearly segmented divisions, broad thorax, and a large "
            "head dominated by two very large compound eyes"
            + (
                ". The eyes are widely separated on the sides of the head and the hindwing is the same "
                "shape and size as the forewing, as in damselflies"
                if damsel
                else
                ". The eyes are large and meet or nearly meet on top of the head, and the hindwing is "
                "distinctly broader at its base than the forewing, as in true dragonflies"
            )
        )
        return (
            f"A masterwork scientific natural history field guide specimen plate of the {common_en} "
            f"{'damselfly' if damsel else 'dragonfly'} ({sci_name}"
            + (f" / {common_vi}" if common_vi else "") + "). "
            f"Centered dorsal view from directly above with {wing_pose}. "
            f"{body_note}. Six slender spined legs held beneath the thorax. "
            f"{ODONATE_VENATION_PROMPT} "
            + (f"Distinctive markings: {field_marks}. " if field_marks else "") +
            f"Large, prominent specimen occupying 80% to 85% of the frame with generous natural wingspan, "
            f"centered on a pure solid flat blank white background. "
            f"Drawn in authentic 19th-century scientific watercolor and fine ink illustration aesthetic "
            f"with crisp lines and vivid natural colors. "
            f"Accurate biological proportions faithfully derived from the reference photograph. "
            f"This is an odonate, not a butterfly or moth: the wings are bare transparent membrane with "
            f"no scales, no powdery dust, and no butterfly wing patterning. "
            f"{STRICT_NEGATIVE_PROMPT}"
        )
    elif taxon.lower() in ["butterfly", "moth", "insect", "lepidoptera"]:
        return (
            f"A masterwork scientific natural history field guide specimen plate of the {common_en} butterfly ({sci_name}"
            + (f" / {common_vi}" if common_vi else "") + "). "
            f"Centered dorsal view with symmetrical fully spread open wings displaying complete anatomical wing venation and intricate scale patterns. "
            f"{BUTTERFLY_VENATION_PROMPT} "
            + (f"Distinctive markings: {field_marks}. " if field_marks else "") +
            f"Large, prominent specimen occupying 80% to 85% of the frame with generous natural wingspan, centered on a pure solid flat blank white background. "
            f"Drawn in authentic 19th-century scientific watercolor and fine ink illustration aesthetic with crisp lines and vivid natural colors. "
            f"Accurate biological proportions faithfully derived from the reference photograph. "
            f"{STRICT_NEGATIVE_PROMPT}"
        )
    elif taxon.lower() in ["bird", "aves"]:
        return (
            f"A high quality scientific natural history field guide specimen plate of a single {common_en} bird ({sci_name}"
            + (f" / {common_vi}" if common_vi else "") + "). "
            f"Large, prominent specimen occupying 75% to 85% of the frame. Clean lateral profile view of a single bird, centered on a pure solid flat blank white background. "
            f"Authentic botanical illustration aesthetic, crisp plumage feather textures, accurate natural coloration and morphology faithfully based on the reference photo, no background clutter. "
            f"{BIRD_FEATHER_PROMPT} "
            f"{STRICT_NEGATIVE_PROMPT}"
        )
    else:
        return (
            f"A masterwork scientific natural history botanical illustration specimen plate of {common_en} ({sci_name}). "
            f"Large, prominent specimen occupying 80% to 85% of the frame, centered on a pure solid flat blank white background. "
            f"Authentic 19th-century scientific watercolor and fine ink aesthetic with crisp botanical details and natural colors. "
            f"Render leaf and petal venation with maximum clarity: every vein and fine cross-vein sharply "
            f"drawn in crisp dark ink, unbroken from base to margin, clearly visible against the surface colour. "
            f"{STRICT_NEGATIVE_PROMPT}"
        )

def prepare_square_b64(raw_img_path):
    with Image.open(raw_img_path) as im:
        if im.mode != "RGB":
            im = im.convert("RGB")
        w, h = im.size
        if w == h:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=95)
            return base64.b64encode(buf.getvalue()).decode("utf-8")
        
        side = max(w, h)
        # Pad with pure white so the reference image never suggests a background tint
        canvas = Image.new("RGB", (side, side), (255, 255, 255))
        canvas.paste(im, ((side - w) // 2, (side - h) // 2))
        resample = getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        canvas.thumbnail((1024, 1024), resample)
        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=95)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

def call_gemini(key, prompt, raw_img_path):
    b64_img = prepare_square_b64(raw_img_path)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": b64_img
                        }
                    }
                ]
            }
        ]
    }
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    
    parts = res.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    for p in parts:
        if "inlineData" in p:
            return base64.b64decode(p["inlineData"]["data"])
    return None

def get_openai_key():
    """Resolve an OpenAI API key. Env wins so a key never has to live in the repo."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key.startswith("sk-") and not key.startswith("sk-or-"):
        return key
    for p in OPENAI_KEY_FILES:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                val = f.read().strip()
            if val.startswith("sk-") and not val.startswith("sk-or-"):
                return val
    for p in ENV_CANDIDATES:
        if not os.path.exists(p):
            continue
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("OPENAI_API_KEY=") and "sk-or-" not in line:
                    val = line.split("=", 1)[1].strip().strip("\"'")
                    if val.startswith("sk-"):
                        return val
    return None


def _multipart(fields, files):
    """Build a multipart/form-data body; the OpenAI images edit route needs it."""
    boundary = "----spidexplate" + base64.b16encode(os.urandom(8)).decode()
    out = b""
    for k, v in fields.items():
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").encode()
    for k, (fname, blob, ctype) in files.items():
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; "
                f"filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n").encode()
        out += blob + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return out, f"multipart/form-data; boundary={boundary}"


def call_openai(key, prompt, raw_img_path, model=OPENAI_MODEL, size="1024x1024"):
    """Generate through OpenAI's image edit route, conditioned on the reference photo."""
    square = base64.b64decode(prepare_square_b64(raw_img_path))
    body, ctype = _multipart(
        {"model": model, "prompt": prompt, "n": "1", "size": size},
        {"image": ("reference.jpg", square, "image/jpeg")},
    )
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/edits",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": ctype},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    entries = res.get("data") or []
    b64_payload = entries[0].get("b64_json") if entries else None
    usage = res.get("usage") or {}
    if usage:
        print(f"  tokens: in={usage.get('input_tokens')} out={usage.get('output_tokens')}")
    return base64.b64decode(b64_payload) if b64_payload else None


def get_openrouter_key():
    for p in ENV_CANDIDATES:
        if not os.path.exists(p):
            continue
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                if "sk-or-v1-" in line and "=" in line:
                    val = line.strip().split("=", 1)[1].strip().strip("\"'")
                    if val:
                        return val
    return os.environ.get("OPENROUTER_API_KEY")


def call_openrouter(key, prompt, raw_img_path, model=MAI_MODEL):
    """Generate through OpenRouter's image API, which is what serves MAI-Image."""
    b64_img = prepare_square_b64(raw_img_path)
    payload = {
        "model": model,
        "prompt": prompt,
        "input_references": [
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"},
            }
        ],
        "output_format": "png",
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/images",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://spidex.io",
            "X-Title": "Spidex Field Guide",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        res = json.loads(resp.read().decode("utf-8"))

    entries = res.get("data") or []
    b64_payload = entries[0].get("b64_json") if entries else None
    if not b64_payload:
        return None
    cost = float(res.get("usage", {}).get("cost") or 0.0)
    if cost:
        print(f"  OpenRouter cost: ${cost:.4f}")
    return base64.b64decode(b64_payload)


def save_specimen_plate(raw_bytes, out_path):
    im = Image.open(io.BytesIO(raw_bytes))
    if im.mode != "RGB":
        im = im.convert("RGB")
    
    if im.size == (1024, 1024):
        final_im = im
    else:
        w, h = im.size
        corners = [
            im.getpixel((5, 5)),
            im.getpixel((w - 6, 5)),
            im.getpixel((5, h - 6)),
            im.getpixel((w - 6, h - 6))
        ]
        bg_color = (
            sum(c[0] for c in corners) // 4,
            sum(c[1] for c in corners) // 4,
            sum(c[2] for c in corners) // 4
        )
        resample = getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        im.thumbnail((1024, 1024), resample)
        final_im = Image.new("RGB", (1024, 1024), bg_color)
        final_im.paste(im, ((1024 - im.width) // 2, (1024 - im.height) // 2))
    
    # Clean bottom margin if any stray watermark occurred
    w, h = final_im.size
    corners = [
        final_im.getpixel((5, 5)),
        final_im.getpixel((w - 6, 5)),
        final_im.getpixel((5, h - 6)),
        final_im.getpixel((w - 6, h - 6))
    ]
    bg_color = (
        sum(c[0] for c in corners) // 4,
        sum(c[1] for c in corners) // 4,
        sum(c[2] for c in corners) // 4
    )
    bottom_strip = final_im.crop((0, h - 60, w, h))
    arr_bottom = np.asarray(bottom_strip, dtype=float)
    diff = np.max(np.abs(arr_bottom - bg_color), axis=2)
    if np.any(diff > 35):
        fill = Image.new("RGB", (w, 60), bg_color)
        final_im.paste(fill, (0, h - 60))

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    final_im.save(out_path, format="JPEG", quality=95)
    return out_path

def main():
    parser = argparse.ArgumentParser(description="Generate a 1024x1024 shadowless scientific specimen plate.")
    parser.add_argument("--backend", default="openai", choices=["openai", "mai", "gemini"], help="Image model backend (default: gpt-image-2 direct from OpenAI).")
    parser.add_argument("--model", default=None, help="OpenRouter model slug when --backend mai. Defaults per taxon (see TAXON_MODELS).")
    parser.add_argument("--input", required=True, help="Path to input observation photograph.")
    parser.add_argument("--output", required=True, help="Target output JPEG plate path.")
    parser.add_argument("--taxon", default="butterfly", choices=["butterfly", "bird", "dragonfly", "damselfly", "plant", "insect"], help="Taxonomic group.")
    parser.add_argument("--sci-name", default="Species name", help="Scientific Latin binomial name.")
    parser.add_argument("--common-en", default="", help="Common English name.")
    parser.add_argument("--common-vi", default="", help="Common Vietnamese name.")
    parser.add_argument("--field-marks", default="", help="Diagnostic field marks.")
    args = parser.parse_args()

    if args.backend == "openai":
        key = get_openai_key()
        args.model = args.model or OPENAI_MODEL
        backend_label = f"OpenAI {args.model}"
        key_error = "OpenAI API key not found (set OPENAI_API_KEY or ~/.config/spidex/openai_key)!"
    elif args.backend == "mai":
        key = get_openrouter_key()
        # An explicit --model always wins; otherwise route on taxon.
        args.model = args.model or model_for_taxon(args.taxon)
        backend_label = args.model
        key_error = "OpenRouter API key not found!"
    else:
        key = get_gemini_key()
        backend_label = "gemini-2.5-flash-image"
        key_error = "Gemini API key not found!"
    if not key:
        print(f"ERROR: {key_error}", file=sys.stderr)
        sys.exit(1)

    common = args.common_en or args.sci_name
    prompt = build_prompt(args.taxon, args.sci_name, common, args.common_vi, args.field_marks)
    print(f"Generating shadowless specimen plate for: {args.sci_name} ({common}) via {backend_label}...")

    t0 = time.time()
    if args.backend == "openai":
        img_bytes = call_openai(key, prompt, args.input, args.model)
    elif args.backend == "mai":
        img_bytes = call_openrouter(key, prompt, args.input, args.model)
    else:
        img_bytes = call_gemini(key, prompt, args.input)
    if not img_bytes:
        print(f"ERROR: {backend_label} returned no image bytes.", file=sys.stderr)
        sys.exit(1)

    out = save_specimen_plate(img_bytes, args.output)
    dur = time.time() - t0
    print(f"✓ Successfully generated standardized plate: {out} ({len(img_bytes)} bytes in {dur:.1f}s)")

if __name__ == "__main__":
    main()
