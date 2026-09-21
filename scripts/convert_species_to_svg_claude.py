#!/usr/bin/env python3
"""
Draw species plates as SVG through a Claude Messages endpoint.

This is the Claude-side counterpart to convert_butterflies_to_drawings.py, and it
differs from it in one way that cannot be engineered around: Claude has no image
generation. It returns text, so the plates here are SVG line drawings in the same
idiom as the archetype plates, not the 1024x1024 raster plates Gemini produces.
Treat the two as different media rather than interchangeable backends.

Raw urllib rather than the anthropic SDK, for two reasons. The SDK builds its URL
as {base_url}/v1/messages, and a gateway that serves /v1/ai/messages cannot be
expressed that way. And every other script in this directory is stdlib plus
Pillow, so a client here would be the repository's only Python dependency.

The endpoint is configurable because it is not assumed to be Anthropic's. Anything
it returns is parsed as untrusted input: the markup is validated before it reaches
public/, since these files are served to browsers.

    export SPIDEX_CLAUDE_API_KEY=...
    python3 scripts/convert_species_to_svg_claude.py --pack butterfly-vn --limit 5
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")

DEFAULT_BASE_URL = "https://claude.zunef.com/v1/ai"
DEFAULT_MODEL = "claude-opus-5"

# Edge filters in front of some gateways reject urllib's default agent string
# with a 403 before the request ever reaches the API.
USER_AGENT = "spidex-plate-drawer/1.0"

# Plate geometry and palette, matching generate_archetype_plates.py so a drawn
# plate and a fallback archetype sit in the frame identically.
VIEWBOX = "0 0 64 48"
GROUND = "#f0ebe1"
INK = "#141110"

# One archetype verbatim. A worked example pins the idiom — stroke weights, the
# mirrored-half construction, the absence of a frame — far more reliably than
# prose describing it.
STYLE_EXEMPLAR = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="256" height="192" '
    'role="img" aria-label="Lycaenid butterfly, archetype plate">'
    "<title>Lycaenid butterfly, archetype plate</title>"
    '<rect width="64" height="48" fill="#f0ebe1"/>'
    '<g transform="translate(32 24) scale(0.92) translate(-32 -28.6)">'
    '<g fill="#141110"><path d="M33 29.2 C38.2 29.8 43 32.4 45.4 36.4 C45 39.4 43.4 41.8 41 43.4 '
    'C38.4 45.2 35.2 45.8 33.6 44.8 C33.2 43.8 33 41 33 37.4 Z"/></g></g></svg>'
)

SYSTEM_PROMPT = f"""You draw scientific field-guide specimen plates as SVG for a natural history \
reference app. You reply with SVG markup and nothing else — no prose, no code fences, no commentary.

Every plate must satisfy all of the following:

GEOMETRY
- Root element: <svg xmlns="http://www.w3.org/2000/svg" viewBox="{VIEWBOX}" width="256" height="192" \
role="img" aria-label="..."> with a <title> as the first child.
- First drawn element: <rect width="64" height="48" fill="{GROUND}"/> as the ground.
- The specimen occupies 80-85% of the frame width and is centred. Nothing bleeds past the ground.

DRAWING
- Ink outline {INK}. Flat colour fills are allowed and encouraged where the species is diagnostic \
in colour — use the animal's real field colours, muted to a naturalist-plate register.
- Paths only: <path>, <circle>, <ellipse>, <g>. For a bilaterally symmetric animal, write the \
right-hand half's paths TWICE: once in a plain <g>, then again inside \
<g transform="translate(64,0) scale(-1,1)"> with byte-identical d attributes. BOTH groups must be \
present. A mirror group on its own yields a one-winged animal, which is the single most common way \
these plates come back wrong. Body, head and antennae are drawn once, on the centre line.
- Dorsal view, wings spread, for butterflies. Lateral perched view for birds.
- Anatomy readable from the silhouette alone: a swallowtail keeps its tails, a heron its neck and legs.

