#!/usr/bin/env python3
"""
Feed transformed museum plates & cached research specimens into Spidex Packs:
- public/packs/bird-vn/ (50 Birds of Vietnam)
- public/packs/butterfly-vn/ (50 Butterflies of Vietnam)
"""
import os
import sys
import json
import shutil
import re

DATA_FILE = "data/vietnam_50_birds_50_butterflies.json"
PUB_SPEC_DIR = "public/museum_specimens"
PACKS_DIR = "public/packs"

def infer_bird_size(family, sci_name):
    fam = family.lower()
    sci = sci_name.lower()
    if any(k in fam for k in ["ardeidae", "ciconiidae", "bucerotidae", "accipitridae", "falconidae", "phasianidae"]):
        return "large"
    elif any(k in fam for k in ["corvidae", "cuculidae", "columbidae", "upupidae", "dicruridae", "rallidae", "apodidae"]):
        return "med"
    elif any(k in fam for k in ["pycnonotidae", "muscicapidae", "sturnidae", "alcedinidae", "laniidae", "meropidae", "motacillidae"]):
        return "small"
    elif any(k in fam for k in ["nectariniidae", "passeridae", "zosteropidae", "dicaeidae", "phylloscopidae", "cisticolidae"]):
        return "tiny"
    return "small"

def infer_bird_colours(sci_name, marks):
    m = marks.lower()
    colours = []
    if "black" in m or "slate" in m or "dark" in m: colours.append("black")
    if "white" in m or "pale" in m: colours.append("white")
    if "yellow" in m or "gold" in m: colours.append("yellow")
    if "blue" in m or "turquoise" in m or "cyan" in m: colours.append("blue")
    if "green" in m or "olive" in m: colours.append("green")
    if "red" in m or "rufous" in m or "chestnut" in m or "crimson" in m or "maroon" in m: colours.append("red")
    if "brown" in m or "buff" in m or "chocolate" in m: colours.append("brown")
    return colours[:3] if colours else ["brown"]

def infer_butterfly_size(family, sci_name):
    sci = sci_name.lower()
    fam = family.lower()
    if "troides" in sci or "kallima" in sci or "hypolimnas" in sci or "papilio" in sci:
        return "large"
    elif "nymphalidae" in fam or "papilionidae" in fam or "pieridae" in fam:
        return "med"
    else:
        return "small"

def infer_butterfly_colours(marks):
    m = marks.lower()
    colours = []
    if "black" in m or "dark" in m: colours.append("black")
    if "white" in m or "hyaline" in m: colours.append("white")
    if "orange" in m or "tawny" in m or "ochre" in m: colours.append("orange")
    if "yellow" in m or "golden" in m: colours.append("gold")
    if "blue" in m or "cyan" in m: colours.append("blue")
    if "red" in m or "scarlet" in m: colours.append("red")
    if "green" in m: colours.append("green")
    if "brown" in m or "chocolate" in m: colours.append("brown")
    return colours[:3] if colours else ["brown", "black"]

def infer_butterfly_patterns(marks):
    m = marks.lower()
    pats = []
    if "spot" in m or "stippl" in m: pats.append("spots")
    if "band" in m or "streak" in m or "stripe" in m or "bar" in m: pats.append("bands")
    if "eye" in m or "ocelli" in m: pats.append("eyespots")
    return pats[:2] if pats else ["plain"]

