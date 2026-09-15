#!/usr/bin/env python3
"""Render the Odonata specimen plates as a raw-vs-drawn HTML preview page."""
import json
import os
import html

DATA = "data/dragonfly_specimens.json"
OUT_HTML = "public/dragonfly_preview.html"


def main():
    with open(DATA, "r", encoding="utf-8") as fh:
        species = json.load(fh)

    cards = []
    for item in species:
        slug = item["sciName"].lower().replace(" ", "_")
        raw = f"museum_specimens/dragonfly_{slug}_raw.jpg"
        plate = f"museum_specimens/dragonfly_{slug}_plate.jpg"
        # Surface the photo licence: cc-by-nc and all-rights-reserved sources
        # are not safe for commercial reuse.
        lic = (item.get("license") or "all rights reserved").upper()
        commercial_ok = (item.get("license") or "") in ("cc0", "cc-by", "cc-by-sa")
        lic_class = "lic ok" if commercial_ok else "lic warn"
        credit = item.get("attribution") or "iNaturalist"
        cards.append(
            '<section class="card">'
            '<header class="card-head">'
            f'<div><h2>{html.escape(item["commonNameEn"])}</h2>'
            f'<p class="vi">{html.escape(item["commonNameVi"])}</p>'
            f'<p class="sci">{html.escape(item["sciName"])}</p></div>'
            f'<span class="{lic_class}">{html.escape(lic)}</span>'
            '</header>'
            f'<p class="marks"><strong>Field marks</strong> {html.escape(item["fieldMarks"])}</p>'
            '<div class="pair">'
            f'<figure class="cell cell--raw"><img src="{html.escape(raw)}" alt="Field photo of {html.escape(item["sciName"])}" loading="lazy">'
            '<figcaption>Original photo (field)</figcaption></figure>'
            f'<figure class="cell cell--plate"><img src="{html.escape(plate)}" alt="Specimen plate of {html.escape(item["sciName"])}" loading="lazy">'
            '<figcaption>Redrawn specimen plate</figcaption></figure>'
            '</div>'
            f'<p class="credit">{html.escape(credit)} &middot; {html.escape(item.get("source", "iNaturalist"))}</p>'
            '</section>'
        )

    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dragonfly Plates &mdash; Spidex</title>
<style>
:root {{
  --bg:#0b1220; --panel:#121c2e; --panel-2:#16223a; --line:#24334f;
  --ink:#e8eefc; --muted:#93a4c4; --accent:#4ade80; --warn:#f59e0b; --danger:#f87171;
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
.wrap{{max-width:1180px;margin:0 auto;padding:40px 24px 80px}}
h1{{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}}
.sub{{color:var(--muted);margin:0 0 28px;max-width:70ch}}
.card{{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:18px;margin-bottom:22px}}
.card-head{{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}}
.card-head h2{{margin:0;font-size:20px}}
.vi{{margin:2px 0 0;color:var(--warn);font-size:13px}}
.sci{{margin:1px 0 0;color:var(--muted);font-style:italic;font-size:13px}}
.lic{{font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:5px 9px;
  border-radius:6px;white-space:nowrap;border:1px solid var(--line)}}
.lic.ok{{color:var(--accent);border-color:#265c3c}}
.lic.warn{{color:var(--danger);border-color:#5c2626}}
.marks{{margin:12px 0 16px;font-size:13px;color:#c3d0e8;
  border-left:3px solid var(--accent);padding-left:12px}}
.marks strong{{color:var(--accent);font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;display:block;margin-bottom:2px}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}
.cell{{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;
  display:flex;flex-direction:column;background:#fff}}
.cell--raw{{background:#0f1726}}
.cell img{{width:100%;aspect-ratio:1/1;object-fit:contain;display:block}}
.cell--raw img{{object-fit:cover}}
figcaption{{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--muted);background:var(--panel-2);padding:7px 8px;text-align:center}}
.credit{{margin:12px 0 0;font-size:11px;color:#6f84ab}}
@media (max-width:760px){{ .pair{{grid-template-columns:1fr}} }}
</style></head>
<body><div class="wrap">
<h1>Dragonfly specimen plates</h1>
<p class="sub">Three of the most common Vietnamese Odonata, drawn through the
<code>spidex:specimen-plate</code> skill on the new dragonfly branch
(<code>microsoft/mai-image-2.6-flash</code>, ~$0.023 each). Left is the original
iNaturalist field photo, right is the redrawn plate. The badge is the photo licence:
red means it is not cleared for commercial reuse.</p>
{"".join(cards)}
</div></body></html>
"""
    os.makedirs(os.path.dirname(OUT_HTML), exist_ok=True)
    with open(OUT_HTML, "w", encoding="utf-8") as fh:
        fh.write(doc)
    print(f"Wrote {OUT_HTML} ({len(doc)} bytes, {len(species)} species)")


if __name__ == "__main__":
    main()
