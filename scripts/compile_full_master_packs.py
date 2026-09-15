#!/usr/bin/env python3
"""
Compiles the complete Master Species Checklists into production Spidex Packs:
- public/packs/bird-vn: All 962 Birds of Vietnam
- public/packs/butterfly-vn: All 1,418 Butterflies of Vietnam
"""
import os
import sys
import json
import re
import shutil

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_PACKS = os.path.join(ROOT_DIR, "public", "packs")
DIST_PACKS = os.path.join(ROOT_DIR, "dist", "packs")

# ---------------------------------------------------------------------------
# Language separation.
#
# Every localized field must be written so that the `en` variant contains no
# Vietnamese and the `vi` variant contains no untranslated English. These
# helpers exist because the previous compiler interpolated one status string
# and one Vietnamese family gloss into BOTH variants, which put Vietnamese in
# front of every English and German reader. See
# scripts/migrate_pack_language.py, which repaired the packs already compiled.
# ---------------------------------------------------------------------------

# Checklist status values, split into the two languages they were written in.
STATUS_LANGS = {
    "Bản địa (Native)":                     ("Native", "Bản địa"),
    "Hiếm gặp / Lang thang (Accidental)":   ("Accidental", "Hiếm gặp / Lang thang"),
    "Đặc hữu Việt Nam (Endemic)":           ("Endemic to Vietnam", "Đặc hữu Việt Nam"),
    "Du nhập (Introduced)":                 ("Introduced", "Du nhập"),
    "Bảo vệ nghiêm ngặt (Cites / Sách Đỏ)": ("Strictly protected (CITES / Red Data Book)",
                                             "Bảo vệ nghiêm ngặt (CITES / Sách Đỏ)"),
}


def split_status(status):
    """Checklist status -> LocalizedText. Unknown values are kept verbatim."""
    en, vi = STATUS_LANGS.get(status, (status, status))
    return {"en": en, "vi": vi}


def status_feature(status):
    """The 'Status in Vietnam' key feature, with each half in its own language."""
    s = split_status(status)
    return {"en": f"Status in Vietnam: {s['en']}",
            "vi": f"Tình trạng tại VN: {s['vi']}"}


def taxonomy_feature(order, fam, fam_vi, genus=None):
    """
    The taxonomy line. Scientific names — order, family, genus — are
    language-neutral and appear in both variants; the Vietnamese family gloss
    appears only in `vi`.
    """
    en = f"Order: {order} | Family: {fam}" if order else f"Family: {fam}"
    vi = f"Bộ: {order} | Họ: {fam_vi} ({fam})" if order else f"Họ: {fam_vi} ({fam})"
    if genus:
        en += f" | Genus: {genus}"
        vi += f" | Chi: {genus}"
    return {"en": en, "vi": vi}


def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '_', text).strip('_')
    return text

def infer_bird_size(family):
    fam = family.lower()
    if any(k in fam for k in ["ardeidae", "ciconiidae", "bucerotidae", "accipitridae", "falconidae", "phasianidae", "pelecanidae", "sulidae", "gruidae", "pandionidae"]):
        return "large"
    elif any(k in fam for k in ["corvidae", "cuculidae", "columbidae", "upupidae", "dicruridae", "rallidae", "apodidae", "strigidae", "anatidae", "laridae", "megalaimidae", "picidae", "turdidae"]):
        return "med"
    elif any(k in fam for k in ["pycnonotidae", "muscicapidae", "sturnidae", "alcedinidae", "laniidae", "meropidae", "motacillidae", "leiothrichidae", "pittidae"]):
        return "small"
    else:
        return "tiny"

def infer_bird_colours(name_vi, name_en, family):
    combined = f"{name_vi} {name_en} {family}".lower()
    colours = []
    if any(w in combined for w in ["đen", "black", "quạ", "muội"]): colours.append("black")
    if any(w in combined for w in ["trắng", "white", "bạc", "cò"]): colours.append("white")
    if any(w in combined for w in ["vàng", "yellow", "gold", "hoàng anh"]): colours.append("yellow")
    if any(w in combined for w in ["lam", "xanh lam", "blue", "bói cá", "nuốc"]): colours.append("blue")
    if any(w in combined for w in ["lục", "xanh lục", "green", "trảu"]): colours.append("green")
    if any(w in combined for w in ["đỏ", "hung", "hồng", "red", "rufous", "chestnut"]): colours.append("red")
    if any(w in combined for w in ["nâu", "xám", "brown", "grey", "gray", "manh"]): colours.append("brown")
    return colours[:3] if colours else ["brown"]

