#!/usr/bin/env python3
"""Fail a release when bundled pack claims outrun the content on disk.

This is an editorial safety gate, not a biological or legal review. A pack can
be listed as a preview with honest limitations; calling it complete requires a
named review and rejects the known template/placeholder patterns.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "public/packs"
TEMPLATE_TEXT = (
    "Diagnostic field markings of ",
    "Native regional ecosystem and forest canopy",
    "Distinctive vocalization in natural habitat",
)
SOURCE_AUDITED = {"bird-th", "butterfly-th", "butterfly-vn"}


def preview_content_issues(pack_id: str, manifest: dict, species: list[dict]) -> list[str]:
    """Keep the source-backed preview migration from silently regressing."""
    if pack_id not in SOURCE_AUDITED:
        return []
    issues: list[str] = []
    for row in species:
        name = row.get("sciName", row.get("id", "unknown"))
        provenance = row.get("provenance") or {}
        if row.get("traits") and not (provenance.get("traits") or {}).get("sourceUrl"):
            issues.append(f"{name}: identification traits have no species-level source")
        if (row.get("keyFeatures") or row.get("habitat") or row.get("taxonFields")) and not (provenance.get("content") or {}).get("sourceUrl"):
            issues.append(f"{name}: field account has no species-level source")
        if row.get("months") == list(range(1, 13)) and not (provenance.get("seasonality") or {}).get("sourceUrl"):
            issues.append(f"{name}: all-year seasonality has no source")
        if row.get("status", {}).get("en") == "Native" and not (provenance.get("status") or {}).get("sourceUrl"):
            issues.append(f"{name}: native status has no source")
        plate = provenance.get("plate") or {}
        reference = (plate.get("referenceLicense") or "").lower()
        displayed = [image for image in row.get("images", [])
                     if "archetype" not in image.get("thumbUrl", "")]
        if displayed:
            if reference not in {"cc-by", "cc-by-sa", "cc0", "pd"}:
                issues.append(f"{name}: displayed plate lacks a documented derivative grant")
            for image in displayed:
                license_code = str(image.get("license", "")).upper()
                if "-NC" in license_code or "-ND" in license_code:
                    issues.append(f"{name}: displayed plate advertises a restricted media licence")
                if reference == "cc-by-sa" and "BY-SA" not in license_code:
                    issues.append(f"{name}: ShareAlike reference is not reflected in plate licence")
    if manifest.get("traitSchema", {}).get("traits") and not any(row.get("traits") for row in species):
        issues.append("manifest advertises an identification key without sourced traits")
    return issues


def issues_for_pack(pack_id: str, manifest: dict, species: list[dict]) -> list[str]:
    issues: list[str] = []
    status = manifest.get("releaseStatus")
    if status not in {"preview", "complete", "fixture"}:
        issues.append("releaseStatus must explicitly be preview, complete, or fixture")
        return issues
    if status == "fixture":
        return issues
    if len(species) != manifest.get("speciesCount"):
        issues.append("speciesCount does not match species.ndjson")
    notes = manifest.get("releaseNotes")
    if status == "preview" and not (isinstance(notes, dict) and notes.get("en", "").strip()):
        issues.append("preview requires an English release note explaining its limitations")
    if status == "preview" and pack_id in SOURCE_AUDITED and not str(manifest.get("license", "")).startswith("Mixed;"):
        issues.append("audited preview must not claim a single licence for mixed or unresolved media")
    if status != "complete":
        return issues
    review = manifest.get("contentReview") or {}
    if not (review.get("reviewer") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", review.get("date", ""))):
        issues.append("complete requires a named contentReview reviewer and ISO date")
    if not species:
        issues.append("complete pack has no species accounts")
    if pack_id in SOURCE_AUDITED and not manifest.get("traitSchema", {}).get("traits"):
        issues.append("complete guide requires a reviewed identification key")
    for row in species:
        name = row.get("sciName", row.get("id", "unknown"))
        if pack_id in SOURCE_AUDITED:
            provenance = row.get("provenance") or {}
            if not row.get("traits") or not (provenance.get("traits") or {}).get("sourceUrl"):
                issues.append(f"{name}: complete guide requires sourced identification traits")
            if (not row.get("keyFeatures") or not row.get("habitat")
                    or not (provenance.get("content") or {}).get("sourceUrl")):
                issues.append(f"{name}: complete guide requires sourced markings and habitat")
        if row.get("family") in (None, "", "Unknown"):
            issues.append(f"{name}: family unknown")
        account = " ".join(str(row.get(k, "")) for k in ("keyFeatures", "habitat", "taxonFields"))
        if any(phrase in account for phrase in TEMPLATE_TEXT):
            issues.append(f"{name}: template identification content")
        if any("pending" in str(image.get("credit", "")).lower() or
               "archetype" in str(image.get("thumbUrl", "")).lower()
               for image in row.get("images", [])):
            issues.append(f"{name}: placeholder plate")
        if any("-NC" in str(image.get("license", "")).upper() or
               "BY-NC" in str(image.get("license", "")).upper()
               for image in row.get("images", [])):
            issues.append(f"{name}: NonCommercial image needs policy and permissions review")
    return issues


def main() -> int:
    index = json.loads((PACKS / "index.json").read_text())
    published = index["packs"]
    found = {p.parent.name for p in PACKS.glob("*/pack.json")}
    errors: list[str] = []
    if len(published) != len(set(published)):
        errors.append("duplicate pack id in public index")
    if not set(index["featured"]) <= set(published):
        errors.append("featured packs must be in the public index")
    for pack_id in sorted(found):
        manifest = json.loads((PACKS / pack_id / "pack.json").read_text())
        status = manifest.get("releaseStatus")
        if manifest.get("id") != pack_id:
            errors.append(f"{pack_id}: manifest id mismatch")
        if status == "fixture":
            if pack_id in published:
                errors.append(f"{pack_id}: fixture cannot be in the public index")
            continue
        if pack_id not in published:
            errors.append(f"{pack_id}: non-fixture pack missing from public index")
        species_file = PACKS / pack_id / "species.ndjson"
        if not species_file.exists():
            errors.append(f"{pack_id}: species.ndjson missing")
            continue
        species = [json.loads(line) for line in species_file.read_text().splitlines() if line.strip()]
        errors.extend(f"{pack_id}: {issue}" for issue in issues_for_pack(pack_id, manifest, species))
        errors.extend(f"{pack_id}: {issue}" for issue in preview_content_issues(pack_id, manifest, species))
    errors.extend(f"{pack_id}: indexed pack has no manifest" for pack_id in published if pack_id not in found)
    if errors:
        for error in errors[:30]:
            print(f"release gate: {error}", file=sys.stderr)
        if len(errors) > 30:
            print(f"release gate: {len(errors) - 30} more issues", file=sys.stderr)
        return 1
    print(f"release gate: {len(published)} preview/complete packs; {len(found) - len(published)} fixtures excluded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
