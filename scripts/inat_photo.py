#!/usr/bin/env python3
"""Shared iNaturalist reference-photo lookup for the specimen-plate pipeline.

Two things matter for a good plate and neither is the default API behaviour:
  * licence - only CC0/CC-BY/CC-BY-SA photos are safe for commercial reuse, so
    the query filters on photo_license rather than taking whatever turns up.
  * resolution - the plate is only as accurate as the detail the model can see,
    so candidates are ranked by original pixel area instead of taking the first
    (newest) research-grade observation.
"""
import json
import time
import urllib.parse
import urllib.request

USER_AGENT = "SpidexFieldGuide/2.0 (Biodiversity Research; contact: team@spidex.io)"

# Licences that permit commercial reuse with attribution (CC0 needs none).
OPEN_LICENSES = "cc0,cc-by,cc-by-sa"

# iNaturalist place id. 7155 is Malaysia - a long-standing wrong value in this
# repo that silently produced Sundaic species for a Vietnam guide.
VIETNAM_PLACE_ID = 6847
CANDIDATE_POOL = 30


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def _score(photo):
    """Rank by original pixel area; unknown dimensions sort last."""
    dims = photo.get("original_dimensions") or {}
    return (dims.get("width") or 0) * (dims.get("height") or 0)


def _best_from(results):
    best, best_score = None, -1
    for obs in results or []:
        for photo in obs.get("photos") or []:
            score = _score(photo)
            if score > best_score:
                best, best_score = (obs, photo), score
    return best


def find_photo(sci_name, licenses=OPEN_LICENSES, place_id=VIETNAM_PLACE_ID, pause=1.0):
    """Return the highest-resolution openly licensed photo for a species.

    Prefers local (Vietnam) observations so plates reflect regional forms, then
    falls back to global. Returns None when nothing matches the licence filter.
    """
    q = urllib.parse.quote(sci_name.strip())
    lic = f"&photo_license={licenses}" if licenses else ""
    attempts = []
    if place_id:
        attempts.append((
            f"https://api.inaturalist.org/v1/observations?taxon_name={q}"
            f"&place_id={place_id}&quality_grade=research&photos=true"
            f"&per_page={CANDIDATE_POOL}{lic}", "iNaturalist (Vietnam)"))
    attempts.append((
        f"https://api.inaturalist.org/v1/observations?taxon_name={q}"
        f"&quality_grade=research&photos=true&per_page={CANDIDATE_POOL}{lic}",
        "iNaturalist (Global)"))

    for url, source in attempts:
        data = _get(url)
        if pause:
            time.sleep(pause)
        if not data or not data.get("results"):
            continue
        hit = _best_from(data["results"])
        if not hit:
            continue
        obs, photo = hit
        dims = photo.get("original_dimensions") or {}
        return {
            "url": photo.get("url", "").replace("square", "large").replace("medium", "large"),
            "attribution": photo.get("attribution", ""),
            "license": photo.get("license_code"),
            "source": source,
            "observer": obs.get("user", {}).get("login", ""),
            "observation_id": obs.get("id"),
            "width": dims.get("width"),
            "height": dims.get("height"),
        }
    return None


def download(photo, path, timeout=60):
    req = urllib.request.Request(photo["url"], headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    with open(path, "wb") as fh:
        fh.write(data)
    return len(data)
