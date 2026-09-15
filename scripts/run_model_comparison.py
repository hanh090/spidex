#!/usr/bin/env python3
"""Generate field-guide plates for the same 4 butterflies across several
OpenRouter image models, so the results can be compared side by side."""
import os
import sys
import json
import base64
import time
import urllib.request
import urllib.error
import importlib.util

DATA_FILE = "data/vietnam_50_birds_50_butterflies.json"
SKILL_GENERATOR = ".agents/skills/spidex-specimen-plate/scripts/generate_specimen_plate.py"
PUB_DIR = "public/museum_specimens"
OUT_DIR = "public/model_comparison"
RESULT_JSON = "data/model_comparison_results.json"

# Species under test: the four Gemini 2.5 plates the user is comparing against.
TARGET_SCI_NAMES = [
    "Papilio paris",
    "Troides aeacus",
    "Hebomoia glaucippe",
    "Appias albina",
]

# Every entry is served by OpenRouter's /api/v1/images endpoint.
MODELS = [
    {
        "slug": "openai/gpt-image-2",
        "key": "gpt-image-2",
        "label": "GPT Image 2",
        "vendor": "OpenAI",
    },
    {
        "slug": "openai/gpt-5-image",
        "key": "gpt-5-image",
        "label": "GPT-5 Image",
        "vendor": "OpenAI",
    },
    {
        "slug": "microsoft/mai-image-2.6-flash",
        "key": "mai-image-2.6-flash",
        "label": "MAI-Image-2.6 Flash",
        "vendor": "Microsoft AI",
    },
    {
        "slug": "google/gemini-3-pro-image",
        "key": "gemini-3-pro-image",
        "label": "Nano Banana Pro",
        "vendor": "Google",
    },
]

def _load_skill_prompt_builder():
    """Import build_prompt from the skill, which lives outside the import path."""
    spec = importlib.util.spec_from_file_location("specimen_plate", SKILL_GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build_prompt


skill_build_prompt = _load_skill_prompt_builder()

ENV_CANDIDATES = [
    "/Users/hanhle/projects/gabo/flexlane-api/.env.dev",
    "/Users/hanhle/projects/personal-stuff/vinanonwoven/.claude/.env",
    "/Users/hanhle/projects/gabo/flexlane-api-main/.env.dev",
]


def get_openrouter_key():
    for path in ENV_CANDIDATES:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                if "sk-or-v1-" in line and "=" in line:
                    value = line.strip().split("=", 1)[1].strip().strip("\"'")
                    if value:
                        return value
    return os.environ.get("OPENROUTER_API_KEY")


def get_credits(key):
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/credits",
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode()).get("data", {})
    except Exception as exc:
        print(f"  [WARN] credits lookup failed: {exc}")
        return {}


def build_prompt(item):
    """Delegate to the spidex:specimen-plate skill so every model in the
    comparison is judged on the exact prompt production uses."""
    return skill_build_prompt(
        "butterfly",
        item["sciName"],
        item["commonNameEn"],
        item.get("commonNameVi", ""),
        item["fieldMarks"],
    )


def generate(model, item, key, force=False):
    slug = item["id"].split("butterfly_", 1)[-1]
    out_name = f"{model['key']}__{slug}.png"
    out_path = os.path.join(OUT_DIR, out_name)

    if not force and os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
        print(f"  [SKIP] {out_name} already present")
        return {"file": out_name, "status": "cached", "seconds": 0.0, "cost": 0.0}

    raw_path = os.path.join(PUB_DIR, os.path.basename(item["rawUrl"]))
    if not os.path.exists(raw_path):
        return {"file": None, "status": "missing-source", "error": raw_path}

    with open(raw_path, "rb") as fh:
        raw_b64 = base64.b64encode(fh.read()).decode("ascii")

    payload = {
        "model": model["slug"],
        "prompt": build_prompt(item),
        "input_references": [
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{raw_b64}"},
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

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")[:300]
        print(f"  [HTTP {exc.code}] {detail}")
        return {"file": None, "status": f"http-{exc.code}", "error": detail}
    except Exception as exc:
        print(f"  [ERROR] {exc}")
        return {"file": None, "status": "error", "error": str(exc)}

    elapsed = time.time() - started
    entries = body.get("data") or []
    b64_payload = entries[0].get("b64_json") if entries else None
    if not b64_payload:
        print(f"  [ERROR] no image in response: {json.dumps(body)[:300]}")
        return {"file": None, "status": "empty", "error": json.dumps(body)[:300]}

    image_bytes = base64.b64decode(b64_payload)
    with open(out_path, "wb") as fh:
        fh.write(image_bytes)

    cost = float(body.get("usage", {}).get("cost") or 0.0)
    print(f"  [OK] {out_name} ({len(image_bytes)} bytes, {elapsed:.1f}s, ${cost:.4f})")
    return {
        "file": out_name,
        "status": "ok",
        "seconds": round(elapsed, 1),
        "cost": cost,
        "bytes": len(image_bytes),
    }


def main():
    force = "--force" in sys.argv
    key = get_openrouter_key()
    if not key:
        print("Error: no OpenRouter API key found.")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"OpenRouter key {key[:14]}...{key[-4:]}")
    before = get_credits(key)
    start_usage = float(before.get("total_usage", 0) or 0)
    print(
        f"Balance before: ${float(before.get('total_credits', 0) or 0) - start_usage:.4f}\n"
    )

    with open(DATA_FILE, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    species = [b for b in data["butterflies"] if b["sciName"] in TARGET_SCI_NAMES]
    species.sort(key=lambda s: TARGET_SCI_NAMES.index(s["sciName"]))

    results = {}
    if os.path.exists(RESULT_JSON) and not force:
        with open(RESULT_JSON, "r", encoding="utf-8") as fh:
            results = json.load(fh).get("results", {})

    for model in MODELS:
        print(f"\n=== {model['label']} ({model['slug']}) ===")
        bucket = results.setdefault(model["key"], {})
        for item in species:
            print(f"[{item['commonNameEn']}]")
            bucket[item["sciName"]] = generate(model, item, key, force)
            with open(RESULT_JSON, "w", encoding="utf-8") as fh:
                json.dump(
                    {"models": MODELS, "species": species, "results": results},
                    fh,
                    indent=2,
                    ensure_ascii=False,
                )
            time.sleep(1)

    after = get_credits(key)
    end_usage = float(after.get("total_usage", 0) or 0)
    print("\n==========================================")
    print(f"Batch cost: ${end_usage - start_usage:.4f}")
    print(
        f"Balance after: ${float(after.get('total_credits', 0) or 0) - end_usage:.4f}"
    )
    print(f"Results written to {RESULT_JSON}")


if __name__ == "__main__":
    main()
