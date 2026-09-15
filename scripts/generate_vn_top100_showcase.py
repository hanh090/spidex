#!/usr/bin/env python3
"""Render the Vietnam top-100 set as a browsable raw-vs-plate showcase."""
import html
import json
import os

DATA = "data/vietnam_top100_common.json"
OUT = "public/vn_top100.html"

OPEN_LICENSES = ("cc0", "cc-by", "cc-by-sa")


def cards(entries):
    out = []
    for e in entries:
        raw = f"museum_specimens/{os.path.basename(e['rawUrl'])}"
        plate = f"museum_specimens/{os.path.basename(e['plateUrl'])}"
        placeholder = e.get("plateSource") == "placeholder"
        lic = (e.get("license") or "no open licence").upper()
        lic_cls = "lic ok" if (e.get("license") in OPEN_LICENSES) else "lic warn"
        marks = e.get("fieldMarks") or ""
        out.append(
            '<article class="card">'
            '<header>'
            f'<span class="rank">#{e["index"]}</span>'
            f'<div class="names"><h3>{html.escape(e["commonNameEn"])}</h3>'
            f'<p class="sci">{html.escape(e["sciName"])}</p></div>'
            f'<span class="obs" title="research-grade observations in Vietnam">{e["observations"]:,}</span>'
            '</header>'
            '<div class="pair">'
            + (f'<figure><img src="{html.escape(raw)}" loading="lazy" alt="Field photo"><figcaption>photo</figcaption></figure>'
               if not placeholder else
               '<figure class="none"><div class="nobox">no open-licence photo</div><figcaption>photo</figcaption></figure>')
            + f'<figure class="{"ph" if placeholder else ""}"><img src="{html.escape(plate)}" loading="lazy" alt="Specimen plate">'
              f'<figcaption>{"placeholder" if placeholder else "plate"}</figcaption></figure>'
            '</div>'
            + (f'<p class="marks">{html.escape(marks)}</p>' if marks else '<p class="marks dim">no field marks &mdash; drawn from photo alone</p>')
            + f'<footer><span class="{lic_cls}">{html.escape(lic)}</span></footer>'
            '</article>'
        )
    return "".join(out)


def main():
    with open(DATA, "r", encoding="utf-8") as fh:
        d = json.load(fh)
    bf, bd = d["butterflies"], d["birds"]
    total = len(bf) + len(bd)
    ph = sum(1 for g in (bf, bd) for e in g if e.get("plateSource") == "placeholder")
    marks = sum(1 for g in (bf, bd) for e in g if e.get("fieldMarks"))

    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vietnam Top 100 &mdash; Spidex</title>
<style>
:root{{--bg:#0b1220;--panel:#121c2e;--panel2:#16223a;--line:#24334f;
--ink:#e8eefc;--muted:#93a4c4;--accent:#4ade80;--warn:#f59e0b;--danger:#f87171}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
.wrap{{max-width:1500px;margin:0 auto;padding:36px 20px 70px}}
h1{{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}}
.sub{{color:var(--muted);margin:0 0 20px;max-width:76ch}}
.stats{{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:28px}}
.stat{{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:9px 13px}}
.stat b{{display:block;font-size:19px}}
.stat span{{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}}
h2{{font-size:19px;margin:30px 0 14px;padding-bottom:7px;border-bottom:1px solid var(--line)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}}
.card{{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:12px;
display:flex;flex-direction:column}}
.card header{{display:flex;align-items:flex-start;gap:8px;margin-bottom:9px}}
.rank{{font-size:10px;color:var(--muted);background:var(--panel2);border:1px solid var(--line);
padding:2px 6px;border-radius:5px;flex:none}}
.names{{flex:1;min-width:0}}
.names h3{{margin:0;font-size:14px;line-height:1.25}}
.sci{{margin:1px 0 0;font-style:italic;font-size:11.5px;color:var(--muted)}}
.obs{{font-size:11px;color:var(--accent);flex:none}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:7px}}
figure{{margin:0;border:1px solid var(--line);border-radius:7px;overflow:hidden;background:#fff}}
figure img{{width:100%;aspect-ratio:1/1;object-fit:contain;display:block}}
figure:first-child img{{object-fit:cover}}
figure.ph{{background:#0f1726}}
figure.none{{background:var(--panel2)}}
.nobox{{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;
text-align:center;font-size:10px;color:#6f84ab;padding:8px}}
figcaption{{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);
background:var(--panel2);padding:4px;text-align:center}}
.marks{{margin:9px 0 0;font-size:11.5px;color:#c3d0e8;line-height:1.4}}
.marks.dim{{color:#5f7093;font-style:italic}}
.card footer{{margin-top:auto;padding-top:9px}}
.lic{{font-size:9px;letter-spacing:.09em;text-transform:uppercase;padding:3px 7px;
border-radius:5px;border:1px solid var(--line)}}
.lic.ok{{color:var(--accent);border-color:#265c3c}}
.lic.warn{{color:var(--danger);border-color:#5c2626}}
</style></head><body><div class="wrap">
<h1>Vietnam &mdash; 100 most-observed species</h1>
<p class="sub">Top 50 butterflies and top 50 birds, ranked by research-grade iNaturalist
observation counts inside Vietnam. Every plate drawn by
<code>microsoft/mai-image-2.6-flash</code> through the <code>spidex:specimen-plate</code>
skill from an openly licensed reference photo.</p>
<div class="stats">
<div class="stat"><b>{total}</b><span>species</span></div>
<div class="stat"><b>{total-ph}</b><span>drawn plates</span></div>
<div class="stat"><b>{ph}</b><span>placeholder</span></div>
<div class="stat"><b>{marks}</b><span>with field marks</span></div>
<div class="stat"><b>$2.24</b><span>total cost</span></div>
</div>
<h2>Butterflies &mdash; top {len(bf)}</h2><div class="grid">{cards(bf)}</div>
<h2>Birds &mdash; top {len(bd)}</h2><div class="grid">{cards(bd)}</div>
</div></body></html>
"""
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(doc)
    print(f"Wrote {OUT} ({len(doc)//1024} KB, {total} species, {ph} placeholder)")


if __name__ == "__main__":
    main()