def infer_bird_archetype(family):
    fam = family.lower()
    if any(k in fam for k in ["accipitridae", "falconidae", "strigidae", "tytonidae", "pandionidae"]):
        return "bird-archetype-raptor.svg"
    elif any(k in fam for k in ["ardeidae", "ciconiidae", "rallidae", "laridae", "charadriidae", "scolopacidae", "podicipedidae", "sulidae"]):
        return "bird-archetype-waterbird.svg"
    elif any(k in fam for k in ["anatidae"]):
        return "bird-archetype-waterfowl.svg"
    elif any(k in fam for k in ["alcedinidae", "meropidae", "coraciidae", "bucerotidae", "picidae", "megalaimidae"]):
        return "bird-archetype-kingfisher.svg"
    elif any(k in fam for k in ["corvidae", "dicruridae"]):
        return "bird-archetype-corvid.svg"
    elif any(k in fam for k in ["passeridae", "motacillidae", "emberizidae", "fringillidae"]):
        return "bird-archetype-sparrow.svg"
    else:
        return "bird-archetype-songbird.svg"

def infer_butterfly_size(family, sci_name):
    fam = family.lower()
    sci = sci_name.lower()
    if "troides" in sci or "kallima" in sci or "hypolimnas" in sci or "papilio" in sci or "papilionidae" in fam:
        return "large"
    elif "nymphalidae" in fam or "pieridae" in fam:
        return "med"
    elif "lycaenidae" in fam:
        return "small"
    elif "hesperiidae" in fam:
        return "small"
    else:
        return "tiny"

def infer_butterfly_colours(name_vi, name_en, family):
    combined = f"{name_vi} {name_en} {family}".lower()
    colours = []
    if any(w in combined for w in ["đen", "black", "quạ", "nhung"]): colours.append("black")
    if any(w in combined for w in ["trắng", "white", "phấn"]): colours.append("white")
    if any(w in combined for w in ["vàng", "yellow", "gold", "chanh", "muồng"]): colours.append("gold")
    if any(w in combined for w in ["cam", "orange", "hổ"]): colours.append("orange")
    if any(w in combined for w in ["đỏ", "red", "hồng", "thần"]): colours.append("red")
    if any(w in combined for w in ["lam", "xanh lam", "blue", "ngọc bích", "sapphire"]): colours.append("blue")
    if any(w in combined for w in ["nâu", "brown", "lá khô", "cỏ"]): colours.append("brown")
    if any(w in combined for w in ["lục", "green"]): colours.append("green")
    return colours[:3] if colours else ["brown"]

def infer_butterfly_patterns(name_vi, name_en):
    combined = f"{name_vi} {name_en}".lower()
    patterns = []
    if any(w in combined for w in ["đốm", "spot", "chấm", "sao", "báo"]): patterns.append("spots")
    if any(w in combined for w in ["vạch", "dải", "vằn", "sọc", "band", "bản đồ", "thủy thủ", "ba vạch"]): patterns.append("bands")
    if any(w in combined for w in ["mắt", "eye", "mắt cọ", "mắt công"]): patterns.append("eyespots")
    if not patterns: patterns.append("plain")
    return patterns[:2]

def infer_butterfly_archetype(family, genus):
    fam = family.lower()
    g = genus.lower()
    if "papilionidae" in fam or g in ["troides", "papilio", "atrophaneura"]:
        return "bf-archetype-papilionid.svg"
    elif "pieridae" in fam or g in ["delias", "catopsilia", "eurema", "pieris"]:
        return "bf-archetype-pierid.svg"
    elif "lycaenidae" in fam:
        return "bf-archetype-lycaenid.svg"
    elif "hesperiidae" in fam:
        return "bf-archetype-general.svg"
    elif "graphium" in g:
        return "bf-archetype-graphium.svg"
    else:
        return "bf-archetype-nymphalid.svg"

