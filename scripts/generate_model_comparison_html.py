#!/usr/bin/env python3
"""Render the cross-model plate comparison as a standalone HTML page."""
import json
import os
import html

RESULT_JSON = "data/model_comparison_results.json"
OUT_HTML = "public/model_comparison.html"

# Short positioning line shown under each model column header.
TAGLINES = {
    "gemini-2.5-flash": "The incumbent — fast, cheap, drew all 100 production plates.",
    "gpt-image-2": "Photoreal discipline; reads specimen texture before it draws.",
    "gpt-5-image": "Reasoning-led rendering, tighter prompt adherence.",
    "mai-image-2.6-flash": "Latency-first diffusion; near-precision quality at flash cost.",
    "gemini-3-pro-image": "Top Google tier; maximum fidelity, maximum price.",
}

BASELINE = {
    "key": "gemini-2.5-flash",
    "label": "Gemini 2.5 Flash",
    "vendor": "Google",
    "slug": "google/gemini-2.5-flash-image",
}


def money(value):
    return f"${value:.4f}" if value else "—"


def main():
    with open(RESULT_JSON, "r", encoding="utf-8") as fh:
        payload = json.load(fh)

    models = payload["models"]
    species = payload["species"]
    results = payload["results"]

    # Show every model that was attempted; failures render as an explained gap
    # so a blocked model stays visible in the comparison instead of vanishing.
    attempted = [m for m in models if results.get(m["key"])]
    columns = [BASELINE] + attempted

    rows = []
    for item in species:
        sci = item["sciName"]
        cells = []
        for model in columns:
            if model["key"] == BASELINE["key"]:
                src = os.path.basename(item["plateUrl"])
                cells.append(
                    f'<figure class="cell">'
                    f'<img src="museum_specimens/{html.escape(src)}" alt="{html.escape(sci)} by {html.escape(model["label"])}" loading="lazy">'
                    f'<figcaption class="meta">baseline plate</figcaption></figure>'
                )
                continue
            entry = results.get(model["key"], {}).get(sci, {})
            if entry.get("status") in ("ok", "cached") and entry.get("file"):
                secs = entry.get("seconds")
                cost = entry.get("cost")
                meta = " · ".join(
                    part for part in (
                        f"{secs:.0f}s" if secs else None,
                        money(cost) if cost else None,
                    ) if part
                ) or "cached"
                cells.append(
                    f'<figure class="cell">'
                    f'<img src="model_comparison/{html.escape(entry["file"])}" alt="{html.escape(sci)} by {html.escape(model["label"])}" loading="lazy">'
                    f'<figcaption class="meta">{html.escape(meta)}</figcaption></figure>'
                )
            else:
                status = entry.get("status", "not run")
                blocked = "age_18plus" in str(entry.get("error", ""))
                reason = "needs OpenRouter 18+ opt-in" if blocked else status
                cells.append(
                    f'<figure class="cell cell--empty">'
                    f'<div class="failed"><span>no plate</span><small>{html.escape(str(reason))}</small></div>'
                    f'</figure>'
                )

        rows.append(
            '<section class="species">'
            '<header class="species-head">'
            f'<div><h2>{html.escape(item["commonNameEn"])}</h2>'
            f'<p class="vi">{html.escape(item["commonNameVi"])}</p>'
            f'<p class="sci">{html.escape(sci)}</p></div>'
            f'<span class="family">{html.escape(item["family"])}</span>'
            '</header>'
            f'<p class="marks"><strong>Field marks</strong> {html.escape(item["fieldMarks"])}</p>'
            '<div class="strip">'
            '<figure class="cell cell--source">'
            f'<img src="museum_specimens/{html.escape(os.path.basename(item["rawUrl"]))}" alt="Field photo of {html.escape(sci)}" loading="lazy">'
            '<figcaption class="meta">source photo</figcaption></figure>'
            + "".join(cells) +
            '</div></section>'
        )

    head_cells = (
        '<div class="head-cell head-cell--source"><span class="vendor">field</span>'
        '<span class="name">Original photo</span><span class="tag">Input every model was given.</span></div>'
    )
    for model in columns:
        head_cells += (
            '<div class="head-cell">'
            f'<span class="vendor">{html.escape(model["vendor"])}</span>'
            f'<span class="name">{html.escape(model["label"])}</span>'
            f'<span class="tag">{html.escape(TAGLINES.get(model["key"], ""))}</span>'
            f'<code>{html.escape(model["slug"])}</code>'
            '</div>'
        )

    # Cost roll-up. Plates served from cache carry no price, so the per-plate
    # figure averages only the plates this run actually paid for.
    totals = []
    for model in columns:
        if model["key"] == BASELINE["key"]:
            continue
        entries = [results.get(model["key"], {}).get(s["sciName"], {}) for s in species]
        done = [e for e in entries if e.get("status") in ("ok", "cached")]
        priced = [e["cost"] for e in entries if e.get("cost")]
        secs = [e["seconds"] for e in entries if e.get("seconds")]
        avg_secs = f"{sum(secs) / len(secs):.1f}s" if secs else "—"
        per_plate = money(sum(priced) / len(priced)) if priced else "—"
        run_of_four = money(sum(priced) / len(priced) * len(species)) if priced else "—"
        totals.append(
            "<tr>"
            f"<td>{html.escape(model['label'])}</td>"
            f"<td><code>{html.escape(model['slug'])}</code></td>"
            f"<td>{len(done)}/{len(species)}</td>"
            f"<td>{avg_secs}</td>"
            f"<td>{per_plate}</td>"
            f"<td>{run_of_four}</td>"
            "</tr>"
        )

    grid_cols = len(columns) + 1
    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plate Model Comparison — Spidex</title>
