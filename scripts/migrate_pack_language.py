#!/usr/bin/env python3
"""
Normalises language in compiled packs.

Two defects, both introduced by the pack compiler and both visible to any user
whose interface language is not Vietnamese:

  1. `status` was written as a bare string carrying Vietnamese, e.g.
     "Bản địa (Native)". It is now LocalizedText: {"en": "Native",
     "vi": "Bản địa"}. The English half was already present in the source
     string, in parentheses — this splits rather than translates.

  2. `keyFeatures[].en` carried the Vietnamese family name in parentheses,
     e.g. "Order: Anseriformes | Family: Anatidae (Họ Vịt)". The Vietnamese
     gloss belongs in the `vi` variant, which already has it. The English
     variant keeps the scientific family name, which is language-neutral.

Idempotent: a record already in the new shape is left untouched. Images are
never read or written. Run with --check to report without writing.

    python3 scripts/migrate_pack_language.py           # migrate, with backup
    python3 scripts/migrate_pack_language.py --check   # report only
"""
import argparse
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "public", "packs")
# Never inside public/ — everything there is copied verbatim into the
# deployed bundle, so a .bak beside a pack would be published with the site.
BACKUPS = os.path.join(ROOT, "backups", "pack-language-migration")

# Every status string the Vietnam packs emit, split into its two languages.
# The English side is taken from the parenthetical the compiler already wrote;
# nothing here is a new translation.
STATUS_MAP = {
    "Bản địa (Native)":                    {"en": "Native", "vi": "Bản địa"},
    "Hiếm gặp / Lang thang (Accidental)":  {"en": "Accidental", "vi": "Hiếm gặp / Lang thang"},
    "Đặc hữu Việt Nam (Endemic)":          {"en": "Endemic to Vietnam", "vi": "Đặc hữu Việt Nam"},
    "Du nhập (Introduced)":                {"en": "Introduced", "vi": "Du nhập"},
    "Bảo vệ nghiêm ngặt (Cites / Sách Đỏ)": {"en": "Strictly protected (CITES / Red Data Book)",
                                             "vi": "Bảo vệ nghiêm ngặt (CITES / Sách Đỏ)"},
}

# "Family: Anatidae (Họ Vịt)" -> "Family: Anatidae". Only strips a parenthetical
# that contains Vietnamese, so "(Rhopalocera)" and "(CITES)" survive.
VI_CHARS = (
    "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợ"
    "ùúủũụưừứửữựỳýỷỹỵđ"
)
VI_RE = re.compile(f"[{VI_CHARS}{VI_CHARS.upper()}]")
PAREN_RE = re.compile(r"\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)")


def strip_vietnamese_parentheticals(text):
    """Drop any (...) group containing Vietnamese letters."""
    out, changed = text, False
    while True:
        new = PAREN_RE.sub(lambda m: "" if VI_RE.search(m.group(1)) else m.group(0), out)
        if new == out:
            break
        out, changed = new, True
    return out.strip(), changed


def migrate_record(rec):
    """Returns (record, [names of fields changed])."""
    changed = []

    status = rec.get("status")
    if isinstance(status, str):
        status = status.strip()
        mapped = STATUS_MAP.get(status)
        if mapped:
            rec["status"] = dict(mapped)
        elif not VI_RE.search(status):
            # Already English (the Thailand and Singapore packs). Wrapping it
            # is a shape change, not a content change.
            rec["status"] = {"en": status}
        else:
            rec["status"] = {"en": status}
            print(f"  ! unmapped Vietnamese status, kept verbatim: {status!r}", file=sys.stderr)
        changed.append("status")

    for kf in rec.get("keyFeatures", []):
        en = kf.get("en")
        if not isinstance(en, str) or not VI_RE.search(en):
            continue

        # "Status in Vietnam: Bản địa (Native)" — the Vietnamese sits outside
        # any parenthetical here, so the parenthetical stripper cannot help.
        # Substitute the same English half the status field uses.
        replaced = en
        for vi_status, halves in STATUS_MAP.items():
            if vi_status in replaced:
                replaced = replaced.replace(vi_status, halves["en"])

        stripped, _ = strip_vietnamese_parentheticals(replaced)
        if stripped and not VI_RE.search(stripped) and stripped != en:
            kf["en"] = stripped
            changed.append("keyFeatures.en")
        elif VI_RE.search(stripped):
            print(f"  ! Vietnamese left in keyFeatures.en, needs a rule: {en!r}", file=sys.stderr)

    return rec, changed


def process(path, write):
    records, counts = [], {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec, changed = migrate_record(json.loads(line))
            for c in changed:
                counts[c] = counts.get(c, 0) + 1
            records.append(rec)

    if not counts:
        return counts

    if write:
        # Backups go OUTSIDE public/, which Vite copies verbatim into dist/ —
        # a .bak written next to the pack would be published with the site.
        pack = os.path.basename(os.path.dirname(path))
        backup_dir = os.path.join(BACKUPS, pack)
        os.makedirs(backup_dir, exist_ok=True)
        backup = os.path.join(backup_dir, "species.ndjson.pre-language-migration")
        if not os.path.exists(backup):
            shutil.copy2(path, backup)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        os.replace(tmp, path)

    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report without writing")
    args = ap.parse_args()

    total = 0
    for pack in sorted(os.listdir(PACKS)):
        path = os.path.join(PACKS, pack, "species.ndjson")
        if not os.path.isfile(path):
            continue
        counts = process(path, write=not args.check)
        if counts:
            total += sum(counts.values())
            detail = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
            print(f"{'would fix' if args.check else 'fixed'} {pack}: {detail}")

    if total == 0:
        print("nothing to migrate — all packs already normalised")
    elif args.check:
        print(f"\n{total} field(s) need migration. Re-run without --check to apply.")
    else:
        print(f"\n{total} field(s) migrated. Backups written to {BACKUPS}/.")


if __name__ == "__main__":
    main()