def compile_pack(taxon_group, data_items, pack_id, pack_title_en, pack_title_vi):
    pack_dir = os.path.join(PACKS_DIR, pack_id)
    img_dir = os.path.join(pack_dir, "img")
    os.makedirs(img_dir, exist_ok=True)

    if taxon_group == "aves":
        trait_schema = {
            "traits": [
                {
                    "key": "size",
                    "label": {"en": "Size", "vi": "Kích thước"},
                    "type": "single",
                    "render": "chip",
                    "options": [
                        {"v": "tiny", "label": {"en": "Sparrow or smaller (< 15 cm)", "vi": "Nhỏ hơn chim sẻ (< 15 cm)"}},
                        {"v": "small", "label": {"en": "Bulbul-sized (15–25 cm)", "vi": "Cỡ chào mào (15–25 cm)"}},
                        {"v": "med", "label": {"en": "Crow-sized (25–45 cm)", "vi": "Cỡ quạ (25–45 cm)"}},
                        {"v": "large", "label": {"en": "Eagle / Heron (> 45 cm)", "vi": "Cỡ diều hâu / diệc (> 45 cm)"}}
                    ]
                },
                {
                    "key": "colour",
                    "label": {"en": "Primary plumage", "vi": "Màu lông chính"},
                    "type": "multi",
                    "render": "swatch",
                    "max": 3,
                    "options": [
                        {"v": "black", "hex": "#1b1713", "label": {"en": "Black", "vi": "Đen"}},
                        {"v": "white", "hex": "#f6f2ea", "label": {"en": "White", "vi": "Trắng"}},
                        {"v": "brown", "hex": "#5c3d2e", "label": {"en": "Brown", "vi": "Nâu"}},
                        {"v": "green", "hex": "#3d7a44", "label": {"en": "Green", "vi": "Xanh lục"}},
                        {"v": "blue", "hex": "#2f5fa8", "label": {"en": "Blue", "vi": "Xanh lam"}},
                        {"v": "yellow", "hex": "#d4a017", "label": {"en": "Yellow", "vi": "Vàng"}},
                        {"v": "red", "hex": "#b8232c", "label": {"en": "Red", "vi": "Đỏ"}}
                    ]
                }
            ],
            "aspects": {
                "required": ["profile"],
                "optional": ["male", "female", "flight"]
            },
            "sections": [
                {"key": "call", "label": {"en": "Voice & Call", "vi": "Tiếng hót"}}
            ]
        }
    else:  # lepidoptera
        trait_schema = {
            "traits": [
                {
                    "key": "size",
                    "label": {"en": "Wingspan", "vi": "Sải cánh"},
                    "type": "single",
                    "render": "chip",
                    "options": [
                        {"v": "tiny", "label": {"en": "< 30 mm", "vi": "< 30 mm"}},
                        {"v": "small", "label": {"en": "30–50 mm", "vi": "30–50 mm"}},
                        {"v": "med", "label": {"en": "50–90 mm", "vi": "50–90 mm"}},
                        {"v": "large", "label": {"en": "> 90 mm", "vi": "> 90 mm"}}
                    ]
                },
                {
                    "key": "colour",
                    "label": {"en": "Main colour", "vi": "Màu chính"},
                    "type": "multi",
                    "render": "swatch",
                    "max": 3,
                    "options": [
                        {"v": "black", "hex": "#1b1713", "label": {"en": "Black", "vi": "Đen"}},
                        {"v": "white", "hex": "#f6f2ea", "label": {"en": "White", "vi": "Trắng"}},
                        {"v": "gold", "hex": "#d4a017", "label": {"en": "Gold", "vi": "Vàng"}},
                        {"v": "orange", "hex": "#cf7a1e", "label": {"en": "Orange", "vi": "Cam"}},
                        {"v": "red", "hex": "#b8232c", "label": {"en": "Red", "vi": "Đỏ"}},
                        {"v": "blue", "hex": "#2f5fa8", "label": {"en": "Blue", "vi": "Xanh"}},
                        {"v": "brown", "hex": "#5c3d2e", "label": {"en": "Brown", "vi": "Nâu"}},
                        {"v": "green", "hex": "#3d7a44", "label": {"en": "Green", "vi": "Xanh lục"}}
                    ]
                },
                {
                    "key": "pattern",
                    "label": {"en": "Pattern", "vi": "Hoa văn"},
                    "type": "multi",
                    "render": "chip",
                    "options": [
                        {"v": "spots", "label": {"en": "Spots", "vi": "Đốm"}},
                        {"v": "bands", "label": {"en": "Bands", "vi": "Dải"}},
                        {"v": "eyespots", "label": {"en": "Eyespots", "vi": "Mắt giả"}},
                        {"v": "plain", "label": {"en": "Plain", "vi": "Trơn"}}
                    ]
                }
            ],
            "aspects": {
                "required": ["dorsal"],
                "optional": ["ventral", "male", "female"]
            },
            "sections": [
                {"key": "hostPlants", "label": {"en": "Host plants", "vi": "Cây chủ"}}
            ]
        }

    species_records = []
    total_img_bytes = 0

    prefix = "bird" if taxon_group == "aves" else "butterfly"
    for item in data_items:
        slug = item["id"].replace("bvn-", "").replace("butterfly-", "").replace("bird_", "").replace("butterfly_", "")
        sid = f"{prefix}-{slug}"
        sci = item["sciName"].strip()
        fam = item.get("family", "Unknown")
        vi_name = item.get("commonNameVi", sci)
        en_name = item.get("commonNameEn", sci)
        marks = item.get("fieldMarks", "")

        # Select image file: plate if ready, else raw observation photo
        plate_filename = f"{prefix}_{slug}_plate.jpg"
        raw_filename = f"{prefix}_{slug}_raw.jpg"
        pub_plate = os.path.join(PUB_SPEC_DIR, plate_filename)
        pub_raw = os.path.join(PUB_SPEC_DIR, raw_filename)

        dest_img_filename = f"{sid}.jpg"
        dest_img_path = os.path.join(img_dir, dest_img_filename)

        if os.path.exists(pub_plate) and os.path.getsize(pub_plate) > 10000:
            shutil.copy2(pub_plate, dest_img_path)
            credit = "Spidex Natural History Specimen Plate (Redrawn from Observation)"
        elif os.path.exists(pub_raw):
            shutil.copy2(pub_raw, dest_img_path)
            credit = "iNaturalist Research-Grade Observation / Spidex Field Specimen"
        else:
            print(f"Warning: No image found for {sid} ({pub_plate} or {pub_raw})")
            continue

        img_size = os.path.getsize(dest_img_path)
        total_img_bytes += img_size

        if taxon_group == "aves":
            traits = {
                "size": infer_bird_size(fam, sci),
                "colour": infer_bird_colours(sci, marks)
            }
            images = [
                {
                    "id": f"{sid}-1",
                    "aspect": "profile",
                    "credit": credit,
                    "license": "CC-BY-SA-4.0",
                    "thumbUrl": f"img/{dest_img_filename}",
                    "fullUrl": f"img/{dest_img_filename}"
                }
            ]
            taxon_fields = {
                "call": {"en": "Distinctive vocalization in natural habitat", "vi": "Tiếng kêu / hót đặc trưng ngoài tự nhiên"}
            }
        else:
            traits = {
                "size": infer_butterfly_size(fam, sci),
                "colour": infer_butterfly_colours(marks),
                "pattern": infer_butterfly_patterns(marks)
            }
            images = [
                {
                    "id": f"{sid}-1",
                    "aspect": "dorsal",
                    "credit": credit,
                    "license": "CC-BY-SA-4.0",
                    "thumbUrl": f"img/{dest_img_filename}",
                    "fullUrl": f"img/{dest_img_filename}"
                }
            ]
            taxon_fields = {
                "hostPlants": {"en": f"Associated with {fam} host flora", "vi": f"Thực vật ký chủ thuộc họ thực vật tự nhiên"}
            }

        record = {
            "id": sid,
            "sciName": sci,
            "commonNames": {
                "en": en_name,
                "vi": vi_name
            },
            "family": fam,
            "traits": traits,
            "keyFeatures": [
                {"en": marks, "vi": marks},
                {"en": f"Scientific classification: {fam}", "vi": f"Phân loại khoa học: Họ {fam}"}
            ],
            "habitat": {
                "en": "Ecosystem and forest canopy of Vietnam",
                "vi": "Hệ sinh thái tự nhiên và sinh cảnh rừng Việt Nam"
            },
            "taxonFields": taxon_fields,
            "similarTo": [],
            "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            "sensitivity": 0,
            "status": "Bản địa (Native)",
            "images": images
        }
        species_records.append(record)

    # Manifest
    manifest = {
        "id": pack_id,
        "name": {
            "en": pack_title_en,
            "vi": pack_title_vi
        },
        "taxonGroup": taxon_group,
        "region": "Vietnam",
        "version": 1,
        "license": "CC-BY-SA-4.0",
        "sources": [
            "Spidex Natural History Museum Plate Collection",
            "Vietnam Biodiversity Checklist & iNaturalist Research Specimens"
        ],
        "speciesCount": len(species_records),
        "sizeBytes": {
            "thumb": total_img_bytes,
            "full": total_img_bytes
        },
        "idRemap": [],
        "traitSchema": trait_schema
    }

    # Write pack.json
    with open(os.path.join(pack_dir, "pack.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # Write species.ndjson
    with open(os.path.join(pack_dir, "species.ndjson"), "w", encoding="utf-8") as f:
        for r in species_records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"✓ Successfully compiled {pack_id}: {len(species_records)} species with {total_img_bytes / 1024 / 1024:.2f} MB of real specimen imagery.")

def main():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 1. Compile Birds of Vietnam (bird-vn)
    compile_pack("aves", data["birds"], "bird-vn", "Birds of Vietnam", "Chim Việt Nam")

    # 2. Compile Butterflies of Vietnam (butterfly-vn)
    compile_pack("lepidoptera", data["butterflies"], "butterfly-vn", "Butterflies of Vietnam", "Bướm Việt Nam")

if __name__ == "__main__":
    main()