<style>
:root {{
  --bg: #0b1220; --panel: #121c2e; --panel-2: #16223a; --line: #24334f;
  --ink: #e8eefc; --muted: #93a4c4; --accent: #4ade80; --warn: #f59e0b;
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
.wrap {{ max-width: 1680px; margin: 0 auto; padding: 40px 24px 80px; }}
h1 {{ font-size: 30px; margin: 0 0 6px; letter-spacing: -.02em; }}
.sub {{ color: var(--muted); margin: 0 0 28px; max-width: 72ch; }}
.strip, .head {{ display: grid; grid-template-columns: repeat({grid_cols}, minmax(0, 1fr)); gap: 12px; }}
.head {{ position: sticky; top: 0; z-index: 5; background: var(--bg);
  padding: 12px 0 14px; border-bottom: 1px solid var(--line); margin-bottom: 22px; }}
.head-cell {{ display: flex; flex-direction: column; gap: 4px; padding: 12px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }}
.head-cell--source {{ background: #1d1520; border-color: #40263a; }}
.vendor {{ font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }}
.name {{ font-weight: 700; font-size: 15px; }}
.tag {{ font-size: 12px; color: var(--muted); line-height: 1.4; }}
.head-cell code {{ font-size: 10px; color: #6f84ab; word-break: break-all; margin-top: auto; }}
.species {{ background: var(--panel); border: 1px solid var(--line);
  border-radius: 14px; padding: 18px; margin-bottom: 22px; }}
.species-head {{ display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }}
.species-head h2 {{ margin: 0; font-size: 20px; }}
.vi {{ margin: 2px 0 0; color: var(--warn); font-size: 13px; }}
.sci {{ margin: 1px 0 0; color: var(--muted); font-style: italic; font-size: 13px; }}
.family {{ font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--muted); background: var(--panel-2); border: 1px solid var(--line);
  padding: 5px 9px; border-radius: 6px; white-space: nowrap; }}
.marks {{ margin: 12px 0 16px; font-size: 13px; color: #c3d0e8;
  border-left: 3px solid var(--accent); padding-left: 12px; }}
.marks strong {{ color: var(--accent); font-size: 11px; letter-spacing: .1em;
  text-transform: uppercase; display: block; margin-bottom: 2px; }}
.cell {{ margin: 0; background: #ffffff; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--line); display: flex; flex-direction: column; }}
.cell--source {{ background: #0f1726; }}
.cell img {{ width: 100%; aspect-ratio: 4 / 3; object-fit: contain; display: block; }}
.cell--source img {{ object-fit: cover; }}
.meta {{ font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); background: var(--panel-2); padding: 6px 8px; text-align: center; }}
.cell--empty {{ background: var(--panel-2); }}
.failed {{ aspect-ratio: 4 / 3; display: flex; flex-direction: column; gap: 4px;
  align-items: center; justify-content: center; color: #7c8db0; font-size: 12px; }}
.failed small {{ color: #55658a; font-size: 10px; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }}
th, td {{ text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); }}
th {{ color: var(--muted); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }}
td code {{ font-size: 11px; color: #7f93b8; }}
.summary {{ background: var(--panel); border: 1px solid var(--line);
  border-radius: 14px; padding: 18px; }}
.summary h2 {{ margin: 0; font-size: 18px; }}
@media (max-width: 1100px) {{
  .strip, .head {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
  .head {{ position: static; }}
}}
</style></head>
<body><div class="wrap">
<h1>Field-guide plate: model comparison</h1>
<p class="sub">Four Vietnamese butterflies, one identical prompt, the same source photo as
reference. Every model is given the <code>spidex:specimen-plate</code> production prompt &mdash; clear
anatomical wing venation, pure white background, no shadow &mdash; through the OpenRouter
<code>/api/v1/images</code> endpoint. The Gemini 2.5 Flash column is the existing production plate,
drawn before that prompt was tightened.</p>
<div class="head">{head_cells}</div>
{"".join(rows)}
<div class="summary"><h2>Cost and latency</h2>
<table><thead><tr><th>Model</th><th>Slug</th><th>Plates</th><th>Avg latency</th>
<th>Cost / plate</th><th>Est. 4-plate run</th></tr></thead>
<tbody>{"".join(totals)}</tbody></table></div>
</div></body></html>
"""

    os.makedirs(os.path.dirname(OUT_HTML), exist_ok=True)
    with open(OUT_HTML, "w", encoding="utf-8") as fh:
        fh.write(doc)
    print(f"Wrote {OUT_HTML} ({len(doc)} bytes, {len(columns)} model columns)")


if __name__ == "__main__":
    main()
