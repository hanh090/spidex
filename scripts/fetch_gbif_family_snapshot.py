#!/usr/bin/env python3
"""Snapshot GBIF Backbone matches for Thailand unknowns and Vietnam butterflies.

Run explicitly when curating the packs; the normal build uses the committed
snapshot and never depends on a live taxonomy API. No match is silently
accepted: apply_preview_content.py checks every response again.
"""
import argparse
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/taxonomy/gbif-family-2026-11-27.json"
API = "https://api.gbif.org/v1/species/match"
PACK_CLASSES = {"bird-th": "Aves", "butterfly-th": "Insecta", "butterfly-vn": "Insecta"}


def query(pack: str, name: str) -> dict:
    params = urllib.parse.urlencode({"name": name, "class": PACK_CLASSES[pack], "strict": "true"})
    url = f"{API}?{params}"
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Spidex-family-curation/1.0 (https://github.com/hanh090/spidex)"})
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = json.load(response)
            return {"pack": pack, "name": name, "url": url,
                    "matchType": raw.get("matchType"), "rank": raw.get("rank"),
                    "confidence": raw.get("confidence"), "canonicalName": raw.get("canonicalName"),
                    "family": raw.get("family"), "class": raw.get("class"),
                    "status": raw.get("status"), "usageKey": raw.get("usageKey")}
        except Exception as exc:
            if attempt == 2:
                return {"pack": pack, "name": name, "url": url, "error": str(exc)}
            time.sleep(1 + attempt * 2)
    raise AssertionError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    wanted = []
    for pack in PACK_CLASSES:
        path = ROOT / "public/packs" / pack / "species.ndjson"
        for line in path.read_text().splitlines():
            row = json.loads(line)
            source = (row.get("provenance") or {}).get("family") or {}
            if row.get("family") == "Unknown" or source.get("source") == "GBIF Backbone" or pack == "butterfly-vn":
                wanted.append((pack, row["sciName"]))
    results = []
    if OUT.exists():
        results = json.loads(OUT.read_text())["matches"]
    completed = {(r["pack"], r["name"]) for r in results if "error" not in r}
    wanted = [(pack, name) for pack, name in wanted if (pack, name) not in completed]
    if not wanted:
        print(f"{OUT}: all requested names already snapshotted")
        return
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(query, pack, name) for pack, name in wanted]
        for future in as_completed(futures):
            results.append(future.result())
            if len(results) % 100 == 0:
                print(f"queried {len(results)}/{len(wanted)}", flush=True)
    results.sort(key=lambda r: (r["pack"], r["name"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": API, "retrieved": date.today().isoformat(), "matches": results}, indent=2) + "\n")
    print(f"wrote {OUT}: {len(results)} matches, {sum('error' in r for r in results)} errors")


if __name__ == "__main__":
    main()