def compile_birds():
    print("=== Compiling Full Birds of Vietnam Pack (962 species) ===")
    birds_file = os.path.join(ROOT_DIR, "data", "checklists", "vietnam_birds_master_checklist.json")
    with open(birds_file, "r", encoding="utf-8") as f:
        master = json.load(f)["species"]

    pack_dir = os.path.join(PUBLIC_PACKS, "bird-vn")
    img_dir = os.path.join(pack_dir, "img")
    os.makedirs(img_dir, exist_ok=True)

    # Load 50 curated birds for exact plate mapping
    v50_file = os.path.join(ROOT_DIR, "data", "vietnam_50_birds_50_butterflies.json")
    v50_bird_map = {}
    if os.path.exists(v50_file):
        with open(v50_file, "r", encoding="utf-8") as f:
            for item in json.load(f)["birds"]:
                target_img = item["id"].replace("bvn-bird_", "bird-") + ".jpg"
                v50_bird_map[item["sciName"].lower()] = target_img
        # Synonyms in master checklist
        v50_bird_map["bubulcus coromandus"] = "bird-cattle_egret.jpg"
        v50_bird_map["ardea coromanda"] = "bird-cattle_egret.jpg"
        v50_bird_map["pycnonotus conradi"] = "bird-streak_eared_bulbul.jpg"
        v50_bird_map["rubigula flaviventris"] = "bird-black_crested_bulbul.jpg"

    # First pass: map genus for similarTo
    genus_map = {}
    for b in master:
        g = b.get("genus") or b["sciName"].split()[0]
        sid = f"bird-{slugify(b['sciName'])}"
        genus_map.setdefault(g, []).append(sid)

    records = []
    total_bytes = 0
    used_images = set()

    for b in master:
        sci = b["sciName"].strip()
        slug = slugify(sci)
        sid = f"bird-{slug}"
        g = b.get("genus") or sci.split()[0]
        fam = b.get("family", "Unknown")
        fam_vi = b.get("familyVi", fam)
        order = b.get("order", "Aves")
        status = b.get("status", "Bản địa (Native)")
        iucn = b.get("iucnStatus", "LC")

        vi_name = b.get("commonNameVi", sci)
        en_name = b.get("commonNameEn", sci)

        # Similar species in same genus
        similar = [other for other in genus_map.get(g, []) if other != sid][:3]

        # Check for curated JPG plate
        chosen_img = None
        credit = "Spidex Scientific Specimen Drawing (Aves of Vietnam)"

        curated_target = v50_bird_map.get(sci.lower())
        if curated_target and os.path.exists(os.path.join(img_dir, curated_target)):
            chosen_img = f"img/{curated_target}"
            credit = "Spidex Natural History Specimen Plate (Redrawn from Observation)"
            used_images.add(os.path.join(img_dir, curated_target))
        else:
            jpg_candidates = [
                f"bird-{slug}.jpg",
                f"bird_{slug}.jpg",
                f"bird-{slugify(en_name)}.jpg"
            ]
            for cand in jpg_candidates:
                cand_path = os.path.join(img_dir, cand)
                if os.path.exists(cand_path) and os.path.getsize(cand_path) > 5000:
                    chosen_img = f"img/{cand}"
                    credit = "Spidex Natural History Specimen Plate (Redrawn from Observation)"
                    used_images.add(cand_path)
                    break

        if not chosen_img:
            arch = infer_bird_archetype(fam)
            chosen_img = f"img/{arch}"
            arch_path = os.path.join(img_dir, arch)
            if os.path.exists(arch_path):
                used_images.add(arch_path)

        # Key features
        kf = [
            taxonomy_feature(order, fam, fam_vi),
            status_feature(status),
        ]
        if iucn != "LC":
            kf.append({"en": f"Conservation status: IUCN {iucn}", "vi": f"Phân hạng bảo tồn: Sách Đỏ / IUCN {iucn}"})

        sensitivity = 2 if "Đặc hữu" in status or iucn in ["CR", "EN", "VU"] else 0

        rec = {
            "id": sid,
            "sciName": sci,
            "commonNames": {
                "en": en_name,
                "vi": vi_name
            },
            "family": fam,
            "traits": {
                "size": infer_bird_size(fam),
                "colour": infer_bird_colours(vi_name, en_name, fam)
            },
            "keyFeatures": kf,
            "habitat": {
                "en": "Forests, wetlands and natural ecosystems across Vietnam",
                "vi": "Hệ sinh thái rừng, đất ngập nước và sinh cảnh tự nhiên Việt Nam"
            },
            "taxonFields": {
                "call": {
                    "en": f"Characteristic territorial and foraging calls of {fam}",
                    "vi": f"Tiếng hót và tiếng gọi bầy đặc trưng của họ {fam_vi}"
                }
            },
            "similarTo": similar,
            "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            "sensitivity": sensitivity,
            "status": split_status(status),
            "images": [
                {
                    "id": f"{sid}-1",
                    "aspect": "profile",
                    "credit": credit,
                    "license": "CC-BY-SA-4.0",
                    "thumbUrl": chosen_img,
                    "fullUrl": chosen_img
                }
            ]
        }
        records.append(rec)

    for img_p in used_images:
        total_bytes += os.path.getsize(img_p)

    # Write species.ndjson
    ndjson_path = os.path.join(pack_dir, "species.ndjson")
    with open(ndjson_path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Read and update pack.json
    pack_json_path = os.path.join(pack_dir, "pack.json")
    with open(pack_json_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    manifest["version"] = 2
    manifest["speciesCount"] = len(records)
    manifest["sizeBytes"] = {
        "thumb": total_bytes,
        "full": total_bytes
    }
    manifest["sources"] = [
        "IOC World Bird List v14.1 & Craik & Minh (2018)",
        "Vietnam Red Data Book & IEBR Checklist",
        "Spidex Natural History Museum Plate Collection"
    ]

    with open(pack_json_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"Successfully compiled {len(records)} bird species into {pack_dir}")

def compile_butterflies():
    print("=== Compiling Full Butterflies of Vietnam Pack (1,418 species) ===")
    bfs_file = os.path.join(ROOT_DIR, "data", "checklists", "vietnam_butterflies_master_checklist.json")
    with open(bfs_file, "r", encoding="utf-8") as f:
        master = json.load(f)["species"]

    pack_dir = os.path.join(PUBLIC_PACKS, "butterfly-vn")
    img_dir = os.path.join(pack_dir, "img")
    os.makedirs(img_dir, exist_ok=True)

    # Load 50 curated butterflies for exact plate mapping
    v50_file = os.path.join(ROOT_DIR, "data", "vietnam_50_birds_50_butterflies.json")
    v50_bf_map = {}
    if os.path.exists(v50_file):
        with open(v50_file, "r", encoding="utf-8") as f:
            for item in json.load(f)["butterflies"]:
                target_img = item["id"].replace("butterfly-butterfly_", "butterfly-") + ".jpg"
                v50_bf_map[item["sciName"].lower()] = (target_img, item)

    # Ensure all 50 curated butterflies are in master
    master_scis = {b["sciName"].lower() for b in master}
    for sci_lower, (target_img, item) in v50_bf_map.items():
        if sci_lower not in master_scis:
            master.append({
                "sciName": item["sciName"],
                "commonNameVi": item.get("commonNameVi", item["sciName"]),
                "commonNameEn": item.get("commonNameEn", item["sciName"]),
                "family": item.get("family", "Nymphalidae"),
                "familyVi": item.get("family", "Nymphalidae"),
                "genus": item["sciName"].split()[0],
                "status": "Bản địa (Native)"
            })

    genus_map = {}
    for b in master:
        g = b.get("genus") or b["sciName"].split()[0]
        sid = f"bf-{slugify(b['sciName'])}"
        genus_map.setdefault(g, []).append(sid)

    records = []
    total_bytes = 0
    used_images = set()

    for b in master:
        sci = b["sciName"].strip()
        slug = slugify(sci)
        sid = f"bf-{slug}"
        g = b.get("genus") or sci.split()[0]
        fam = b.get("family", "Nymphalidae")
        fam_vi = b.get("familyVi", fam)
        status = b.get("status", "Bản địa (Native)")

        vi_name = b.get("commonNameVi", sci)
        en_name = b.get("commonNameEn", sci)

        similar = [other for other in genus_map.get(g, []) if other != sid][:3]

        # Check for curated JPG plate
        chosen_img = None
        credit = "Spidex Scientific Specimen Drawing (Lepidoptera of Vietnam)"

        curated_info = v50_bf_map.get(sci.lower())
        if curated_info and os.path.exists(os.path.join(img_dir, curated_info[0])):
            chosen_img = f"img/{curated_info[0]}"
            credit = "Spidex Natural History Specimen Plate (Redrawn from Observation)"
            used_images.add(os.path.join(img_dir, curated_info[0]))
        else:
            jpg_candidates = [
                f"butterfly-{slug}.jpg",
                f"butterfly_{slug}.jpg",
                f"{slug}.jpg"
            ]
            for cand in jpg_candidates:
                cand_path = os.path.join(img_dir, cand)
                if os.path.exists(cand_path) and os.path.getsize(cand_path) > 5000:
                    chosen_img = f"img/{cand}"
                    credit = "Spidex Natural History Specimen Plate (Redrawn from Observation)"
                    used_images.add(cand_path)
                    break

        if not chosen_img:
            arch = infer_butterfly_archetype(fam, g)
            chosen_img = f"img/{arch}"
            arch_path = os.path.join(img_dir, arch)
            if os.path.exists(arch_path):
                used_images.add(arch_path)

        kf = [
            taxonomy_feature(None, fam, fam_vi, genus=g),
            status_feature(status),
        ]

        rec = {
            "id": sid,
            "sciName": sci,
            "commonNames": {
                "en": en_name,
                "vi": vi_name
            },
            "family": fam,
            "traits": {
                "size": infer_butterfly_size(fam, sci),
                "colour": infer_butterfly_colours(vi_name, en_name, fam),
                "pattern": infer_butterfly_patterns(vi_name, en_name)
            },
            "keyFeatures": kf,
            "habitat": {
                "en": "Tropical rainforest, clearings and forest edges of Vietnam",
                "vi": "Rừng mưa nhiệt đới, bìa rừng và thảm thực vật tự nhiên Việt Nam"
            },
            "taxonFields": {
                "hostPlants": {
                    "en": f"Caterpillar host plants associated with family {fam}",
                    "vi": f"Cây thức ăn cho sâu non thuộc hệ thực vật họ {fam_vi}"
                }
            },
            "similarTo": similar,
            "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            "sensitivity": 0,
            "status": split_status(status),
            "images": [
                {
                    "id": f"{sid}-1",
                    "aspect": "dorsal",
                    "credit": credit,
                    "license": "CC-BY-SA-4.0",
                    "thumbUrl": chosen_img,
                    "fullUrl": chosen_img
                }
            ]
        }
        records.append(rec)

    for img_p in used_images:
        total_bytes += os.path.getsize(img_p)

    ndjson_path = os.path.join(pack_dir, "species.ndjson")
    with open(ndjson_path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    pack_json_path = os.path.join(pack_dir, "pack.json")
    with open(pack_json_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    manifest["version"] = 2
    manifest["speciesCount"] = len(records)
    manifest["sizeBytes"] = {
        "thumb": total_bytes,
        "full": total_bytes
    }
    manifest["sources"] = [
        "A. L. Monastyrskii & A. L. Devyatkin (Butterflies of Vietnam)",
        "Vietnam Biodiversity Checklist & iNaturalist Research Specimens",
        "Spidex Natural History Museum Plate Collection"
    ]

    with open(pack_json_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"Successfully compiled {len(records)} butterfly species into {pack_dir}")

def sync_to_dist():
    print("=== Syncing packs to dist/packs/ ===")
    os.makedirs(DIST_PACKS, exist_ok=True)
    for p in ["bird-vn", "butterfly-vn"]:
        src = os.path.join(PUBLIC_PACKS, p)
        dst = os.path.join(DIST_PACKS, p)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        print(f"Synced {p} to {dst}")

if __name__ == "__main__":
    compile_birds()
    compile_butterflies()
    sync_to_dist()
    print("All packs compiled and synchronized successfully!")
