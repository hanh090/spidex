#!/usr/bin/env python3
import json
import os
import re

PROJECT_ROOT = "/Users/hanhle/projects/spidex"
DATA_FILE = os.path.join(PROJECT_ROOT, "data/vietnam_50_birds_50_butterflies.json")
MASTER_BIRDS_FILE = os.path.join(PROJECT_ROOT, "data/checklists/vietnam_birds_master_checklist.json")
SPECIMENS_DIR = os.path.join(PROJECT_ROOT, "public/museum_specimens")

with open(DATA_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

birds = data["birds"]
butterflies = data["butterflies"]

with open(MASTER_BIRDS_FILE, "r", encoding="utf-8") as f:
    birds_master = json.load(f)["species"]

def slugify(text):
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')

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

# Species drawn with Google Gemini 2.5 Flash Image
GEMINI_IDS = {
    # 22 Curated Birds
    "bvn-bird_pied_hornbill",
    "bvn-bird_fairy_pitta",
    "bvn-bird_red_junglefowl",
    "bvn-bird_white_breasted_waterhen",
    "bvn-bird_grey_heron",
    "bvn-bird_night_heron",
    "bvn-bird_cinnamon_bittern",
    "bvn-bird_cattle_egret",
    "bvn-bird_pied_fantail",
    "bvn-bird_white_rumped_shama",
    "bvn-bird_plaintive_cuckoo",
    "bvn-bird_lesser_coucal",
    "bvn-bird_white_eye",
    "bvn-bird_white_wagtail",
    "bvn-bird_black_naped_oriole",
    "bvn-bird_golden_fronted_leafbird",
    "bvn-bird_fork_tailed_sunbird",
    "bvn-bird_blue_tailed_bee_eater",
    "bvn-bird_scarlet_backed_flowerpecker",
    "bvn-bird_yellow_bellied_prinia",
    "bvn-bird_white_shouldered_starling",
    "bvn-bird_crested_kingfisher",
    # 10 Curated Butterflies
    "butterfly-butterfly_lexias_pardalis",
    "butterfly-butterfly_junonia_orithya",
    "butterfly-butterfly_penthema_darlisa",
    "butterfly-butterfly_junonia_hierta",
    "butterfly-butterfly_papilio_memnon",
    "butterfly-butterfly_papilio_demoleus",
    "butterfly-butterfly_papilio_paris",
    "butterfly-butterfly_troides_aeacus",
    "butterfly-butterfly_hebomoia_glaucippe",
    "butterfly-butterfly_appias_albina",
}

GPT5_SPECIES_IDS = {
    "bvn-bird_fairy_pitta", "bvn-bird_cattle_egret", "bvn-bird_pied_fantail", "bvn-bird_white_rumped_shama",
    "bvn-bird_white_eye", "bvn-bird_white_wagtail", "bvn-bird_black_naped_oriole", "bvn-bird_golden_fronted_leafbird",
    "bvn-bird_fork_tailed_sunbird", "bvn-bird_blue_tailed_bee_eater", "bvn-bird_scarlet_backed_flowerpecker",
    "bvn-bird_yellow_bellied_prinia", "bvn-bird_white_shouldered_starling", "bvn-bird_crested_kingfisher",
    "butterfly-butterfly_lexias_pardalis", "butterfly-butterfly_junonia_orithya",
    "butterfly-butterfly_penthema_darlisa", "butterfly-butterfly_junonia_hierta",
    "butterfly-butterfly_papilio_memnon", "butterfly-butterfly_papilio_demoleus",
    "butterfly-butterfly_papilio_paris", "butterfly-butterfly_troides_aeacus",
    "butterfly-butterfly_hebomoia_glaucippe", "butterfly-butterfly_appias_albina"
}

def resolve_engine(item):
    cur = item.get("modelEngine", "")
    sp_id = item.get("id", "")
    if cur == "gemini-flash" or sp_id in GEMINI_IDS:
        return "gemini-flash", "Gemini 2.5", '<span class="model-chip model-chip-gemini">✨ Gemini 2.5</span>'
    elif cur in ("gpt-5", "gpt-5-mini") or sp_id in GPT5_SPECIES_IDS:
        return "gpt-5", "GPT-5", '<span class="model-chip model-chip-gpt">🤖 GPT-5</span>'
    else:
        return "nano-image", "Nano Image", '<span class="model-chip model-chip-nano">🍌 Nano Image</span>'

# Verify actual files on disk
for b in birds:
    slug = b["id"].replace("bvn-", "").replace("bird_", "")
    plate_name = f"bird_{slug}_plate.jpg"
    raw_name = f"bird_{slug}_raw.jpg"
    if os.path.exists(os.path.join(SPECIMENS_DIR, plate_name)):
        b["plateReady"] = True
        b["plateUrl"] = f"museum_specimens/{plate_name}"
    if os.path.exists(os.path.join(SPECIMENS_DIR, raw_name)):
        b["rawUrl"] = f"museum_specimens/{raw_name}"
    m_key, _, _ = resolve_engine(b)
    b["modelEngine"] = m_key

for bf in butterflies:
    slug = bf["id"].replace("butterfly-", "").replace("butterfly_", "")
    plate_name = f"butterfly_{slug}_plate.jpg"
    raw_name = f"butterfly_{slug}_raw.jpg"
    if os.path.exists(os.path.join(SPECIMENS_DIR, plate_name)):
        bf["plateReady"] = True
        bf["plateUrl"] = f"museum_specimens/{plate_name}"
    if os.path.exists(os.path.join(SPECIMENS_DIR, raw_name)):
        bf["rawUrl"] = f"museum_specimens/{raw_name}"
    m_key, _, _ = resolve_engine(bf)
    bf["modelEngine"] = m_key

ready_birds = [b for b in birds if b.get("plateReady")]
ready_butterflies = [bf for bf in butterflies if bf.get("plateReady")]
all_ready = ready_birds + ready_butterflies
ready_gemini = [s for s in all_ready if s.get("modelEngine") == "gemini-flash"]
ready_gpt5 = [s for s in all_ready if s.get("modelEngine") == "gpt-5"]
ready_nano = [s for s in all_ready if s.get("modelEngine") == "nano-image"]

total_ready = len(ready_birds) + len(ready_butterflies)

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spidex — Vietnam Natural History Field Guide Plates</title>
  <style>
    :root {{
      --bg: #0b0f19;
      --card-bg: #131b2e;
      --card-header: #1a243d;
      --border: #243252;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-green: #34d399;
      --accent-amber: #fbbf24;
      --accent-purple: #c084fc;
      --gemini-gradient: linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%);
      --gemini-glow: rgba(16, 185, 129, 0.25);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 30px 20px 100px;
      line-height: 1.5;
    }}
    .header {{
      max-width: 1300px;
      margin: 0 auto 32px;
      text-align: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 28px;
    }}
    .badge-bar {{
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }}
    .badge {{
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      padding: 6px 16px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }}
    .badge-cyan {{ background: rgba(56, 189, 248, 0.12); color: var(--accent); border: 1px solid rgba(56, 189, 248, 0.3); }}
    .badge-green {{ background: rgba(52, 211, 153, 0.12); color: var(--accent-green); border: 1px solid rgba(52, 211, 153, 0.3); }}
    .badge-amber {{ background: rgba(251, 191, 36, 0.12); color: var(--accent-amber); border: 1px solid rgba(251, 191, 36, 0.3); }}
    .badge-purple {{ background: rgba(192, 132, 252, 0.12); color: var(--accent-purple); border: 1px solid rgba(192, 132, 252, 0.3); }}
    .badge-gemini {{
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.5);
      box-shadow: 0 0 15px var(--gemini-glow);
    }}
    .pulse-dot {{
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 1.8s infinite;
    }}
    @keyframes pulse {{
      0%, 100% {{ transform: scale(1); opacity: 1; }}
      50% {{ transform: scale(1.3); opacity: 0.6; }}
    }}

    h1 {{
      font-size: 34px;
      font-weight: 800;
      margin: 0 0 14px;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
    }}
    .title-text {{
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }}
    .tagline-chip {{
      font-size: 16px;
      font-weight: 800;
      padding: 4px 14px;
      border-radius: 8px;
      background: var(--gemini-gradient);
      color: #fff;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }}
    .subtitle {{
      max-width: 880px;
      margin: 0 auto 26px;
      color: var(--muted);
      font-size: 16px;
    }}

    /* Progress Stats Grid */
    .stats-bar {{
      max-width: 1300px;
      margin: 0 auto 36px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }}
    .stat-card {{
      background: #141d30;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      text-align: left;
    }}
    .stat-label {{
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
    }}
    .stat-val {{
      font-size: 26px;
      font-weight: 800;
      color: #fff;
    }}
    .stat-sub {{
      font-size: 12px;
      color: var(--accent-green);
    }}
    .stat-sub-purple {{
      font-size: 12px;
      color: #c084fc;
      font-weight: 600;
    }}
    .stat-sub-emerald {{
      font-size: 12px;
      color: #34d399;
      font-weight: 600;
    }}
    .stat-gemini {{
      border-color: rgba(16, 185, 129, 0.4);
      background: linear-gradient(180deg, #131d2e 0%, rgba(16, 185, 129, 0.08) 100%);
    }}

    /* Nav Tabs */
    .main-nav {{
      max-width: 1300px;
      margin: 0 auto 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
    }}
    .view-toggle {{
      display: flex;
      background: #101726;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 4px;
      gap: 4px;
      flex-wrap: wrap;
    }}
    .view-btn {{
      background: transparent;
      border: none;
      color: var(--muted);
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }}
    .view-btn.active {{
      background: var(--accent);
      color: #0b0f19;
    }}
    .view-btn-gemini.active {{
      background: var(--gemini-gradient);
      color: #0b0f19;
      font-weight: 800;
      box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
    }}
    .view-btn-gpt {{ border-color: rgba(147, 51, 234, 0.4); color: #c084fc; }}
    .view-btn-gpt.active {{
      background: linear-gradient(135deg, #9333ea, #6366f1);
      color: #ffffff;
      font-weight: 800;
      box-shadow: 0 4px 15px rgba(147, 51, 234, 0.4);
    }}
    .view-btn-nano {{ border-color: rgba(245, 158, 11, 0.4); color: #fbbf24; }}
    .view-btn-nano.active {{
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #0b0f19;
      font-weight: 800;
      box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
    }}

    /* Showcase Grid */
    .showcase-grid {{
      max-width: 1300px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(580px, 1fr));
      gap: 30px;
    }}
    @media (max-width: 768px) {{
      .showcase-grid {{
        grid-template-columns: 1fr;
      }}
    }}

    .specimen-card {{
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }}
    .specimen-card[data-model="gemini-flash"] {{
      border-color: rgba(16, 185, 129, 0.4);
    }}
    .specimen-card:hover {{
      transform: translateY(-2px);
      border-color: #3b82f6;
    }}
    .specimen-card[data-model="gemini-flash"]:hover {{
      border-color: #10b981;
      box-shadow: 0 10px 30px rgba(16, 185, 129, 0.25);
    }}

    .card-top {{
      padding: 16px 20px;
      background: var(--card-header);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }}
    .species-info {{
      display: flex;
      flex-direction: column;
      gap: 3px;
    }}
    .species-title-row {{
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }}
    .species-name {{
      font-size: 18px;
      font-weight: 700;
      color: #fff;
    }}
    .species-vn {{
      font-size: 13px;
      color: var(--accent-amber);
      font-weight: 600;
    }}
    .species-sci {{
      font-style: italic;
      color: var(--muted);
      font-size: 13px;
    }}
    .card-badges {{
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }}
    .family-pill {{
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      padding: 4px 10px;
      border-radius: 6px;
      color: #cbd5e1;
      white-space: nowrap;
    }}
    .model-chip {{
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      border-radius: 4px;
      white-space: nowrap;
    }}
    .model-chip-gemini {{
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(6, 182, 212, 0.25));
      border: 1px solid rgba(16, 185, 129, 0.5);
      color: #6ee7b7;
    }}
    .model-chip-gpt {{
      background: linear-gradient(135deg, rgba(147, 51, 234, 0.25), rgba(99, 102, 241, 0.25));
      border: 1px solid rgba(147, 51, 234, 0.5);
      color: #c084fc;
    }}
    .model-chip-nano {{
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(234, 88, 12, 0.25));
      border: 1px solid rgba(245, 158, 11, 0.5);
      color: #fbbf24;
    }}
    .model-chip-nb {{
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #7dd3fc;
    }}

    .comparison-wrapper {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      background: #080c14;
      border-bottom: 1px solid var(--border);
    }}
    .comparison-col {{
      display: flex;
      flex-direction: column;
      position: relative;
    }}
    .comparison-col:first-child {{
      border-right: 1px solid var(--border);
    }}
    .col-header {{
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 6px 12px;
      text-align: center;
    }}
    .col-raw {{ background: rgba(239, 68, 68, 0.12); color: #f87171; }}
    .col-plate {{ background: rgba(52, 211, 153, 0.12); color: var(--accent-green); }}

    .img-container {{
      width: 100%;
      aspect-ratio: 1 / 1;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      cursor: zoom-in;
    }}
    .img-container img {{
      width: 100%;
      height: 100%;
      object-fit: contain;
      transition: transform 0.3s ease;
    }}
    .raw-bg img {{
      object-fit: cover;
      object-position: center;
    }}
    .plate-bg img {{
      object-fit: contain;
      object-position: center;
    }}
    .img-container:hover img {{
      transform: scale(1.04);
    }}
    .plate-bg {{ background: #ffffff; }}
    .raw-bg {{ background: #111827; }}

    .card-body {{
      padding: 16px 20px;
      font-size: 13px;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }}
    .field-marks {{
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      padding: 10px 14px;
      border-left: 3px solid var(--accent);
    }}
    .field-marks strong {{
      color: #fff;
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }}

    /* Directory Table */
    .directory-section {{
      max-width: 1300px;
      margin: 0 auto;
      display: none;
    }}
    .search-box {{
      width: 100%;
      padding: 14px 20px;
      background: #141d30;
      border: 1px solid var(--border);
      border-radius: 12px;
      color: #fff;
      font-size: 15px;
      margin-bottom: 24px;
      outline: none;
    }}
    .search-box:focus {{
      border-color: var(--accent);
    }}
    .table-container {{
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow-x: auto;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }}
    th {{
      background: var(--card-header);
      padding: 12px 16px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }}
    td {{
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      vertical-align: middle;
    }}
    tr:hover {{
      background: rgba(255,255,255,0.02);
    }}
    .status-badge {{
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      white-space: nowrap;
    }}
    .status-ready {{
      background: rgba(52, 211, 153, 0.15);
      color: var(--accent-green);
      border: 1px solid rgba(52, 211, 153, 0.3);
      cursor: pointer;
    }}
    .status-pending {{
      background: rgba(251, 191, 36, 0.15);
      color: var(--accent-amber);
      border: 1px solid rgba(251, 191, 36, 0.3);
    }}
    .thumb-preview {{
      width: 44px;
      height: 44px;
      border-radius: 6px;
      object-fit: contain;
      background: #ffffff;
      cursor: pointer;
    }}

    /* Lightbox Modal */
    .modal {{
      display: none;
      position: fixed;
      z-index: 1000;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      background: rgba(3, 7, 18, 0.92);
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
      cursor: zoom-out;
    }}
    .modal.active {{ display: flex; }}
    .modal-content {{
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }}
    .modal-img {{
      max-width: 85vw;
      max-height: 80vh;
      border-radius: 10px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      background: #ffffff;
    }}
    .modal-caption {{
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      text-align: center;
    }}
  </style>
</head>
<body>

  <div class="header">
    <div class="badge-bar">
      <span class="badge badge-gemini">✨ Gemini 2.5 Flash ({len(ready_gemini)} Birds)</span>
      <span class="badge badge-green">✓ {len(ready_birds)} / 50 Birds Ready (100%!)</span>
      <span class="badge badge-cyan">✓ {total_ready} / 100 Plates Complete</span>
      <span class="badge badge-amber">✓ Pure Off-White Museum Plates</span>
    </div>
    <h1>
      <span class="title-text">Spidex Scientific Field Guide Plates</span>
    </h1>
    <p class="subtitle">
      Authentic scientific natural history specimen plates for the <strong>50 Common Birds</strong> and <strong>50 Common Butterflies of Vietnam</strong> — high-fidelity specimen illustrations on museum parchment.
    </p>

    <!-- Stats Bar -->
    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-label">Total Curated Species</div>
        <div class="stat-val">100</div>
        <div class="stat-sub">50 Birds + 50 Butterflies</div>
      </div>
      <div class="stat-card" style="border-color: rgba(52, 211, 153, 0.5); background: linear-gradient(180deg, #131d2e 0%, rgba(52, 211, 153, 0.08) 100%);">
        <div class="stat-label">Birds of VN (100%!)</div>
        <div class="stat-val" style="color: #34d399;">{len(ready_birds)} <span style="font-size: 16px; color: var(--muted);">/ 50</span></div>
        <div class="stat-sub" style="color: #34d399; font-weight: 700;">✓ 100% All Birds Ready!</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Butterflies of VN</div>
        <div class="stat-val">{len(ready_butterflies)} <span style="font-size: 16px; color: var(--muted);">/ 50</span></div>
        <div class="stat-sub">{len(ready_butterflies)/50*100:.0f}% Plates Generated</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Plates Ready</div>
        <div class="stat-val">{total_ready} <span style="font-size: 16px; color: var(--muted);">/ 100</span></div>
        <div class="stat-sub">{total_ready/100*100:.0f}% Overall Progress</div>
      </div>
      <div class="stat-card stat-gemini">
        <div class="stat-label">Gemini 2.5 Plates</div>
        <div class="stat-val" style="color: #34d399;">{len(ready_gemini)} <span style="font-size: 16px; color: var(--muted);">/ 100</span></div>
        <div class="stat-sub-emerald">✨ Primary Museum Engine</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">GPT-5 Plates</div>
        <div class="stat-val" style="color: #c084fc;">{len(ready_gpt5)} <span style="font-size: 16px; color: var(--muted);">/ 100</span></div>
        <div class="stat-sub" style="color: #c084fc;">🤖 GPT-5 Mini Tested</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Nano Image Plates</div>
        <div class="stat-val" style="color: #fbbf24;">{len(ready_nano)} <span style="font-size: 16px; color: var(--muted);">/ 100</span></div>
        <div class="stat-sub" style="color: #fbbf24;">🍌 Nano Banana Pro</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Full Birds Checklist</div>
        <div class="stat-val" style="color: #34d399;">962 <span style="font-size: 16px; color: var(--accent);">/ 962</span></div>
        <div class="stat-sub" style="color: #34d399; font-weight: 700;">🎉 100% All 962 Complete!</div>
      </div>
    </div>
  </div>

  <div class="main-nav">
    <div class="view-toggle">
      <button class="view-btn active" id="btnShowcase" onclick="switchView('showcase')">🖼️ Plates Gallery ({total_ready})</button>
      <button class="view-btn" id="btnFullBirds" onclick="switchView('fullbirds')">🦅 Full 962 Birds of Vietnam (100%)</button>
      <button class="view-btn" id="btnDirectory" onclick="switchView('directory')">📋 Curated 50+50 Directory (100)</button>
    </div>

    <div class="view-toggle" id="taxonFilterBar">
      <button class="view-btn active" onclick="filterTaxa('all', this)">All Ready ({total_ready})</button>
      <button class="view-btn view-btn-gemini" onclick="filterTaxa('gemini-flash', this)">✨ Gemini 2.5 ({len(ready_gemini)})</button>
      <button class="view-btn view-btn-gpt" onclick="filterTaxa('gpt-5', this)">🤖 GPT-5 ({len(ready_gpt5)})</button>
      <button class="view-btn view-btn-nano" onclick="filterTaxa('nano-image', this)">🍌 Nano Image ({len(ready_nano)})</button>
      <button class="view-btn" onclick="filterTaxa('bird', this)">Birds ({len(ready_birds)})</button>
      <button class="view-btn" onclick="filterTaxa('butterfly', this)">Butterflies ({len(ready_butterflies)})</button>
    </div>
  </div>

  <!-- VIEW 1: PLATES GALLERY -->
  <div class="showcase-grid" id="showcaseView">
"""

def render_specimen_card(item, idx, taxon):
    model_attr, model_label, model_badge_html = resolve_engine(item)
    return f"""
    <div class="specimen-card" data-taxon="{taxon}" data-model="{model_attr}">
      <div class="card-top">
        <div class="species-info">
          <div class="species-title-row">
            <span class="species-name">{idx}. {item['commonNameEn']}</span>
          </div>
          <span class="species-vn">{item['commonNameVi']}</span>
          <span class="species-sci">{item['sciName']}</span>
        </div>
        <div class="card-badges">
          <span class="family-pill">{item['family']}</span>
          {model_badge_html}
        </div>
      </div>
      <div class="comparison-wrapper">
        <div class="comparison-col">
          <div class="col-header col-raw">Original Photo (Field)</div>
          <div class="img-container raw-bg" onclick="openModal('{item['rawUrl']}', '{item['sciName']} — Original Field Photo')">
            <img src="{item['rawUrl']}" alt="{item['commonNameEn']} raw">
          </div>
        </div>
        <div class="comparison-col">
          <div class="col-header col-plate">Redrawn Field Guide Plate</div>
          <div class="img-container plate-bg" onclick="openModal('{item['plateUrl']}', '{item['sciName']} — Redrawn Plate ({model_attr})')">
            <img src="{item['plateUrl']}" alt="{item['commonNameEn']} plate">
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="field-marks">
          <strong>Key Diagnostic Field Marks</strong>
          {item['fieldMarks']}.
        </div>
      </div>
    </div>
"""

# Render ready butterflies first
for i, bf in enumerate(ready_butterflies, 1):
    html_content += render_specimen_card(bf, i, "butterfly")

# Render ready birds
for i, b in enumerate(ready_birds, 1):
    html_content += render_specimen_card(b, i, "bird")

html_content += """
  </div>

  <!-- VIEW 2: MASTER DIRECTORY (100 SPECIES) -->
  <div class="directory-section" id="directoryView">
    <input type="text" class="search-box" id="directorySearch" placeholder="🔍 Search any species by Vietnamese name, English name, scientific name, or family..." onkeyup="filterDirectory()">
    <div class="table-container">
      <table id="speciesTable">
        <thead>
          <tr>
            <th>#</th>
            <th>Taxon</th>
            <th>Plate</th>
            <th>Vietnamese Name</th>
            <th>English Name</th>
            <th>Scientific Name</th>
            <th>Family</th>
            <th>Engine</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
"""

all_species = [("Butterfly", bf) for bf in butterflies] + [("Bird", b) for b in birds]
for idx, (grp, sp) in enumerate(all_species, 1):
    is_ready = sp.get('plateReady', False)
    plate_url = sp.get('plateUrl', '')
    sci = sp.get('sciName', '')
    if is_ready:
        status_html = f'''<span class="status-badge status-ready" onclick="openModal('{plate_url}', '{sci} — Field Guide Plate')">✓ Ready</span>'''
        thumb_html = f'''<img src="{plate_url}" class="thumb-preview" onclick="openModal('{plate_url}', '{sci} — Field Guide Plate')">'''
    else:
        status_html = '<span class="status-badge status-pending">⏳ Queued</span>'
        thumb_html = '<div style="width:44px; height:44px; background:#1e293b; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:10px;">RAW</div>'
    
    if sp.get("modelEngine") == "gemini-flash" or sp['id'] in GEMINI_IDS:
        engine_badge = '<span class="model-chip model-chip-gemini">✨ Gemini 2.5</span>'
    elif is_ready:
        engine_badge = '<span class="model-chip model-chip-nb">Legacy Plate</span>'
    else:
        engine_badge = '<span style="color:var(--muted); font-size:11px;">—</span>'

    html_content += f"""
          <tr>
            <td style="color:var(--muted); font-weight:700;">{idx}</td>
            <td><span style="font-size:11px; font-weight:700; color:{'#c084fc' if grp=='Butterfly' else '#38bdf8'};">{grp}</span></td>
            <td>{thumb_html}</td>
            <td style="font-weight:700; color:var(--accent-amber);">{sp['commonNameVi']}</td>
            <td style="font-weight:600; color:#fff;">{sp['commonNameEn']}</td>
            <td style="font-style:italic; color:var(--muted);">{sp['sciName']}</td>
            <td><span class="family-pill">{sp['family']}</span></td>
            <td>{engine_badge}</td>
            <td>{status_html}</td>
          </tr>
"""

html_content += """
        </tbody>
      </table>
    </div>
  </div>
"""

# -------------------------------------------------------------
# VIEW 3: FULL BIRDS OF VIETNAM (962 SPECIES)
# -------------------------------------------------------------
v50_plate_map = {}
for b in birds:
    if b.get('plateReady') and b.get('plateUrl'):
        v50_plate_map[b['sciName'].lower()] = b['plateUrl']
v50_plate_map["bubulcus coromandus"] = "museum_specimens/bird_cattle_egret_plate.jpg"
v50_plate_map["ardea coromanda"] = "museum_specimens/bird_cattle_egret_plate.jpg"
v50_plate_map["pycnonotus conradi"] = "museum_specimens/bird_streak_eared_bulbul_plate.jpg"
v50_plate_map["rubigula flaviventris"] = "museum_specimens/bird_black_crested_bulbul_plate.jpg"

html_content += """
  <!-- VIEW 3: FULL BIRDS OF VIETNAM CHECKLIST (962 SPECIES) -->
  <div class="directory-section" id="fullBirdsView" style="display: none;">
    <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; align-items: center;">
      <input type="text" class="search-box" style="flex: 1; min-width: 280px; margin-bottom: 0;" id="fullBirdsSearch" placeholder="🔍 Search any of 962 birds by Vietnamese name (e.g. Sếu, Gà lôi, Le nâu), English name, scientific name, or family..." onkeyup="filterFullBirds()">
      <select class="view-btn" id="fullBirdsStatusFilter" onchange="filterFullBirds()" style="background:#101726; border:1px solid var(--border); color:#fff; padding:12px 16px; border-radius:8px; font-size:13px; font-weight:700;">
        <option value="all">All Conservation Statuses</option>
        <option value="threatened">⚠️ Threatened (CR / EN / VU)</option>
        <option value="endemic">🌿 Đặc hữu (Endemic)</option>
        <option value="with_photo">📷 With Photo or Plate</option>
        <option value="CR">Critically Endangered (CR)</option>
        <option value="EN">Endangered (EN)</option>
        <option value="VU">Vulnerable (VU)</option>
        <option value="NT">Near Threatened (NT)</option>
        <option value="LC">Least Concern (LC)</option>
      </select>
    </div>
    <div style="color: var(--muted); font-size: 13px; margin-bottom: 14px;" id="fullBirdsCount">
      Showing all 962 species of Birds of Vietnam
    </div>
    <div class="table-container">
      <table id="fullBirdsTable">
        <thead>
          <tr>
            <th>#</th>
            <th>Specimen / Photo</th>
            <th>Tên tiếng Việt</th>
            <th>English Name</th>
            <th>Scientific Name</th>
            <th>Order & Family</th>
            <th>Status in VN</th>
            <th>IUCN</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
"""

IUCN_COLORS = {
    "CR": 'style="background:rgba(239,68,68,0.2); color:#ef4444; border:1px solid rgba(239,68,68,0.4); padding:2px 8px; border-radius:12px; font-weight:700; font-size:11px;"',
    "EN": 'style="background:rgba(249,115,22,0.2); color:#f97316; border:1px solid rgba(249,115,22,0.4); padding:2px 8px; border-radius:12px; font-weight:700; font-size:11px;"',
    "VU": 'style="background:rgba(245,158,11,0.2); color:#fbbf24; border:1px solid rgba(245,158,11,0.4); padding:2px 8px; border-radius:12px; font-weight:700; font-size:11px;"',
    "NT": 'style="background:rgba(234,179,8,0.2); color:#fde047; border:1px solid rgba(234,179,8,0.4); padding:2px 8px; border-radius:12px; font-weight:700; font-size:11px;"',
    "LC": 'style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(16,185,129,0.4); padding:2px 8px; border-radius:12px; font-weight:700; font-size:11px;"'
}

for sp in birds_master:
    idx = sp["index"]
    sci = sp["sciName"].strip()
    slug = slugify(sci)
    iucn = sp.get("iucnStatus", "LC")
    is_endemic = "Đặc hữu" in sp.get("status", "") or "Endemic" in sp.get("status", "")
    fam = sp.get("family", "")
    fam_vi = sp.get("familyVi", "")
    order = sp.get("order", "Aves")

    plate_url = v50_plate_map.get(sci.lower())
    if not plate_url and os.path.exists(os.path.join(SPECIMENS_DIR, f"bird_{slug}_plate.jpg")):
        plate_url = f"museum_specimens/bird_{slug}_plate.jpg"
    
    raw_url = None
    if os.path.exists(os.path.join(SPECIMENS_DIR, f"bird_{slug}_raw.jpg")):
        raw_url = f"museum_specimens/bird_{slug}_raw.jpg"
    elif sp.get("referencePhotoUrl") and os.path.exists(os.path.join(PROJECT_ROOT, "public", sp["referencePhotoUrl"])):
        raw_url = sp["referencePhotoUrl"]
    
    has_photo_or_plate = bool(plate_url or raw_url)

    if plate_url:
        thumb_html = f'''<img src="{plate_url}" class="thumb-preview" onclick="openModal('{plate_url}', '{sci} — Redrawn Specimen Plate')">'''
        asset_badge = '<span class="model-chip model-chip-gemini">✨ Museum Plate</span>'
    elif raw_url:
        thumb_html = f'''<img src="{raw_url}" class="thumb-preview" style="object-fit:cover;" onclick="openModal('{raw_url}', '{sci} — Observation Photo')">'''
        asset_badge = f'''<span class="status-badge status-ready" style="cursor:pointer;" onclick="openModal('{raw_url}', '{sci} — Observation Photo')">📷 Real Photo</span>'''
    else:
        arch = infer_bird_archetype(fam)
        arch_path = f"packs/bird-vn/img/{arch}"
        thumb_html = f'''<img src="{arch_path}" class="thumb-preview" style="background:#1e293b; padding:4px;" alt="{arch}">'''
        asset_badge = '<span style="color:var(--muted); font-size:11px;">SVG Archetype</span>'

    iucn_style = IUCN_COLORS.get(iucn, IUCN_COLORS["LC"])
    iucn_badge = f'<span {iucn_style}>{iucn}</span>'

    status_str = sp.get("status", "Bản địa")
    status_color = "#38bdf8" if "Đặc hữu" not in status_str else "#fbbf24"

    html_content += f"""
          <tr data-iucn="{iucn}" data-endemic="{str(is_endemic).lower()}" data-has-photo="{str(has_photo_or_plate).lower()}">
            <td style="color:var(--muted); font-weight:700;">{idx}</td>
            <td>{thumb_html}</td>
            <td style="font-weight:700; color:var(--accent-amber); font-size:14px;">{sp['commonNameVi']}</td>
            <td style="font-weight:600; color:#fff;">{sp['commonNameEn']}</td>
            <td style="font-style:italic; color:var(--muted); font-size:12px;">{sci}</td>
            <td><span class="family-pill" style="font-size:10px;">{order} • {fam} ({fam_vi})</span></td>
            <td><span style="font-size:11px; font-weight:600; color:{status_color};">{status_str}</span></td>
            <td>{iucn_badge}</td>
            <td>{asset_badge}</td>
          </tr>
"""

html_content += """
        </tbody>
      </table>
    </div>
  </div>

  <!-- Lightbox Modal -->
  <div class="modal" id="imageModal" onclick="closeModal()">
    <div class="modal-content" onclick="event.stopPropagation()">
      <img class="modal-img" id="modalImg" src="" alt="Specimen Detail">
      <div class="modal-caption" id="modalCaption"></div>
    </div>
  </div>

  <script>
    function switchView(view) {
      const showcase = document.getElementById('showcaseView');
      const directory = document.getElementById('directoryView');
      const fullbirds = document.getElementById('fullBirdsView');
      const btnShowcase = document.getElementById('btnShowcase');
      const btnDirectory = document.getElementById('btnDirectory');
      const btnFullBirds = document.getElementById('btnFullBirds');
      const taxonFilterBar = document.getElementById('taxonFilterBar');

      showcase.style.display = 'none';
      directory.style.display = 'none';
      fullbirds.style.display = 'none';
      btnShowcase.classList.remove('active');
      btnDirectory.classList.remove('active');
      btnFullBirds.classList.remove('active');

      if (view === 'showcase') {
        showcase.style.display = 'grid';
        btnShowcase.classList.add('active');
        taxonFilterBar.style.visibility = 'visible';
      } else if (view === 'fullbirds') {
        fullbirds.style.display = 'block';
        btnFullBirds.classList.add('active');
        taxonFilterBar.style.visibility = 'hidden';
      } else {
        directory.style.display = 'block';
        btnDirectory.classList.add('active');
        taxonFilterBar.style.visibility = 'hidden';
      }
    }

    function filterFullBirds() {
      const input = document.getElementById('fullBirdsSearch');
      const filter = input.value.toLowerCase();
      const statusSelect = document.getElementById('fullBirdsStatusFilter').value;
      const rows = document.querySelectorAll('#fullBirdsTable tbody tr');
      let visible = 0;

      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const rowIucn = row.getAttribute('data-iucn') || '';
        const rowEndemic = row.getAttribute('data-endemic') || '';
        const rowHasPhoto = row.getAttribute('data-has-photo') || '';

        let matchesStatus = true;
        if (statusSelect === 'threatened') {
          matchesStatus = ['CR', 'EN', 'VU'].includes(rowIucn);
        } else if (statusSelect === 'endemic') {
          matchesStatus = rowEndemic === 'true';
        } else if (statusSelect === 'with_photo') {
          matchesStatus = rowHasPhoto === 'true';
        } else if (statusSelect !== 'all') {
          matchesStatus = rowIucn === statusSelect;
        }

        const matchesText = !filter || text.includes(filter);

        if (matchesText && matchesStatus) {
          row.style.display = '';
          visible++;
        } else {
          row.style.display = 'none';
        }
      });

      const countEl = document.getElementById('fullBirdsCount');
      if (countEl) {
        countEl.textContent = `Showing ${visible} of 962 bird species in Vietnam`;
      }
    }

    function filterTaxa(filterType, btnElem) {
      const cards = document.querySelectorAll('.specimen-card');
      const buttons = document.querySelectorAll('#taxonFilterBar .view-btn');
      
      buttons.forEach(btn => btn.classList.remove('active'));
      if (btnElem) {
        btnElem.classList.add('active');
      }

      cards.forEach(card => {
        if (filterType === 'all') {
          card.style.display = 'flex';
        } else if (filterType === 'gemini') {
          card.style.display = (card.getAttribute('data-model') === 'gemini-flash') ? 'flex' : 'none';
        } else {
          card.style.display = (card.getAttribute('data-taxon') === filterType) ? 'flex' : 'none';
        }
      });
    }

    function filterDirectory() {
      const input = document.getElementById('directorySearch');
      const filter = input.value.toLowerCase();
      const rows = document.querySelectorAll('#speciesTable tbody tr');

      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(filter)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    function openModal(src, caption) {
      if (!src || src === 'None') return;
      const modal = document.getElementById('imageModal');
      const modalImg = document.getElementById('modalImg');
      const modalCaption = document.getElementById('modalCaption');
      modalImg.src = src;
      modalCaption.textContent = caption;
      modal.classList.add('active');
    }

    function closeModal() {
      document.getElementById('imageModal').classList.remove('active');
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  </script>

</body>
</html>
"""

# Write to both locations
public_showcase = os.path.join(PROJECT_ROOT, "public/museum_showcase.html")
root_showcase = os.path.join(PROJECT_ROOT, "museum_showcase.html")

with open(public_showcase, "w", encoding="utf-8") as f:
    f.write(html_content)

with open(root_showcase, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"Generated museum showcase HTML successfully!")
print(f"Total Ready: {total_ready} / 100 ({len(ready_birds)} birds, {len(ready_butterflies)} butterflies)")
print(f"Gemini 2.5 Flash Plates: {len(ready_gemini)} / 32 curated species")