FORBIDDEN
- No <text>, <image>, <script>, <style>, <foreignObject>, <use>, external references, or event handlers.
- No frame, border, drop shadow, mounting pin, scale bar, label, caption, or specimen number.
- No gradients or filters. Flat fills only.

Study this archetype plate for the house idiom, then draw at higher anatomical detail than it:

{STYLE_EXEMPLAR}"""

# Elements and attributes refused outright. The endpoint is not assumed to be
# trustworthy and the output is written under public/, so this is a real gate and
# not a formality: script and event handlers execute in the browser, and the
# external-reference forms leak a viewer's IP to whoever the markup names.
BANNED_TAGS = {"script", "image", "style", "foreignObject", "use", "text", "iframe",
               "animate", "set", "handler", "audio", "video", "filter",
               "linearGradient", "radialGradient", "pattern"}
SVG_NS = "http://www.w3.org/2000/svg"


def load_api_key():
    """Resolve the key from the environment, then from an untracked .env."""
    for var in ("SPIDEX_CLAUDE_API_KEY", "CLAUDE_PROXY_API_KEY", "ANTHROPIC_API_KEY"):
        val = os.environ.get(var)
        if val:
            return val.strip()
    env_file = os.path.join(PROJECT_ROOT, ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as fh:
            for line in fh:
                if line.strip().startswith("SPIDEX_CLAUDE_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    return None


def strip_ns(tag):
    return tag.split("}", 1)[1] if "}" in tag else tag


def validate_svg(markup):
    """Parse and vet returned markup. Raises ValueError; returns the clean string."""
    markup = markup.strip()
    # Models wrap markup in fences despite instruction; tolerate that much.
    fence = re.match(r"^```(?:svg|xml|html)?\s*(.*?)\s*```$", markup, re.DOTALL)
    if fence:
        markup = fence.group(1).strip()
    start = markup.find("<svg")
    if start == -1:
        raise ValueError("no <svg> element in response")
    markup = markup[start:]
    end = markup.rfind("</svg>")
    if end == -1:
        raise ValueError("unterminated <svg> element")
    markup = markup[: end + len("</svg>")]

    try:
        root = ET.fromstring(markup)
    except ET.ParseError as exc:
        raise ValueError(f"malformed XML: {exc}") from exc

    if strip_ns(root.tag) != "svg":
        raise ValueError(f"root element is <{strip_ns(root.tag)}>, expected <svg>")
    if root.get("viewBox") != VIEWBOX:
        raise ValueError(f"viewBox is {root.get('viewBox')!r}, expected {VIEWBOX!r}")

    for el in root.iter():
        name = strip_ns(el.tag)
        if name in BANNED_TAGS:
            raise ValueError(f"forbidden element <{name}>")
        for attr, value in el.attrib.items():
            attr_name = strip_ns(attr).lower()
            if attr_name.startswith("on"):
                raise ValueError(f"event handler attribute {attr_name!r}")
            if attr_name in ("href", "xlink:href") or attr_name.endswith("href"):
                raise ValueError(f"external reference via {attr_name!r}")
            if "url(" in value.lower() or "javascript:" in value.lower():
                raise ValueError(f"external or script reference in {attr_name!r}")

    if not (200 <= len(markup) <= 60000):
        raise ValueError(f"implausible plate size: {len(markup)} bytes")
    check_mirror_symmetry(root)
    return markup


def check_mirror_symmetry(root):
    """Reject a half-drawn animal.

    A mirrored group is only half a specimen: the same path data has to appear
    outside it too, or the rendered animal has wings down one side only. Models
    read "draw one side and mirror it" as replacing the original often enough
    that this needs to be enforced rather than requested.
    """
    mirrored, plain = set(), set()

    def walk(node, inside_mirror):
        for child in node:
            transform = child.get("transform", "")
            is_mirror = inside_mirror or "scale(-1" in transform.replace(" ", "")
            if strip_ns(child.tag) == "path" and child.get("d"):
                (mirrored if is_mirror else plain).add(" ".join(child.get("d").split()))
            walk(child, is_mirror)

    walk(root, False)
    if mirrored and not (mirrored & plain):
        raise ValueError(
            "mirrored group has no un-mirrored counterpart — specimen is drawn on one side only"
        )


def build_prompt(species):
    """Compose the per-species drawing brief from the pack record."""
    sci = species.get("sciName", "")
    commons = species.get("commonNames") or {}
    common_en = commons.get("en") or sci
    family = species.get("family", "")
    traits = species.get("traits") or {}
    features = species.get("keyFeatures") or {}
    feature_text = features.get("en") if isinstance(features, dict) else features
    if isinstance(feature_text, list):
        feature_text = "; ".join(str(f) for f in feature_text)

    lines = [f"Draw a specimen plate of {common_en} ({sci})."]
    if family:
        lines.append(f"Family: {family}.")
    if traits:
        rendered = ", ".join(
            f"{k}: {', '.join(v) if isinstance(v, list) else v}" for k, v in traits.items()
        )
        lines.append(f"Recorded traits: {rendered}.")
    if feature_text:
        lines.append(f"Diagnostic field marks: {feature_text}")
    lines.append(
        f'Use aria-label "{common_en}, specimen plate" and the same wording in <title>.'
    )
    lines.append("Reply with the SVG markup only.")
    return "\n".join(lines)


def call_claude(base_url, api_key, model, prompt, ref_image=None, use_thinking=True, timeout=180):
    """POST one drawing request. Returns concatenated text blocks."""
    content = []
    if ref_image:
        with open(ref_image, "rb") as fh:
            encoded = base64.b64encode(fh.read()).decode("ascii")
        media = "image/png" if ref_image.lower().endswith(".png") else "image/jpeg"
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media, "data": encoded},
        })
        prompt = (
            "Use the attached reference photograph for proportion, posture and colour.\n\n" + prompt
        )
    content.append({"type": "text", "text": prompt})

    payload = {
        "model": model,
        "max_tokens": 8000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": content}],
    }
    if use_thinking:
        payload["thinking"] = {"type": "adaptive"}
        payload["output_config"] = {"effort": "high"}

    url = base_url.rstrip("/") + "/messages"
    headers = {
        "content-type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "user-agent": USER_AGENT,
    }

    def post(body):
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    try:
        result = post(payload)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        # A gateway that proxies an older API version rejects the reasoning
        # parameters. Retry once without them rather than failing the run.
        if exc.code == 400 and use_thinking:
            payload.pop("thinking", None)
            payload.pop("output_config", None)
            result = post(payload)
        else:
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc

    if result.get("stop_reason") == "refusal":
        raise RuntimeError("request declined by the model's safety classifiers")
    parts = [b.get("text", "") for b in result.get("content", []) if b.get("type") == "text"]
    if not parts:
        raise RuntimeError(f"no text block in response (stop_reason={result.get('stop_reason')})")
    return "".join(parts)


def list_models(base_url, api_key):
    req = urllib.request.Request(
        base_url.rstrip("/") + "/models",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "user-agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    for entry in data.get("data", data if isinstance(data, list) else []):
        print(f"  {entry.get('id', entry)}")


def read_pack(pack_dir):
    records = []
    with open(os.path.join(pack_dir, "species.ndjson"), "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def write_pack(pack_dir, records):
    """Rewrite the pack atomically so an interrupted run cannot truncate it."""
    path = os.path.join(pack_dir, "species.ndjson")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def find_reference(species_id):
    """Locate a raw specimen photograph for this species, if one was downloaded."""
    slug = re.sub(r"^(bf|bird)-", "", species_id)
    for group in ("butterfly", "bird"):
        for suffix in ("_raw.jpg", "_raw.png"):
            candidate = os.path.join(SPECIMENS_DIR, f"{group}_{slug}{suffix}")
            if os.path.exists(candidate):
                return candidate
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Draw species plates as SVG through a Claude Messages endpoint."
    )
    parser.add_argument("--pack", default="butterfly-vn", help="Pack id under public/packs.")
    parser.add_argument("--limit", type=int, default=5, help="Maximum species to draw.")
    parser.add_argument("--all", action="store_true", help="Draw every candidate, ignoring --limit.")
    parser.add_argument("--slugs", default="", help="Comma-separated species ids to draw.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--base-url", default=os.environ.get("SPIDEX_CLAUDE_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--list-models", action="store_true", help="List endpoint models and exit.")
    parser.add_argument("--reference", action="store_true", help="Attach a raw photo when one exists.")
    parser.add_argument("--no-thinking", action="store_true", help="Omit reasoning parameters.")
    parser.add_argument("--dry-run", action="store_true", help="Report targets without calling out.")
    parser.add_argument("--delay", type=float, default=1.5, help="Seconds between requests.")
    args = parser.parse_args()

    api_key = load_api_key()
    if not api_key and not args.dry_run:
        print("ERROR: no API key. Set SPIDEX_CLAUDE_API_KEY in the environment or .env", file=sys.stderr)
        return 1
    if api_key:
        print(f"Key loaded ({len(api_key)} chars) — endpoint {args.base_url}")

    if args.list_models:
        list_models(args.base_url, api_key)
        return 0

    pack_dir = os.path.join(PROJECT_ROOT, "public/packs", args.pack)
    img_dir = os.path.join(pack_dir, "img")
    if not os.path.isdir(img_dir):
        print(f"ERROR: no such pack: {pack_dir}", file=sys.stderr)
        return 1

    records = read_pack(pack_dir)
    wanted = {s.strip() for s in args.slugs.split(",") if s.strip()}

    # A species is a candidate when it has no plate of its own: either it still
    # points at a shared archetype, or its file is simply absent.
    candidates = []
    for rec in records:
        images = rec.get("images") or [{}]
        url = images[0].get("fullUrl", "")
        placeholder = "archetype" in url or not os.path.exists(
            os.path.join(pack_dir, url) if url else ""
        )
        if wanted:
            if rec.get("id") in wanted:
                candidates.append(rec)
        elif placeholder:
            candidates.append(rec)

    if not args.all and args.limit > 0:
        candidates = candidates[: args.limit]

    print(f"{len(candidates)} species to draw in {args.pack}\n")
    if args.dry_run:
        for rec in candidates:
            ref = find_reference(rec["id"]) if args.reference else None
            print(f"  {rec['id']:<44} {rec.get('sciName','')}" + (f"  [ref: {os.path.basename(ref)}]" if ref else ""))
        return 0

    drawn = 0
    started = time.time()
    for i, rec in enumerate(candidates, 1):
        species_id = rec["id"]
        sci = rec.get("sciName", "")
        print(f"[{i}/{len(candidates)}] {sci} ({species_id})...", flush=True)

        ref = find_reference(species_id) if args.reference else None
        try:
            raw = call_claude(
                args.base_url, api_key, args.model, build_prompt(rec),
                ref_image=ref, use_thinking=not args.no_thinking,
            )
            markup = validate_svg(raw)
        except (RuntimeError, ValueError, urllib.error.URLError, TimeoutError) as exc:
            print(f"  x {exc}", flush=True)
            continue

        filename = f"{species_id}.svg"
        with open(os.path.join(img_dir, filename), "w", encoding="utf-8") as fh:
            fh.write(markup)

        rec.setdefault("images", [{}])
        rec["images"][0].update({
            "id": f"{species_id}-1",
            "thumbUrl": f"img/{filename}",
            "fullUrl": f"img/{filename}",
            "credit": "Spidex Scientific Specimen Drawing",
            "license": "CC-BY-SA-4.0",
        })
        write_pack(pack_dir, records)
        drawn += 1
        print(f"  ok {filename} ({len(markup)} B)", flush=True)

        if i < len(candidates):
            time.sleep(args.delay)

    print(f"\nDrew {drawn}/{len(candidates)} plates in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
