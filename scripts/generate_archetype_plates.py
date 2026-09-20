#!/usr/bin/env python3
"""
Draws the archetype plates — the fallback shown for a species that has no
illustrated plate of its own.

These matter more than their name suggests: Butterflies of Vietnam carries 60
real plates against 1,429 species, so an archetype is what most of that pack
actually looks like on screen.

They are naturalist field-guide specimen plates: elegant ink drawings on the
warm panel ground (--panel: #f0ebe1) the plate frame uses. The silhouette carries
clear family-specific diagnostic geometry and delicate internal linework:
- Butterflies have natural anatomical wing venation (discal cell, radial, medial
  and cubital branches), authentic submarginal spots, warm cream wing interiors,
  sculpted bodies, and family-tailored antennae (clubbed, slender, or hooked
  apiculus for skippers).
- Birds have natural organic curves (curved culmen/beak, curved nape, mantle,
  throat, and breast), wing feather channel cuts, alert eyes with orbital rings
  and catchlights, and natural perching postures (curved perches, tree trunks,
  waterlines, anisodactyl wrapping toes).

Butterflies are drawn once for the right side and mirrored, so the two halves
cannot drift apart.

    python3 scripts/generate_archetype_plates.py
"""
import math
import os
import re
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Spidex tokens. The ground matches --panel so an archetype sits in the plate
# frame the same way a real image does; the subject is --ink at the weight of
# a printed natural history engraving.
GROUND = "#f0ebe1"
INK = "#141110"
SHADE = "#3c3630"

# ---- Measuring ----------------------------------------------------------
# SVG reader to bound what this file emits: absolute M/L/H/V/C/Z paths, circles,
# and translate/scale groups. Cubic segments are bounded at their true extrema.

_NUM = r'-?\d*\.?\d+(?:[eE][-+]?\d+)?'


def _cubic_bounds(p0, p1, p2, p3):
    """Min and max of one cubic segment along one axis."""
    lo, hi = min(p0, p3), max(p0, p3)
    a = -p0 + 3 * p1 - 3 * p2 + p3
    b = 2 * p0 - 4 * p1 + 2 * p2
    c = -p0 + p1
    roots = []
    if abs(a) < 1e-12:
        if abs(b) > 1e-12:
            roots.append(-c / b)
    else:
        disc = b * b - 4 * a * c
        if disc >= 0:
            r = math.sqrt(disc)
            roots += [(-b + r) / (2 * a), (-b - r) / (2 * a)]
    for t in roots:
        if 0 < t < 1:
            u = 1 - t
            v = u**3 * p0 + 3 * u**2 * t * p1 + 3 * u * t**2 * p2 + t**3 * p3
            lo, hi = min(lo, v), max(hi, v)
    return lo, hi


def path_bbox(d):
    tokens = re.findall(r'[MmLlCcHhVvZz]|' + _NUM, d)
    i = 0
    cur = start = (0.0, 0.0)
    cmd = None
    xs, ys = [], []

    def nxt():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        if tokens[i] in 'MmLlCcHhVvZz':
            cmd = tokens[i]
            i += 1
            if cmd in 'Zz':
                cur = start
                continue
        if cmd in 'Mm':
            cur = (nxt(), nxt())
            start = cur
            xs.append(cur[0])
            ys.append(cur[1])
            cmd = 'L'           # further pairs after an M are implicit lines
        elif cmd in 'Ll':
            cur = (nxt(), nxt())
            xs.append(cur[0])
            ys.append(cur[1])
        elif cmd in 'Hh':
            cur = (nxt(), cur[1])
            xs.append(cur[0])
            ys.append(cur[1])
        elif cmd in 'Vv':
            cur = (cur[0], nxt())
            xs.append(cur[0])
            ys.append(cur[1])
        elif cmd in 'Cc':
            x1, y1, x2, y2, x, y = (nxt() for _ in range(6))
            xs.extend(_cubic_bounds(cur[0], x1, x2, x))
            ys.extend(_cubic_bounds(cur[1], y1, y2, y))
            cur = (x, y)
        else:
            i += 1
    return min(xs), min(ys), max(xs), max(ys)


def _transforms(text):
    return [(m.group(1), [float(v) for v in re.findall(_NUM, m.group(2))])
            for m in re.finditer(r'(translate|scale)\(([^)]*)\)', text)]


def _apply(chain, box):
    """Map a local box out through a transform chain, innermost first."""
    x0, y0, x1, y1 = box
    for kind, args in reversed(chain):
        if kind == 'translate':
            dx = args[0]
            dy = args[1] if len(args) > 1 else 0.0
            x0, x1, y0, y1 = x0 + dx, x1 + dx, y0 + dy, y1 + dy
        else:
            sx = args[0]
            sy = args[1] if len(args) > 1 else sx
            x0, x1 = sorted((x0 * sx, x1 * sx))
            y0, y1 = sorted((y0 * sy, y1 * sy))
    return x0, y0, x1, y1


def markup_bbox(markup):
    """True bounds of a drawing, stroke widths included."""
    boxes, stack = [], []
    pattern = r'<g([^>]*)>|</g>|<path([^>]*)/>|<circle([^>]*)/>'
    for m in re.finditer(pattern, markup):
        token = m.group(0)
        if token.startswith('</g'):
            if stack:
                stack.pop()
            continue
        if token.startswith('<g'):
            found = re.search(r'transform="([^"]*)"', m.group(1) or '')
            stack.append(_transforms(found.group(1)) if found else [])
            continue
        attrs = m.group(2) or m.group(3) or ''
        stroke = re.search(r'stroke-width="([\d.]+)"', attrs)
        pad = float(stroke.group(1)) / 2 if stroke else 0.0
        if token.startswith('<path'):
            d = re.search(r'\sd="([^"]*)"', attrs)
            if not d:
                continue
            box = path_bbox(d.group(1))
        else:
            get = lambda k: float(re.search(k + r'="(' + _NUM + r')"', attrs).group(1))
            cx, cy, r = get('cx'), get('cy'), get('r')
            box = (cx - r, cy - r, cx + r, cy + r)
        box = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
        boxes.append(_apply([t for tf in stack for t in tf], box))
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


MARGIN = 3.0   # units of clear canvas on the tightest side
CANVAS = (64.0, 48.0)


def fit(markup):
    """Centre a drawing in the canvas and scale it to the margin."""
    x0, y0, x1, y1 = markup_bbox(markup)
    w, h = x1 - x0, y1 - y0
    cw, ch = CANVAS
    scale = min((cw - 2 * MARGIN) / w, (ch - 2 * MARGIN) / h)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return (f'translate({cw / 2:g} {ch / 2:g}) scale({scale:.4f}) '
            f'translate({-cx:.4f} {-cy:.4f})')


SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" '
       'width="256" height="192" role="img" aria-label="{label}">'
       '<title>{label}</title>'
       '<rect width="64" height="48" fill="{ground}"/>'
       '<g transform="{fit}">{body}</g></svg>')


# =========================================================================
# BUTTERFLIES
# Naturalist museum engraving plates: dark ink frame with submarginal cream dots,
# warm cream wing interior, curved anatomical veins, sculpted segmented body.
# =========================================================================

BODY_REFINED = (
    "M 32 14.5 "
    "C 33.2 14.5, 34.2 15.5, 34.2 16.8 C 34.2 18, 33.5 18.8, 32.8 19.3 "
    "C 34.8 20.2, 35.8 22.5, 35.5 26 C 35.2 29.5, 34.2 32, 33.4 33.8 "
    "C 33.1 38, 32.7 42.5, 32.3 47 C 32.1 48.2, 31.9 48.2, 31.7 47 "
    "C 31.3 42.5, 30.9 38, 30.6 33.8 "
    "C 29.8 32, 28.8 29.5, 28.5 26 C 28.2 22.5, 29.2 20.2, 31.2 19.3 "
    "C 30.5 18.8, 29.8 18, 29.8 16.8 C 29.8 15.5, 30.8 14.5, 32 14.5 Z"
)

BODY_SKIPPER = (
    "M 32 14.2 "
    "C 34.2 14.2, 35.8 15.5, 35.8 17.2 C 35.8 18.6, 34.8 19.5, 33.8 20.2 "
    "C 36.2 21.2, 37.2 24, 37 27.5 C 36.8 31, 35.5 33.5, 34.5 35 "
    "C 34.2 39, 33.6 43, 33 46.5 C 32.8 47.6, 31.2 47.6, 31 46.5 "
    "C 30.4 43, 29.8 39, 29.5 35 "
    "C 28.5 33.5, 27.2 31, 27 27.5 C 26.8 24, 27.8 21.2, 30.2 20.2 "
    "C 29.2 19.5, 28.2 18.6, 28.2 17.2 C 28.2 15.5, 29.8 14.2, 32 14.2 Z"
)


def make_antenna(flare=8.5, hook=False):
    if hook:
        ant_l = "M 31 15 C 28 11.5, 23 8, 19 6.5 C 18 6, 17.5 7.2, 18.5 8"
        ant_r = "M 33 15 C 36 11.5, 41 8, 45 6.5 C 46 6, 46.5 7.2, 45.5 8"
        return (
            f'<path d="{ant_l} {ant_r}" fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
            f'<circle cx="18.5" cy="7.2" r="1.1" fill="{INK}"/>'
            f'<circle cx="45.5" cy="7.2" r="1.1" fill="{INK}"/>'
        )
    x_tip = 32 - flare - 2.5
    ant_l = f"M 31.2 15.5 C 28.5 11, {32 - flare} 7.5, {x_tip} 4.8"
    ant_r = f"M 32.8 15.5 C 35.5 11, {32 + flare} 7.5, {64 - x_tip} 4.8"
    club_l = f"M {x_tip} 4.8 C {x_tip - 1.3} 3.9, {x_tip - 2.3} 4.6, {x_tip - 1.9} 5.8 C {x_tip - 1.5} 7, {x_tip + 0.3} 6.3, {x_tip} 4.8 Z"
    club_r = f"M {64 - x_tip} 4.8 C {64 - x_tip + 1.3} 3.9, {64 - x_tip + 2.3} 4.6, {64 - x_tip + 1.9} 5.8 C {64 - x_tip + 1.5} 7, {64 - x_tip - 0.3} 6.3, {64 - x_tip} 4.8 Z"
    return (
        f'<path d="{ant_l} {ant_r}" fill="none" stroke="{INK}" stroke-width="0.85" stroke-linecap="round"/>'
        f'<path d="{club_l} {club_r}" fill="{INK}"/>'
    )


def butterfly(fw_outer, fw_inner, hw_outer, hw_inner,
              fw_veins="", hw_veins="", fw_spots="", hw_spots="",
              body=BODY_REFINED, antenna_flare=8.5, antenna_hook=False):
    """
    Symmetric butterfly in museum engraving style.
    Outer dark border with submarginal cream dots, cream wing interior with curved ink venation.
    """
    half = (
        f'<path d="{hw_outer}" fill="{INK}"/>'
        f'<path d="{hw_inner}" fill="{GROUND}"/>'
    )
    if hw_veins:
        half += f'<path d="{hw_veins}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
    if hw_spots:
        half += f'{hw_spots}'
    half += (
        f'<path d="{fw_outer}" fill="{INK}"/>'
        f'<path d="{fw_inner}" fill="{GROUND}"/>'
    )
    if fw_veins:
        half += f'<path d="{fw_veins}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
    if fw_spots:
        half += f'{fw_spots}'

    ant = make_antenna(flare=antenna_flare, hook=antenna_hook)
    return (
        f'<g>'
        f'<g>{half}</g>'
        f'<g transform="translate(64,0) scale(-1,1)">{half}</g>'
        f'<path d="{body}" fill="{INK}"/>'
        f'{ant}'
        f'</g>'
    )


# 1. Nymphalid (Brush-footed): Broad falcate forewing, rich venation, submarginal dots
NYMPHALID_SPEC = dict(
    label="Nymphalid butterfly, archetype plate",
    fw_outer=(
        "M 32 19 "
        "C 36 14.5, 43 9, 52 6.5 "
        "C 57 5, 60.5 6.2, 61.5 8.5 "
        "C 62 11.5, 60 15, 59 18.5 "
        "C 57.5 22, 56.5 25.5, 54 28.5 "
        "C 51 31.5, 47 33.5, 42 34.5 "
        "C 37 35.5, 34 33, 32 30 Z"
    ),
    fw_inner=(
        "M 33.5 20 "
        "C 37 16, 43 11.5, 50.5 9.5 "
        "C 54.5 8.5, 56.5 9.5, 57 11 "
        "C 57.5 13.5, 56 16.5, 55 19.5 "
        "C 53.5 22.5, 52.5 25.5, 50.5 27.8 "
        "C 48 30, 45 31.5, 41 32.5 "
        "C 37 33.2, 34.5 31.5, 33.5 29 Z"
    ),
    fw_veins=(
        "M 33.5 21.5 C 37 20, 40.5 18.5, 44 18.5 C 45.2 20.2, 44.5 22.5, 42.5 24 C 38.5 26, 35 27, 33.5 27.5 "
        "M 43.5 18.5 C 47 15.5, 50.5 13, 54.5 10.8 "
        "M 44 18.5 C 47.8 17.2, 51.5 16.5, 55.5 16 "
        "M 43.8 20.8 C 47.5 21, 51 22, 54 23.5 "
        "M 42.5 24 C 45.5 25.5, 48.8 27, 51.5 28.5"
    ),
    fw_spots=(
        f'<circle cx="59" cy="12.5" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="58" cy="16.5" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="56.5" cy="20.5" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="54.5" cy="24.5" r="0.7" fill="{GROUND}"/>'
        f'<circle cx="51.5" cy="28.5" r="0.7" fill="{GROUND}"/>'
    ),
    hw_outer=(
        "M 32 26.5 "
        "C 37.5 26.5, 43 29, 46.5 32.5 "
        "C 49.5 35.5, 50 39.5, 49 42.8 "
        "C 47.5 46.5, 44.2 49, 40 50.2 "
        "C 36 51.2, 33.5 49.2, 32 46 Z"
    ),
    hw_inner=(
        "M 33.5 28 "
        "C 37.5 28, 41.5 30.2, 44.2 33 "
        "C 46.5 35.5, 46.8 38.5, 46 41 "
        "C 44.8 43.8, 42.2 46, 39 47 "
        "C 36 47.8, 34 46.2, 33.5 43.5 Z"
    ),
    hw_veins=(
        "M 33.5 29.5 C 36 30, 38.5 31.8, 39.2 34 C 38.5 36.2, 36.2 37.5, 33.5 37 "
        "M 38.5 32.5 C 41 33, 43 34, 44.8 35.5 "
        "M 39.2 34 C 41.5 36, 43.2 38.5, 44 41 "
        "M 37.5 36.5 C 39.5 38.8, 40.8 41.5, 40 44"
    ),
    hw_spots=(
        f'<circle cx="48" cy="37" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="47.2" cy="41" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="44.5" cy="45" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="40.8" cy="48" r="0.7" fill="{GROUND}"/>'
    ),
    body=BODY_REFINED,
    antenna_flare=8.5,
)

# 2. Papilionid (Swallowtail): Sweeping falcate wings, spatulate tail
PAPILIONID_SPEC = dict(
    label="Papilionid butterfly, archetype plate",
    fw_outer=(
        "M 32 18.5 "
        "C 36 13.5, 43 7.5, 53 5.2 "
        "C 58 4.2, 61.5 5.5, 62.5 8 "
        "C 63 11, 60.5 15, 59 19 "
        "C 57 23, 55.5 27, 53 30.5 "
        "C 50 33.5, 45.5 35.5, 41 36.5 "
        "C 36 37.5, 33.5 34.5, 32 31 Z"
    ),
    fw_inner=(
        "M 33.5 19.5 "
        "C 37 15, 43 10, 51.5 8 "
        "C 55.5 7.2, 57.5 8.2, 58 10 "
        "C 58.5 12.8, 56.5 16.5, 55 20 "
        "C 53 23.5, 51.5 27, 49.5 29.5 "
        "C 47 31.8, 44 33.5, 40 34.5 "
        "C 36 35.2, 34 33, 33.5 30 Z"
    ),
    fw_veins=(
        "M 33.5 21 C 37 19.5, 41 18, 44.5 18 C 45.8 20, 45 22.5, 43 24 C 38.5 26, 35 27, 33.5 27.5 "
        "M 44.2 18 C 48 14.8, 52 11.5, 55.5 9.5 "
        "M 44.5 18 C 48.5 16.5, 52.5 15.5, 56.5 15 "
        "M 44.2 20.8 C 48 21, 52 22, 55 23.8 "
        "M 43 24 C 46 25.8, 49 27.5, 51.5 29.5"
    ),
    fw_spots=(
        f'<circle cx="60" cy="12" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="58.5" cy="16.5" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="56.5" cy="21" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="54" cy="25.5" r="0.7" fill="{GROUND}"/>'
        f'<circle cx="50.8" cy="29.8" r="0.7" fill="{GROUND}"/>'
    ),
    hw_outer=(
        "M 32 26 "
        "C 37.5 26, 43 28.5, 47 32 "
        "C 50 35, 51 38.5, 49.5 42 "
        "C 48.5 44, 47 45.5, 46 47 "
        "C 47.5 50.5, 48.8 54, 48.5 56.5 "
        "C 48 58.5, 45.5 58.5, 44.5 56 "
        "C 43.5 53.5, 43 49.5, 42 47.5 "
        "C 39.5 49.5, 36 50.5, 32 46 Z"
    ),
    hw_inner=(
        "M 33.5 27.5 "
        "C 37.5 27.5, 41.5 29.8, 44.5 32.5 "
        "C 47 35, 47.5 38, 46.2 40.8 "
        "C 45 43, 43 44.5, 41 45.5 "
        "C 38 46.8, 35 46.8, 33.5 43.8 Z"
    ),
    hw_veins=(
        "M 33.5 29 C 36 29.5, 38.5 31.2, 39.5 33.5 C 38.8 35.8, 36.5 37, 33.5 36.5 "
        "M 38.8 32 C 41.5 32.5, 43.8 33.8, 45.5 35.5 "
        "M 39.5 33.5 C 42 35.5, 43.8 38, 44.5 40.5 "
        "M 37.5 36 C 39.5 38, 40.5 41, 40 43.5"
    ),
    hw_spots=(
        f'<circle cx="48.8" cy="36.5" r="0.8" fill="{GROUND}"/>'
        f'<circle cx="48" cy="41" r="0.8" fill="{GROUND}"/>'
        f'<circle cx="46" cy="56.5" r="0.65" fill="{GROUND}"/>'
        f'<circle cx="39" cy="48" r="0.75" fill="{GROUND}"/>'
    ),
    body=BODY_REFINED,
    antenna_flare=9.5,
)

# 3. Pierid (Whites and Sulphurs): Rounded oval wings, soft radiant contours
PIERID_SPEC = dict(
    label="Pierid butterfly, archetype plate",
    fw_outer=(
        "M 32 19 "
        "C 36 15, 42 10.5, 49 8 "
        "C 54 6.2, 57.5 7.5, 59 10 "
        "C 60 13, 59 16.8, 57.5 20.5 "
        "C 55.5 24.5, 53 28, 49.5 30.8 "
        "C 46 33.2, 42 34.5, 38 34.8 "
        "C 35 35, 33 33, 32 30.5 Z"
    ),
    fw_inner=(
        "M 33.5 20.2 "
        "C 37 16.5, 42 12.5, 48 10.5 "
        "C 52 9.2, 54.5 10.2, 55.5 12 "
        "C 56.5 14.5, 55.5 17.8, 54 21 "
        "C 52 24.5, 49.8 27.5, 47 29.8 "
        "C 44 31.8, 40.5 32.8, 37 33 "
        "C 34.5 33, 33.8 31.5, 33.5 29.5 Z"
    ),
    fw_veins=(
        "M 33.5 21.5 C 37 20, 40.5 18.8, 43.5 18.8 C 44.8 20.5, 44 22.5, 42 24 C 38.5 26, 35 27, 33.5 27.5 "
        "M 43 18.8 C 46.5 16, 49.8 13.5, 53.5 11.5 "
        "M 43.5 18.8 C 47 17.5, 50.5 16.8, 54 16.5 "
        "M 43.2 21 C 46.8 21.5, 50 22.5, 53 24 "
        "M 42 24 C 45 25.5, 48 27, 50.5 28.5"
    ),
    hw_outer=(
        "M 32 27 "
        "C 37 27, 42 29.5, 45.5 33 "
        "C 48 36, 48.5 39.8, 47.5 43 "
        "C 46 46.5, 43 49, 39 50 "
        "C 35 51, 33 49, 32 46 Z"
    ),
    hw_inner=(
        "M 33.5 28.2 "
        "C 37 28.2, 41 30.5, 43.5 33.5 "
        "C 45.5 36, 45.8 39, 44.8 41.8 "
        "C 43.5 44.5, 41 46.5, 38 47.2 "
        "C 35 48, 33.8 46.2, 33.5 44 Z"
    ),
    hw_veins=(
        "M 33.5 29.5 C 36 30, 38 31.8, 38.8 34 C 38 36, 36 37.5, 33.5 37 "
        "M 38 32.5 C 40.5 33, 42.5 34.2, 44 35.8 "
        "M 38.8 34 C 41 36, 42.5 38.5, 43.2 41 "
        "M 37 36.5 C 39 39, 40 41.5, 39.2 44"
    ),
    body=BODY_REFINED,
    antenna_flare=7.5,
)

# 4. Lycaenid (Blues and Hairstreaks): Dainty rounded wings, delicate hairlike tail
LYCAENID_SPEC = dict(
    label="Lycaenid butterfly, archetype plate",
    fw_outer=(
        "M 32 20 "
        "C 36 17, 41 13.5, 47 11.5 "
        "C 50.5 10.5, 52.5 11.5, 53.5 13.5 "
        "C 54 16, 52.8 19.5, 51 22.5 "
        "C 48.5 25.8, 45.5 28.5, 42 30.5 "
        "C 38 32, 35 31.5, 32 29 Z"
    ),
    fw_inner=(
        "M 33.5 21 "
        "C 37 18.5, 41 15.5, 46 13.5 "
        "C 48.8 12.8, 50 13.5, 50.5 14.8 "
        "C 51 16.8, 50 19.5, 48.5 22 "
        "C 46.5 24.8, 44 27, 41 28.5 "
        "C 37.8 29.8, 35 29.5, 33.5 28 Z"
    ),
    fw_veins=(
        "M 33.5 22.5 C 36 21.2, 39 20, 41.5 20 C 42.5 21.5, 42 23.5, 40.5 24.5 C 37.5 25.8, 35.5 26.5, 33.5 27 "
        "M 40.5 20.2 C 43 18, 45.8 16.2, 48.5 15 "
        "M 41.5 20 C 44 19.5, 46.5 19.2, 49 19.8 "
        "M 40.5 24.5 C 43 25.5, 45.5 26.5, 47.5 27.8"
    ),
    hw_outer=(
        "M 32 26 "
        "C 36.5 26, 40.5 28, 43 31 "
        "C 45 33.5, 45.5 36.5, 44.5 39 "
        "C 44 40, 43.5 41, 42.5 42 "
        "C 43.5 45, 44.8 48.5, 45.5 51 "
        "C 44.8 50.5, 43.5 47.5, 42 44.5 "
        "C 39.5 46.5, 36.5 47, 32 43.5 Z"
    ),
    hw_inner=(
        "M 33.5 27.2 "
        "C 36.5 27.2, 40 29, 41.8 31.5 "
        "C 43.2 33.5, 43.5 36, 42.8 38 "
        "C 42 39.8, 40.5 41.2, 38.5 42.2 "
        "C 36 43, 34.5 42.2, 33.5 41 Z"
    ),
    hw_veins=(
        "M 33.5 28.5 C 35.5 29, 37.5 30.2, 38.2 32 C 37.5 34, 35.8 35, 33.5 34.5 "
        "M 38 31 C 40 31.5, 41.5 32.5, 42.5 34 "
        "M 38.2 32 C 40 33.8, 41 36, 41.5 38 "
        "M 36.5 34 C 38 36, 38.8 38.5, 38 40.5"
    ),
    hw_spots=f'<circle cx="41.5" cy="40.5" r="0.65" fill="{GROUND}"/>',
    body=BODY_REFINED,
    antenna_flare=6.5,
)

# 5. Hesperiid (Skippers): Stout body, swept-back triangular wings, hooked antennae
HESPERIID_SPEC = dict(
    label="Hesperiid skipper, archetype plate",
    fw_outer=(
        "M 32 19 "
        "C 36 15.5, 42 11, 48 8 "
        "C 52 6.5, 54.5 7.5, 55 9.5 "
        "C 55.5 12, 53.8 15.5, 51.5 18.5 "
        "C 49 22, 46 25, 42 27 "
        "C 38 28.5, 35 28, 32 26 Z"
    ),
    fw_inner=(
        "M 33.5 20 "
        "C 37 17, 42 13, 47 10.2 "
        "C 50 9.2, 51.5 10, 52 11.5 "
        "C 52.2 13.5, 50.8 16.5, 49 19 "
        "C 46.8 22, 44 24.5, 41 26 "
        "C 37.8 27.2, 35 26.8, 33.5 25.5 Z"
    ),
    fw_veins=(
        "M 33.5 21.2 C 36 20, 39 18.8, 42 18.5 C 43 20, 42.5 21.5, 41 22.5 C 38.5 23.5, 35.8 24.2, 33.5 24.5 "
        "M 41.5 18.5 C 44 16.5, 47 14, 50 12 "
        "M 42 18.5 C 44.5 18, 47.5 17.5, 50.5 17.5 "
        "M 41 22.5 C 43.5 23.5, 46 24.5, 48 25.5"
    ),
    hw_outer=(
        "M 32 25.5 "
        "C 36 25.5, 40 27.5, 43 30.5 "
        "C 45 33, 45 36, 44 38.5 "
        "C 42.5 41.5, 39.5 43.5, 36 44.5 "
        "C 33 45.2, 32 44, 32 41 Z"
    ),
    hw_inner=(
        "M 33.5 26.8 "
        "C 36.5 26.8, 39.5 28.5, 41.8 31 "
        "C 43.2 33, 43.2 35.5, 42.5 37.2 "
        "C 41.2 39.5, 39 41.2, 36 42 "
        "C 33.8 42.5, 33.2 41.8, 33.5 39.5 Z"
    ),
    hw_veins=(
        "M 33.5 28 C 35.5 28.5, 37.5 29.8, 38 31.5 C 37.2 33, 35.5 34, 33.5 33.8 "
        "M 37.8 30.5 C 39.8 31.2, 41.2 32, 42 33.5 "
        "M 38 31.5 C 39.5 33, 40.5 35, 41 37 "
        "M 36.2 33.5 C 37.5 35.2, 38 37.5, 37 39.5"
    ),
    body=BODY_SKIPPER,
    antenna_flare=7.0,
    antenna_hook=True,
)

# 6. Graphium (Swordtail): Triangular forewings, very long slender tapering tails
GRAPHIUM_SPEC = dict(
    label="Graphium butterfly, archetype plate",
    fw_outer=(
        "M 32 18 "
        "C 36 12.5, 44 6, 54 3.5 "
        "C 58 2.5, 60.5 3.5, 61.5 5.5 "
        "C 62 8, 59.8 12.5, 57.5 17 "
        "C 55 22, 53 26.5, 50 30 "
        "C 46.5 33, 42 34.5, 38 35 "
        "C 34.5 35.5, 33 33.5, 32 30 Z"
    ),
    fw_inner=(
        "M 33.5 19 "
        "C 37 14, 44 8.5, 52.5 6.2 "
        "C 55.5 5.5, 57 6.2, 57.5 7.8 "
        "C 58 10, 56 14, 54 18 "
        "C 51.5 22.5, 49.5 26.5, 47 29.5 "
        "C 44 31.8, 40.5 32.8, 37 33 "
        "C 34.5 33.2, 33.8 32, 33.5 29.5 Z"
    ),
    fw_veins=(
        "M 33.5 20.8 C 37 19, 41 17.5, 44.5 17.5 C 45.8 19.5, 45 22, 43 23.5 C 38.5 25.5, 35 26.5, 33.5 27 "
        "M 44.2 17.5 C 48 13.8, 52 10, 56.5 7.8 "
        "M 44.5 17.5 C 48.5 16, 52.5 14.8, 56.5 14 "
        "M 44.2 20.2 C 48 20.5, 52 21.5, 54.5 23 "
        "M 43 23.5 C 46 25, 48.8 26.8, 50.8 28.5"
    ),
    hw_outer=(
        "M 32 25.5 "
        "C 37 25.5, 42 27.5, 45.5 30.5 "
        "C 48 33, 48.5 36, 47 39 "
        "C 46 41, 45 42.5, 44 43.5 "
        "C 45 47, 46.5 52, 47.5 57 "
        "C 46.5 56.5, 44.5 51, 42.5 45.5 "
        "C 38.5 47.5, 35 48.5, 32 44.5 Z"
    ),
    hw_inner=(
        "M 33.5 27 "
        "C 37 27, 41 28.8, 43.5 31.2 "
        "C 45.5 33.2, 45.8 35.8, 44.5 38 "
        "C 43.5 40, 42.2 41.2, 40.5 42 "
        "C 37.5 43.5, 35 43.5, 33.5 41.5 Z"
    ),
    hw_veins=(
        "M 33.5 28.5 C 36 29, 38 30.5, 38.8 32.5 C 38 34.5, 36 35.8, 33.5 35.5 "
        "M 38 31 C 40.5 31.8, 42.5 32.8, 44 34.5 "
        "M 38.8 32.5 C 41 34.5, 42.5 36.8, 43 39 "
        "M 37 35 C 39 37, 39.8 39.5, 39 41.8"
    ),
    hw_spots=(
        f'<circle cx="47.2" cy="34.5" r="0.75" fill="{GROUND}"/>'
        f'<circle cx="46" cy="38.5" r="0.75" fill="{GROUND}"/>'
    ),
    body=BODY_REFINED,
    antenna_flare=10.0,
)

# 7. Riodinid (Metalmark): Crisp angular wing geometry, delicate scalloping
RIODINID_SPEC = dict(
    label="Riodinid butterfly, archetype plate",
    fw_outer=(
        "M 32 19 "
        "C 36 15, 42 10, 50 7 "
        "C 54 5.5, 57 6.5, 58.5 8.5 "
        "C 59.5 11, 58 14.5, 56.5 18 "
        "C 54.5 22, 53.5 25.5, 51 28.5 "
        "C 48 31.5, 44 33, 40 33.8 "
        "C 36 34.5, 33.5 32.5, 32 29.5 Z"
    ),
    fw_inner=(
        "M 33.5 20 "
        "C 37 16.5, 42 12, 48.5 9.8 "
        "C 51.8 8.8, 53.8 9.8, 54.5 11.2 "
        "C 55 13.5, 53.8 16.5, 52.5 19.5 "
        "C 50.8 22.8, 49.8 25.8, 47.8 28 "
        "C 45.2 30.2, 42 31.2, 38.8 31.8 "
        "C 36 32.2, 34 31, 33.5 28.8 Z"
    ),
    fw_veins=(
        "M 33.5 21.5 C 37 20, 40 18.8, 43 18.8 C 44 20.5, 43.5 22.5, 41.5 23.8 C 38 25.5, 35.5 26.5, 33.5 27 "
        "M 42.5 18.8 C 45.5 16, 49 13.5, 52.5 11.5 "
        "M 43 18.8 C 46.5 18, 49.5 17.5, 53 17.5 "
        "M 41.5 23.8 C 44.5 25, 47.5 26.2, 50 27.8"
    ),
    hw_outer=(
        "M 32 26 "
        "C 36.5 26, 41 28, 44 31 "
        "C 46.5 33.5, 47 36.5, 46 39.5 "
        "C 44.8 42.5, 42 45, 38.5 46 "
        "C 35 46.8, 33 45.2, 32 42.5 Z"
    ),
    hw_inner=(
        "M 33.5 27.2 "
        "C 36.5 27.2, 40.2 29, 42.5 31.5 "
        "C 44.5 33.5, 44.8 36, 44 38.2 "
        "C 43 40.5, 40.8 42.5, 37.8 43.2 "
        "C 35 43.8, 33.8 42.8, 33.5 40.5 Z"
    ),
    hw_veins=(
        "M 33.5 28.5 C 35.5 29, 37.5 30.5, 38.2 32.5 C 37.5 34.5, 35.5 35.5, 33.5 35 "
        "M 38 31.5 C 40 32.2, 42 33.2, 43 34.8 "
        "M 38.2 32.5 C 40 34.5, 41.2 37, 41.8 39.5 "
        "M 36.5 35 C 38 37, 38.8 39.2, 38 41.5"
    ),
    body=BODY_REFINED,
    antenna_flare=8.0,
)

# 8. General Butterfly (Balanced standard nymphalid)
GENERAL_BF_SPEC = dict(
    label="Butterfly, archetype plate",
    **{k: v for k, v in NYMPHALID_SPEC.items() if k != "label"}
)

BUTTERFLIES = {
    "bf-archetype-nymphalid.svg": NYMPHALID_SPEC,
    "bf-archetype-lycaenid.svg": LYCAENID_SPEC,
    "bf-archetype-papilionid.svg": PAPILIONID_SPEC,
    "bf-archetype-pierid.svg": PIERID_SPEC,
    "bf-archetype-graphium.svg": GRAPHIUM_SPEC,
    "bf-archetype-hesperiid.svg": HESPERIID_SPEC,
    "bf-archetype-riodinid.svg": RIODINID_SPEC,
    "bf-archetype-general.svg": GENERAL_BF_SPEC,
}


# =========================================================================
# BIRDS
# Iconic sculpted naturalist profiles with graceful biological curves,
# negative space wing channels for effortless readability, and alert eyes.
# =========================================================================

BRANCH_CURVED = (
    f'<path d="M 0 38.5 C 14 39, 26 38, 38 36.2 C 46 35, 54 33, 64 30.5 '
    f'C 54 34, 46 36, 38 37.5 C 26 39.2, 14 40.2, 0 39.8 Z" fill="{INK}"/>'
)


def bird_legs(x1=32, y1=30.5, x2=35.5, y2=30, by=36.2):
    """Anisodactyl perching feet with curved toes grasping the branch."""
    return (
        f'<path d="M {x1} {y1} C {x1+0.5} {y1+2.3}, {x1+1.2} {y1+4.3}, {x1+2} {by} '
        f'M {x1+1} {by-0.4} C {x1+2} {by-1.2}, {x1+3.5} {by-1}, {x1+4.5} {by-0.2} '
        f'M {x1+2} {by} C {x1+3} {by+0.3}, {x1+4} {by+1}, {x1+4.6} {by+1.6} '
        f'M {x1+1.2} {by-0.2} C {x1+0.5} {by+0.6}, {x1+0.2} {by+1.4}, {x1+0.5} {by+2}" '
        f'fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
        f'<path d="M {x2} {y2} C {x2+0.5} {y2+2.2}, {x2+1.3} {y2+4}, {x2+2} {by-1} '
        f'M {x2+1} {by-1.4} C {x2+2} {by-2}, {x2+3.5} {by-1.7}, {x2+4.5} {by-1} '
        f'M {x2+2} {by-1} C {x2+3} {by-0.6}, {x2+4} {by}, {x2+4.7} {by+0.8} '
        f'M {x2+1.3} {by-1} C {x2+0.5} {by-0.2}, {x2+0.3} {by+0.6}, {x2+0.7} {by+1.3}" '
        f'fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
    )


def bird_eye(cx, cy, r=1.5):
    """Naturalist bird eye: cream orbital ring, dark iris, bright catchlight."""
    return (
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{GROUND}"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.62:.2f}" fill="{INK}"/>'
        f'<circle cx="{cx+r*0.2:.2f}" cy="{cy-r*0.2:.2f}" r="{r*0.26:.2f}" fill="{GROUND}"/>'
    )


def bird_curvy():
    """Naturalist bird plate: Gracefully arched bough with delicate leaves, plump curved robin/bluebird silhouette, alert eye, contained cream wing with covert dots."""
    branch = (
        f'<path d="M 0 39.8 C 14 41.2, 27 39.8, 39 36.5 C 48 33.8, 56 29.8, 64 23.5 '
        f'C 56 31.2, 48 35.2, 39 38.2 C 27 41.5, 14 42.8, 0 41.8 Z" fill="{INK}"/>'
        f'<path d="M 48 33 C 51.5 31.5, 55 32, 58 34 C 55.5 35, 52 34.8, 48 33 Z" fill="{INK}"/>'
        f'<path d="M 52 34 C 54.5 35.5, 56.5 38, 56.5 40.5 C 54.5 39.5, 53 37.5, 52 34 Z" fill="{INK}"/>'
    )
    body = (
        "M 49 18.5 "
        "C 46 18.8, 43 18.2, 40.5 17.5 "
        "C 38 14.2, 34 13.2, 29.5 14 "
        "C 25.5 14.8, 22.5 17.5, 20.5 21 "
        "C 18.5 25, 17 29.5, 15 33.5 "
        "C 12 37.5, 8 41, 4.5 43.5 "
        "C 3.8 44.2, 5 44.8, 6.5 44.2 "
        "C 10.5 41.8, 14.5 38.5, 18.5 35 "
        "C 21.5 37.8, 25.5 39.2, 29.5 39 "
        "C 35 38.5, 39.5 35.5, 41.8 29.5 "
        "C 42.8 25.5, 42.2 21.5, 40.5 19 "
        "C 43.5 19.2, 46.5 19, 49 18.5 Z"
    )
    breast = (
        "M 41 20 "
        "C 42 24.5, 40.5 29, 38 32.5 "
        "C 35 36, 31 37.2, 26 36.5 "
        "C 29 32.8, 31 28.8, 32 24 "
        "C 35 25.8, 38.5 24.2, 41 20 Z"
    )
    breast_lines = "M 37 24.5 C 34 27, 30 29, 26 30 M 34 29 C 31 31.5, 27 33, 23 33.8"
    wing = (
        "M 33 21 "
        "C 28 20.5, 23.5 23, 21 27.5 "
        "C 19 31.5, 18.5 35.5, 20.5 38.5 "
        "C 23 38, 26 35, 28.5 31.5 "
        "C 31 28, 32.5 24.5, 33 21 Z"
    )
    wing_lines = "M 29 24 C 26 27.5, 23 31, 22 35.5 M 25 28 C 23 31.5, 21.2 35, 21 37.5"
    legs = (
        f'<path d="M 31 33.5 C 31.8 35.5, 32.5 37, 33.5 37.8 '
        f'M 32.5 37.2 C 33.8 36.6, 35.2 37, 36.2 37.6 '
        f'M 33.5 37.8 C 34.5 38.4, 35.5 39, 36.2 39.6" '
        f'fill="none" stroke="{INK}" stroke-width="1.0" stroke-linecap="round"/>'
    )
    eye_markup = (
        f'<circle cx="35.5" cy="16.5" r="1.55" fill="{GROUND}"/>'
        f'<circle cx="35.5" cy="16.5" r="0.96" fill="{INK}"/>'
        f'<circle cx="35.84" cy="16.16" r="0.43" fill="{GROUND}"/>'
    )
    return (
        f'<g>'
        f'{branch}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{breast_lines}" fill="none" stroke="{INK}" stroke-width="0.6" stroke-linecap="round"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.6" stroke-linecap="round"/>'
        f'<circle cx="27.5" cy="26" r="0.75" fill="{INK}"/>'
        f'<circle cx="25" cy="29.5" r="0.75" fill="{INK}"/>'
        f'<circle cx="23" cy="33" r="0.75" fill="{INK}"/>'
        f'<path d="M 40.5 18.2 L 48 18.5" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'{legs}'
        f'{eye_markup}'
        f'</g>'
    )


def bird_songbird():
    """Songbird: Balanced proportions, gentle curved culmen, rounded breast."""
    body = (
        "M 49 19.5 "
        "C 46.5 18.5, 44 17.8, 41 17.5 "
        "C 38 14.8, 34.5 14.2, 31 15.2 "
        "C 27 16.8, 24.5 19.5, 23 23 "
        "C 20.5 27, 18 31, 15 35 "
        "C 12 39, 9 42, 6.5 44 "
        "C 6 44.8, 7.2 45.2, 8.2 44.6 "
        "C 11.5 41.8, 15 39, 18.5 36 "
        "C 22 36.8, 25.5 36.8, 28.8 35.2 "
        "C 33.5 33.5, 37 30, 38.5 25 "
        "C 39.5 22, 39 20, 38 19.2 "
        "C 40.5 19.5, 44.5 19.6, 49 19.5 Z"
    )
    breast = (
        "M 38 21.5 "
        "C 37 25.5, 34.5 30, 29.5 33.5 "
        "C 26.5 35.5, 23.5 35.8, 20.5 34.8 "
        "C 22.2 31.8, 24 28.5, 25.5 25 "
        "C 28 27.5, 33 27, 36.5 23.5 "
        "C 37.5 22.5, 37.8 22.2, 38 21.5 Z"
    )
    breast_lines = "M 34 25 C 31.5 27.2, 28 28.5, 25 29 M 31 28.5 C 28.5 30.5, 25.5 31.8, 22 32.2"
    wing = (
        "M 34 21.5 "
        "C 29.5 21, 24.5 23.2, 21.5 27.5 "
        "C 19 31, 18 35, 19.5 38 "
        "C 21.5 37.5, 24.5 35, 27.5 32 "
        "C 30.5 28.5, 33.5 25, 34 21.5 Z"
    )
    wing_lines = "M 30.5 24.5 C 27 27, 23.5 30.5, 21.5 35 M 26.5 28 C 24 31, 22 34, 21 37"
    return (
        f'<g>'
        f'{BRANCH_CURVED}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{breast_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<circle cx="29" cy="27" r="0.65" fill="{INK}"/>'
        f'<circle cx="26" cy="30.5" r="0.65" fill="{INK}"/>'
        f'<circle cx="23.5" cy="34" r="0.65" fill="{INK}"/>'
        f'<path d="M 41 18.8 L 48.5 19.5" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'{bird_legs(32, 30.5, 35.5, 30, 36.2)}'
        f'{bird_eye(35, 17.8, 1.5)}'
        f'</g>'
    )


def bird_sparrow():
    """Sparrow: Chunky plump body, short conical seed-cracking bill."""
    body = (
        "M 47 20 "
        "C 45 19, 43 18.2, 41 18 "
        "C 38 15, 34.5 14.5, 31 15.5 "
        "C 26.5 17, 24 20, 22.5 23.5 "
        "C 20 27.5, 17.5 31.5, 14.5 35.5 "
        "C 12 39, 9 42, 7.5 43.5 "
        "C 7.2 44.2, 8.5 44.5, 9.5 44 "
        "C 12.5 41.5, 15.5 38.5, 18.8 35.8 "
        "C 22.5 37, 26.5 37, 30 35.5 "
        "C 34.5 33.8, 37.8 30, 38.8 25 "
        "C 39.5 22.5, 39 20.8, 38 20 "
        "C 40.5 20.2, 43.5 20.2, 47 20 Z"
    )
    breast = (
        "M 38 22 "
        "C 37 25.5, 34.5 30, 29.5 33.5 "
        "C 26.5 35.5, 23.5 35.8, 20.5 34.8 "
        "C 22.2 31.8, 24 28.5, 25.5 25 "
        "C 28 27.5, 33 27, 36.5 23.5 "
        "C 37.5 22.5, 37.8 22.2, 38 22 Z"
    )
    breast_lines = "M 34 25 C 31.5 27.2, 28 28.5, 25 29 M 31 28.5 C 28.5 30.5, 25.5 31.8, 22 32.2"
    wing = (
        "M 34 22 "
        "C 29.5 21.5, 24.8 23.8, 22 28 "
        "C 19.8 31.5, 19 35, 20.5 38 "
        "C 22.5 37.5, 25 35.2, 28 32 "
        "C 31 28.5, 33.5 25.5, 34 22 Z"
    )
    wing_lines = "M 30.5 25 C 27.5 27.5, 24 30.8, 22.5 35 M 27 28.5 C 24.5 31.5, 22.5 34.5, 21.5 37.2"
    return (
        f'<g>'
        f'{BRANCH_CURVED}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{breast_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<circle cx="29" cy="27.5" r="0.65" fill="{INK}"/>'
        f'<circle cx="26" cy="31" r="0.65" fill="{INK}"/>'
        f'<path d="M 41 19.2 L 46.8 20" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'{bird_legs(32, 30.8, 35.5, 30.2, 36.2)}'
        f'{bird_eye(35, 18, 1.4)}'
        f'</g>'
    )


def bird_corvid():
    """Corvid: Heavy stout bill with curved culmen, powerful sleek body."""
    body = (
        "M 52 19 "
        "C 48 17.5, 44 16.5, 40 16.2 "
        "C 37 14, 33 13.5, 29 14.5 "
        "C 25 16, 22.5 19, 21 22.5 "
        "C 18.5 26.5, 16 31, 13 35 "
        "C 10 39, 7 42.5, 4.5 45 "
        "C 4.2 46, 5.5 46.5, 6.8 45.8 "
        "C 10.5 42.5, 14.5 39, 18.5 35.8 "
        "C 22.5 36.5, 26.5 36.5, 30 35 "
        "C 34.5 33, 38 29.5, 39 24.5 "
        "C 39.5 22, 39 20, 37.8 18.8 "
        "C 40.5 19.2, 45.5 19.5, 52 19 Z"
    )
    wing = (
        "M 33 21 "
        "C 28.5 20.5, 23.5 23, 20.5 27.5 "
        "C 18.5 31, 18 34.8, 19.2 37.5 "
        "C 21.5 37, 25 34.8, 28 32 "
        "C 31 28.5, 32.8 25, 33 21 Z"
    )
    wing_lines = "M 29.5 24.5 C 26 27, 23 30.5, 21.5 34.5 M 26 27.5 C 23 30.8, 21 34.2, 20.2 36.8"
    throat = "M 38 20.5 C 36 23.5, 33 25.5, 29 26.5"
    return (
        f'<g>'
        f'{BRANCH_CURVED}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<circle cx="28" cy="26.5" r="0.65" fill="{INK}"/>'
        f'<circle cx="25" cy="30" r="0.65" fill="{INK}"/>'
        f'<path d="{throat}" fill="none" stroke="{GROUND}" stroke-width="0.7" stroke-linecap="round"/>'
        f'<path d="M 40 18 L 51.5 19" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'{bird_legs(32, 30.5, 35.5, 30, 36.2)}'
        f'{bird_eye(34, 17.2, 1.5)}'
        f'</g>'
    )


def bird_raptor():
    """Raptor: Lethal hooked bill with curved culmen, fierce brow ridge, heavy talons."""
    body = (
        "M 47 21 "
        "C 46.2 21.2, 44.5 20.5, 42 20 "
        "C 40 20.8, 38.5 21.5, 37.5 22.5 "
        "C 36 26, 33.5 31, 28.8 35.2 "
        "C 25.5 36.8, 22 36.8, 18.5 36 "
        "C 15 39, 11.5 41.8, 8.2 44.6 "
        "C 7.2 45.2, 6 44.8, 6.5 44 "
        "C 9 42, 12 39, 15 35 "
        "C 18 31, 20.5 27, 23 23 "
        "C 24.5 19.5, 27 16.8, 31 15.2 "
        "C 34.5 14.5, 37.5 15, 40 16 "
        "C 42.5 16.8, 45.5 18, 47 21 Z"
    )
    breast = (
        "M 37.5 22.5 "
        "C 36.5 26, 34 30, 29 33.5 "
        "C 26 35.5, 22.5 35.8, 19.5 34.8 "
        "C 21.5 31.8, 23.5 28, 25 24.5 "
        "C 27.5 27.2, 32.5 26.8, 36 23.2 Z"
    )
    breast_bars = "M 34 25.5 C 31.5 27.5, 28 29, 24.5 29.5 M 31 29 C 28.5 31, 25.5 32, 21.5 32.5"
    wing = (
        "M 33.5 21.5 "
        "C 29 21, 24 23.2, 21 27.5 "
        "C 18.5 31, 17.5 35, 19 38 "
        "C 21 37.5, 24 35, 27 32 "
        "C 30 28.5, 33 25, 33.5 21.5 Z"
    )
    wing_lines = "M 30 24.5 C 26.5 27, 23 30.5, 21 35 M 26 28 C 23.5 31, 21.5 34, 20.5 37"
    feet = (
        f'<path d="M 31 30 C 31.5 33, 32.5 35.5, 33.5 37.5 '
        f'M 32 37 C 33.5 35.8, 35.5 36.2, 36.8 37.5 '
        f'M 33.5 37.5 C 34.8 38, 36 39, 36.8 40 '
        f'M 32.5 37.5 C 31.5 38.5, 31 39.8, 31.8 40.8" '
        f'fill="none" stroke="{INK}" stroke-width="1.1" stroke-linecap="round"/>'
        f'<path d="M 35.5 29.5 C 36 32.2, 37 34.8, 38 36.5 '
        f'M 37 36 C 38.5 35, 40.5 35.5, 41.8 36.8 '
        f'M 38 36.5 C 39.2 37.2, 40.5 38, 41.2 39.2 '
        f'M 37.2 36.5 C 36.5 37.5, 36.2 38.8, 36.8 39.8" '
        f'fill="none" stroke="{INK}" stroke-width="1.1" stroke-linecap="round"/>'
    )
    brow = (
        f'<path d="M 31.5 16.2 C 33.5 15.6, 36 16, 38 17" fill="none" stroke="{GROUND}" stroke-width="0.7" stroke-linecap="round"/>'
        f'<circle cx="34.5" cy="18" r="1.4" fill="{GROUND}"/>'
        f'<circle cx="34.5" cy="18" r="0.9" fill="{INK}"/>'
        f'<circle cx="34.8" cy="17.7" r="0.3" fill="{GROUND}"/>'
    )
    gape = "M 42 20 L 46 20.6"
    return (
        f'<g>'
        f'{BRANCH_CURVED}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{breast_bars}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="{gape}" fill="none" stroke="{GROUND}" stroke-width="0.4" stroke-linecap="round"/>'
        f'{feet}'
        f'{brow}'
        f'</g>'
    )


def bird_owl():
    """Owl: Upright rounded body, soft curved ear tufts, round facial discs, luminous eyes."""
    branch = (
        f'<path d="M 0 42 C 16 41.5, 32 42.5, 48 40.5 C 56 39.5, 60 38.5, 64 38 '
        f'C 60 40, 56 41.2, 48 42 C 32 44, 16 43, 0 43.5 Z" fill="{INK}"/>'
    )
    feet = (
        f'<path d="M 27 41 C 26 42, 26 43, 27 43.5 '
        f'M 28.5 41 C 28.5 42.2, 29 43.2, 29.8 43.8 '
        f'M 30.5 41 C 31 42, 31.8 42.8, 32.5 43.2" '
        f'fill="none" stroke="{INK}" stroke-width="1.1" stroke-linecap="round"/>'
        f'<path d="M 34.5 41 C 34 42, 34 43, 34.8 43.5 '
        f'M 36 41 C 36 42.2, 36.5 43.2, 37.2 43.8 '
        f'M 38 41 C 38.5 42, 39.2 42.8, 40 43.2" '
        f'fill="none" stroke="{INK}" stroke-width="1.1" stroke-linecap="round"/>'
    )
    body = (
        "M 32 12 "
        "C 29 10, 26 7.5, 24 6 "
        "C 24.5 8.5, 25 11, 24.5 13.5 "
        "C 21 16.5, 19 21, 18.5 26 "
        "C 18 31, 19 36, 21.5 40 "
        "C 23.5 42, 27 43, 32 43 "
        "C 37 43, 40.5 42, 42.5 40 "
        "C 45 36, 46 31, 45.5 26 "
        "C 45 21, 43 16.5, 39.5 13.5 "
        "C 39 11, 39.5 8.5, 40 6 "
        "C 38 7.5, 35 10, 32 12 Z"
    )
    belly = (
        "M 26 31 C 26 38, 28 41.5, 32 41.5 C 36 41.5, 38 38, 38 31 C 35 32.5, 29 32.5, 26 31 Z"
    )
    belly_chevrons = (
        "M 29 34 C 30.5 35.5, 33.5 35.5, 35 34 "
        "M 28.5 37 C 30.5 38.5, 33.5 38.5, 35.5 37 "
        "M 29.5 39.5 C 31 40.5, 33 40.5, 34.5 39.5"
    )
    mask = (
        "M 32 20.5 "
        "C 29.5 15, 23 15, 23 20 C 23 24.5, 28 27.5, 32 29 "
        "C 36 27.5, 41 24.5, 41 20 C 41 15, 34.5 15, 32 20.5 Z"
    )
    beak = "M 31 22.5 C 31.5 24.5, 32 26, 32 26.5 C 32 26, 32.5 24.5, 33 22.5 Z"
    eyes = (
        f'<circle cx="27" cy="20" r="2.8" fill="{GROUND}"/>'
        f'<circle cx="27" cy="20" r="1.8" fill="{INK}"/>'
        f'<circle cx="27.4" cy="19.6" r="0.6" fill="{GROUND}"/>'
        f'<circle cx="37" cy="20" r="2.8" fill="{GROUND}"/>'
        f'<circle cx="37" cy="20" r="1.8" fill="{INK}"/>'
        f'<circle cx="37.4" cy="19.6" r="0.6" fill="{GROUND}"/>'
    )
    wings = (
        "M 21.5 24 C 20.5 29, 21 34, 23 38 "
        "M 42.5 24 C 43.5 29, 43 34, 41 38"
    )
    return (
        f'<g>'
        f'{branch}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{belly}" fill="{GROUND}"/>'
        f'<path d="{belly_chevrons}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="{mask}" fill="none" stroke="{GROUND}" stroke-width="0.8"/>'
        f'<path d="{beak}" fill="{GROUND}"/>'
        f'{eyes}'
        f'<path d="{wings}" fill="none" stroke="{GROUND}" stroke-width="0.8" stroke-linecap="round"/>'
        f'{feet}'
        f'</g>'
    )


def bird_kingfisher():
    """Kingfisher: Sweeping backward crest, dagger bill, chunky body, short tail."""
    body = (
        "M 55 19 "
        "C 49 18.5, 43 17.5, 37 16.5 "
        "C 34 14, 30 13, 26 13 "
        "C 22 13, 18 14, 15 16 "
        "C 17 18.5, 18.5 21, 18 23.5 "
        "C 17 26.5, 15.5 30.5, 13.5 34 "
        "C 12 36.5, 10.5 38.5, 9.5 39.5 "
        "C 10 40.2, 11.5 40.5, 12.5 40 "
        "C 14.5 38.5, 16.5 36.5, 18.5 34.5 "
        "C 22 35.5, 26 35.5, 29.5 34 "
        "C 34 31.5, 37 27.5, 38 22.5 "
        "C 38.5 20.5, 38 19.5, 37 19 "
        "C 40 19.5, 47 20, 55 19 Z"
    )
    breast = (
        "M 37.5 21 "
        "C 36 24.5, 33 28.5, 28.5 31.5 "
        "C 25.5 33.2, 22.5 33.5, 19.8 32.5 "
        "C 21.5 29.5, 23 26.5, 24 23 "
        "C 27 25.5, 32 25.2, 36 22 "
        "C 36.8 21.5, 37.2 21.2, 37.5 21 Z"
    )
    wing = (
        "M 31 22 "
        "C 27 21.8, 22.5 24, 20 28 "
        "C 18.5 30.8, 18 33.5, 19 36 "
        "C 21 35.5, 24 33.5, 27 31 "
        "C 29.5 28.5, 31 25.5, 31 22 Z"
    )
    wing_lines = "M 27 25 C 24 27.5, 21.5 30.5, 20.5 33.5"
    return (
        f'<g>'
        f'{BRANCH_CURVED}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<circle cx="26.5" cy="27.5" r="0.65" fill="{INK}"/>'
        f'<path d="M 37 18.5 L 54 19.2" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'{bird_legs(27, 29.5, 30.5, 29, 35.5)}'
        f'{bird_eye(33.5, 17.5, 1.5)}'
        f'</g>'
    )


def bird_woodpecker():
    """Woodpecker: Vertical trunk climbing posture, stiff propped tail, chisel bill."""
    trunk = (
        f'<path d="M 44 4 C 43.5 18, 43.5 30, 44 44 L 48 44 C 47.5 30, 47.5 18, 48 4 Z" fill="{INK}"/>'
        f'<path d="M 46 10 L 46 22 M 46 28 L 46 38" fill="none" stroke="{GROUND}" stroke-width="0.8"/>'
    )
    body = (
        "M 16 17.5 "
        "C 21 18, 25 18.5, 29 19 "
        "C 31 22, 33 26, 33 30 "
        "C 33 34, 31 38, 28 40.5 "
        "C 30 42, 34 43.5, 40 44.5 "
        "C 40.5 44.5, 39 42, 37 39.5 "
        "C 35 34, 35 28, 35 23 "
        "C 35 19, 37 16, 39 13.5 "
        "C 37 14.5, 34 15.5, 31.5 16 "
        "C 28 16.5, 24 17, 20 17.2 "
        "C 18 17.2, 17 17.4, 16 17.5 Z"
    )
    breast = (
        "M 29 19 "
        "C 31 22, 32.5 26, 32.5 29.5 "
        "C 32.5 33, 31 36, 28 38.5 "
        "C 29 35, 29 31.5, 28.5 28 "
        "C 28 24.5, 26.5 21.5, 24.5 19.5 "
        "C 26 19.2, 27.5 19, 29 19 Z"
    )
    wing = (
        "M 33 22 "
        "C 30.5 25, 29.5 29, 30.2 33 "
        "C 31 36, 32.5 39, 34.5 41 "
        "C 34.5 37, 34 32, 34.5 27 C 34.8 24.5, 34.2 23, 33 22 Z"
    )
    wing_bars = "M 31 27 L 34 27.5 M 30.5 31 L 34 31.5 M 31 35 L 34.5 35.5"
    claws = (
        f'<path d="M 33 27 L 44 27 M 43 26 L 44.5 27.5 M 43 28 L 44.5 26.5 '
        f'M 30 36 L 44 36 M 43 35 L 44.5 36.5 M 43 37 L 44.5 35.5" '
        f'fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
    )
    return (
        f'<g>'
        f'{trunk}'
        f'{claws}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.0" stroke-linejoin="round"/>'
        f'<path d="{wing_bars}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="M 17 17.8 L 29 19" fill="none" stroke="{GROUND}" stroke-width="0.45" stroke-linecap="round"/>'
        f'{bird_eye(28.5, 17.5, 1.3)}'
        f'</g>'
    )


def bird_waterbird():
    """Waterbird (Heron/Egret): Graceful S-curved neck, spear bill, standing in water."""
    water = (
        f'<path d="M 10 43 C 24 41.8, 42 41.8, 54 43 M 16 45 C 28 44.2, 40 44.2, 50 45" '
        f'fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
    )
    legs = (
        f'<path d="M 27 33 L 27.5 44 M 31 33.5 L 31.5 44" fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
    )
    body = (
        "M 55 14.5 "
        "C 50 14.8, 44 14.5, 39 13.8 "
        "C 36.5 12.5, 33.5 11.8, 30.5 12.2 "
        "C 28.5 11.2, 25.5 10.2, 23 9.5 "
        "C 24.5 11.8, 26 13.8, 27 15.2 "
        "C 25.5 17.8, 24.5 20.8, 25 23.8 "
        "C 25.5 26.8, 27.5 29.2, 29.5 30.8 "
        "C 25.5 31.8, 21 33.8, 16 36.2 "
        "C 12 38.2, 8.5 40.8, 6 42.8 "
        "C 6.2 43.5, 7.5 43.8, 8.8 43.2 "
        "C 13 40.8, 17.5 38.2, 22 36.2 "
        "C 25.5 36.8, 29 36.8, 32 35.8 "
        "C 35 34.2, 36 31.8, 35 29.2 "
        "C 33 26.8, 30.5 24.8, 30.5 22.2 "
        "C 30.5 19.8, 32.5 17.2, 35.5 16 "
        "C 38 16.2, 44 15.8, 55 14.5 Z"
    )
    breast = (
        "M 35 29.2 "
        "C 35 32.8, 33 35.2, 30 35.8 "
        "C 27.5 36.2, 25 35.8, 23 34.5 "
        "C 25.5 33.2, 28 31.8, 29.5 29.8 "
        "C 31.5 29.2, 33.5 29, 35 29.2 Z"
    )
    wing = (
        "M 28.5 31.2 "
        "C 24.5 32.8, 20 35.2, 16 37.8 "
        "C 19 37.5, 22.5 36.8, 25.5 35.2 "
        "C 27.8 33.8, 28.8 32.2, 28.5 31.2 Z"
    )
    gape = "M 39 15.2 L 53 14.6"
    return (
        f'<g>'
        f'{water}'
        f'{legs}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.0" stroke-linejoin="round"/>'
        f'<path d="{gape}" fill="none" stroke="{GROUND}" stroke-width="0.45" stroke-linecap="round"/>'
        f'{bird_eye(34, 14.2, 1.3)}'
        f'</g>'
    )


def bird_waterfowl():
    """Waterfowl (Duck): Continuous curved forehead to spatulate bill, buoyant body, waterlines."""
    water = (
        f'<path d="M 6 38 C 20 37, 44 37, 58 38 M 12 41 C 24 40, 40 40, 52 41 M 18 44 C 28 43, 36 43, 46 44" '
        f'fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
    )
    body = (
        "M 49 19 "
        "C 48 20.2, 45 20.8, 41 20.5 "
        "C 39 21, 41 24, 41 27 "
        "C 41 31, 38 35, 33 36.5 "
        "C 26 37, 18 37, 12 35.5 "
        "C 9 34, 6.5 32, 5 28.5 "
        "C 7 31, 12 30, 18 27 "
        "C 22 24, 24 20, 26 17 "
        "C 28 14.5, 32 14, 35 15 "
        "C 38 16.5, 43 17.8, 49 19 Z"
    )
    breast = (
        "M 41 27 "
        "C 41 31, 38 35, 33 36.5 "
        "C 26 37, 18 37, 13 35.5 "
        "C 17 33, 22 31, 28 30 "
        "C 33 29, 38 28.5, 41 27 Z"
    )
    breast_lines = "M 37 31 C 33 33.5, 27 34.8, 20 35 M 34 33.8 C 30 35.5, 25 36, 18 36"
    wing = (
        "M 30 24 "
        "C 25 24.5, 19 26.5, 14 30.5 "
        "C 17 31.5, 21 30.8, 25 29 "
        "C 28 27.5, 29.5 25.8, 30 24 Z"
    )
    speculum = "M 24 27 C 20 28.5, 16 30.5, 12 32"
    return (
        f'<g>'
        f'{water}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{breast_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.0" stroke-linejoin="round"/>'
        f'<path d="{speculum}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="M 40 19.8 L 47 19.5" fill="none" stroke="{GROUND}" stroke-width="0.45" stroke-linecap="round"/>'
        f'{bird_eye(33, 16.8, 1.4)}'
        f'</g>'
    )


def bird_pigeon():
    """Pigeon/Dove: Deep muscular breast, soft cere above bill, gentle rounded head."""
    body = (
        "M 49 20 "
        "C 46.5 19.5, 44 19, 42 18.5 "
        "C 39 15.5, 35.5 15, 32.5 16 "
        "C 28 17.5, 25 20.5, 23 24 "
        "C 20 28, 17 32, 13.5 36 "
        "C 10.5 39.5, 7.5 42.5, 5 44.5 "
        "C 4.8 45.2, 6 45.5, 7.2 45 "
        "C 11 42, 15 39, 19 36 "
        "C 23 37, 27 37, 30.5 35.5 "
        "C 36 34, 40 30, 41 24.5 "
        "C 41.5 22, 40.8 20.5, 39.5 19.5 "
        "C 41 19.8, 44.5 20, 49 20 Z"
    )
    breast = (
        "M 39.5 21.5 "
        "C 39 26, 36 31, 31 34.5 "
        "C 27.5 36.5, 23.5 36.5, 20 35 "
        "C 22 31.8, 24 28, 25.5 24.5 "
        "C 29 27.5, 34.5 27, 38 23.5 "
        "C 39 22.5, 39.3 21.8, 39.5 21.5 Z"
    )
    wing = (
        "M 33 22 "
        "C 28.5 21.5, 23.5 24, 20.5 28.5 "
        "C 18.5 32, 18 35.5, 19.5 38.5 "
        "C 22.5 37.5, 26 35, 29 32 "
        "C 31.5 29, 33 25.5, 33 22 Z"
    )
    wing_lines = "M 29.5 25.5 C 25.5 27.5, 22 31.5, 21 35.5"
    cere = "M 42 18.5 C 41 17.8, 40 18, 39.5 18.8"
    return (
        f'<g>'
        f'{BRANCH_CURVED}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<circle cx="28" cy="27" r="0.65" fill="{INK}"/>'
        f'<circle cx="25" cy="30.5" r="0.65" fill="{INK}"/>'
        f'<path d="{cere}" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'<path d="M 42 19 L 48.5 20" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'{bird_legs(32, 31, 35.5, 30.5, 36.5)}'
        f'{bird_eye(36, 17.8, 1.4)}'
        f'</g>'
    )


def bird_sunbird():
    """Sunbird: Delicate downcurved decurved bill, long tail, dainty frame."""
    body = (
        "M 55 24 "
        "C 53 22, 49 19.5, 42 17.5 "
        "C 39 15, 35.5 14.5, 32 15.2 "
        "C 28 16.5, 25.5 19, 24 22 "
        "C 22 25.5, 19.5 29, 17 32.5 "
        "C 14 36, 10 40, 6 45 "
        "C 5.5 45.8, 6.8 46, 7.8 45.4 "
        "C 11.5 41, 15.5 37, 19.5 33.5 "
        "C 22.5 34.5, 26.5 34.5, 29.5 33 "
        "C 33.5 31, 36.5 27.5, 37.5 23.5 "
        "C 38 21, 37.5 19.5, 36.5 18.5 "
        "C 40 19.5, 46 22, 55 24 Z"
    )
    breast = (
        "M 36.5 20.5 "
        "C 35.5 24, 33 28, 29 31 "
        "C 26.5 32.8, 23.5 33, 20.5 32 "
        "C 22 29.5, 23.5 26.5, 24.8 23.5 "
        "C 27.5 25.8, 32 25.5, 35 22.5 "
        "C 36 21.5, 36.2 20.8, 36.5 20.5 Z"
    )
    wing = (
        "M 32 21 C 28 20.5, 23.5 22.5, 21 26.5 C 19 29.5, 18.5 32.5, 19.5 35 "
        "C 22 34.5, 25 32.8, 27.5 30.5 C 30 28, 31.5 24.5, 32 21 Z"
    )
    wing_lines = "M 28 24 C 25 25.5, 22 28.5, 21.5 32"
    return (
        f'<g>'
        f'{BRANCH_CURVED}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.0" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.5" stroke-linecap="round"/>'
        f'<path d="M 38 18.5 L 54 24" fill="none" stroke="{GROUND}" stroke-width="0.45" stroke-linecap="round"/>'
        f'{bird_legs(30, 29, 33.5, 28.5, 34.5)}'
        f'{bird_eye(34, 17.5, 1.3)}'
        f'</g>'
    )


def bird_swift():
    """Swift: Swept-back aerodynamic sickle wings, deeply notched forked tail."""
    body = (
        "M 50 18.5 "
        "C 48 18.2, 46 18, 44 18 "
        "C 41 16.5, 38 16, 35 16.5 "
        "C 31 17.5, 27 20, 23 23 "
        "C 18 26.5, 12 31.5, 5 38 "
        "C 4.5 39, 5.8 39.5, 7 38.8 "
        "C 13 34.5, 19 30.5, 25 27 "
        "C 22 30, 18 34, 13 39 "
        "C 14 39.5, 15.5 39.8, 17 39 "
        "C 20 36.5, 23 33.5, 26 30 "
        "C 29 31, 33 31, 37 29 "
        "C 41 27, 43.5 24, 44 20.5 "
        "C 44.5 19.5, 44 19, 43.5 18.8 "
        "C 46 18.8, 48 18.6, 50 18.5 Z"
    )
    wing = (
        "M 41 18 "
        "C 36 19, 30 22, 23 26 "
        "C 18 29.5, 13 33.5, 9 37 "
        "C 13 34, 18 30, 24 26.5 "
        "C 30 23, 36 20.5, 41 18 Z"
    )
    throat = (
        "M 44 20 C 43 23, 40 25.5, 36 26.5 C 38 24.5, 39.5 22.5, 40 20 Z"
    )
    return (
        f'<g>'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{throat}" fill="{GROUND}"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="0.8" stroke-linejoin="round"/>'
        f'<path d="M 44 18.5 L 49.5 18.5" fill="none" stroke="{GROUND}" stroke-width="0.45" stroke-linecap="round"/>'
        f'{bird_eye(40, 17.8, 1.2)}'
        f'</g>'
    )


def bird_gamebird():
    """Gamebird (Quail/Partridge): Rotund ground body, curved head plume, stout legs."""
    body = (
        "M 50 20.5 "
        "C 47.5 19.8, 45 19.2, 42.5 19 "
        "C 40 16.5, 36.5 15.5, 32.5 16 "
        "C 28 17.5, 24.5 20.5, 22.5 24 "
        "C 20 28, 17 32, 13 35 "
        "C 10 37, 8 38.5, 6.5 39.5 "
        "C 7 40.2, 8.5 40.5, 10 40 "
        "C 13 38.5, 16 37, 19 35.5 "
        "C 24 37.5, 30 38, 35 36.5 "
        "C 39.5 34.5, 42 30, 41.5 25 "
        "C 41 22.5, 40 21, 39 20.2 "
        "C 41 20.2, 45 20.5, 50 20.5 Z"
    )
    plume = (
        "M 35 15.5 "
        "C 36 12, 37.5 8.5, 40 6.5 "
        "C 42 5, 44 6, 43.5 8 "
        "C 43 10, 40.5 12, 38 13.5 "
        "C 36.5 14.5, 35.5 15, 35 15.5 Z"
    )
    breast = (
        "M 39 22 "
        "C 38 26, 35 31, 30 34.5 "
        "C 26 36.8, 21.5 36.8, 18 35 "
        "C 20 31.5, 22 28, 23.5 24.5 "
        "C 26.5 27.5, 32 27, 36 23.5 "
        "C 37.5 22.5, 38.2 22.2, 39 22 Z"
    )
    breast_scallops = "M 36 24.5 C 33 27, 29 28.5, 25 29 M 33 28 C 30 30.5, 26 32, 22 32.5"
    wing = (
        "M 33 22 C 28 22, 23 24.5, 19.5 28.5 C 17.5 31, 17 34, 18.5 36.5 "
        "C 21.5 35.5, 25.5 34.2, 28.5 31.5 C 31.5 28.8, 33 25.5, 33 22 Z"
    )
    wing_lines = "M 29 25.5 C 25 27.5, 21.5 31, 20.5 34.5"
    ground = f'<path d="M 5 44 L 59 44" stroke="{INK}" stroke-width="1.0" stroke-linecap="round" fill="none"/>'
    legs = (
        f'<path d="M 27 36 L 25.5 43.5 M 23 43.5 L 28 43.5 M 33 35.5 L 34.5 43.5 M 32 43.5 L 37 43.5" '
        f'fill="none" stroke="{INK}" stroke-width="0.9" stroke-linecap="round"/>'
    )
    return (
        f'<g>'
        f'{ground}'
        f'{legs}'
        f'<path d="{body}" fill="{INK}"/>'
        f'<path d="{plume}" fill="{INK}"/>'
        f'<path d="{breast}" fill="{GROUND}"/>'
        f'<path d="{breast_scallops}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<path d="{wing}" fill="{GROUND}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{wing_lines}" fill="none" stroke="{INK}" stroke-width="0.55" stroke-linecap="round"/>'
        f'<circle cx="28.5" cy="27" r="0.65" fill="{INK}"/>'
        f'<circle cx="25.5" cy="30.5" r="0.65" fill="{INK}"/>'
        f'<path d="M 42.5 19.8 L 49.5 20.5" fill="none" stroke="{GROUND}" stroke-width="0.5" stroke-linecap="round"/>'
        f'{bird_eye(36.5, 18.5, 1.4)}'
        f'</g>'
    )


BIRD_MASTER_MARKUP = bird_curvy()

BIRDS = {
    "bird-archetype-songbird.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-sparrow.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-corvid.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-raptor.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-owl.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-kingfisher.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-woodpecker.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-waterbird.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-waterfowl.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-pigeon.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-sunbird.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-swift.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-gamebird.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-archetype-general.svg": dict(label="Bird, archetype plate", markup=BIRD_MASTER_MARKUP),
    "bird-placeholder.svg": dict(label="Bird, placeholder plate", markup=BIRD_MASTER_MARKUP),
    "bird.svg": dict(label="Bird, placeholder plate", markup=BIRD_MASTER_MARKUP),
}


def load_bird_svg(label="Bird, archetype plate"):
    asset_path = os.path.join(ROOT, "scripts", "assets", "bird_plate.svg")
    with open(asset_path, "r", encoding="utf-8") as f:
        content = f.read()
    content = re.sub(r'aria-label="[^"]*"', f'aria-label="{label}"', content)
    content = re.sub(r'<title>[^<]*</title>', f'<title>{label}</title>', content)
    return content


def write_bird_svg(dest_path, label):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "w", encoding="utf-8") as fh:
        fh.write(load_bird_svg(label))
    return True


def write_svg(dest_path, markup, label):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "w", encoding="utf-8") as fh:
        fh.write(SVG.format(label=label, ground=GROUND, body=markup, fit=fit(markup)))
    return True


def main():
    written = 0

    # 1. Compile Butterfly SVG strings
    bf_svgs = {}
    for name, spec in BUTTERFLIES.items():
        markup = butterfly(
            fw_outer=spec["fw_outer"],
            fw_inner=spec["fw_inner"],
            hw_outer=spec["hw_outer"],
            hw_inner=spec["hw_inner"],
            fw_veins=spec.get("fw_veins", ""),
            hw_veins=spec.get("hw_veins", ""),
            fw_spots=spec.get("fw_spots", ""),
            hw_spots=spec.get("hw_spots", ""),
            body=spec.get("body", BODY_REFINED),
            antenna_flare=spec.get("antenna_flare", 8.5),
            antenna_hook=spec.get("antenna_hook", False),
        )
        bf_svgs[name] = (markup, spec["label"])

    # 2. Bird specs
    bd_svgs = {}
    for name, spec in BIRDS.items():
        bd_svgs[name] = (spec["markup"], spec["label"])

    # 3. Write to pack directories
    for pack in ("butterfly-vn", "butterfly-th", "butterfly-sg", "butterfly-min"):
        pack_img_dir = os.path.join(ROOT, "public", "packs", pack, "img")
        if not os.path.isdir(pack_img_dir):
            continue
        for name, (markup, label) in bf_svgs.items():
            dest = os.path.join(pack_img_dir, name)
            write_svg(dest, markup, label)
            written += 1
        # Also copy general to bf-placeholder.svg alias
        gen_markup, gen_label = bf_svgs["bf-archetype-general.svg"]
        write_svg(os.path.join(pack_img_dir, "bf-placeholder.svg"), gen_markup, "Butterfly placeholder plate")
        written += 1

    for pack in ("bird-vn", "bird-th", "bird-min"):
        pack_img_dir = os.path.join(ROOT, "public", "packs", pack, "img")
        if not os.path.isdir(pack_img_dir):
            continue
        for name, (_, label) in bd_svgs.items():
            dest = os.path.join(pack_img_dir, name)
            write_bird_svg(dest, label)
            written += 1
        # Also copy general to bird-placeholder.svg alias and bird.svg
        write_bird_svg(os.path.join(pack_img_dir, "bird-placeholder.svg"), "Bird placeholder plate")
        write_bird_svg(os.path.join(pack_img_dir, "bird.svg"), "Bird placeholder plate")
        written += 2

    # 4. Universal web placeholders under public/placeholders/
    placeholder_dir = os.path.join(ROOT, "public", "placeholders")
    os.makedirs(placeholder_dir, exist_ok=True)
    gen_bf_markup, _ = bf_svgs["bf-archetype-general.svg"]
    write_svg(os.path.join(placeholder_dir, "butterfly.svg"), gen_bf_markup, "Butterfly placeholder plate")
    write_bird_svg(os.path.join(placeholder_dir, "bird.svg"), "Bird placeholder plate")
    for name, (markup, label) in bf_svgs.items():
        write_svg(os.path.join(placeholder_dir, name), markup, label)
    for name, (_, label) in bd_svgs.items():
        write_bird_svg(os.path.join(placeholder_dir, name), label)
    written += len(bf_svgs) + len(bd_svgs) + 2

    print(f"wrote {written} archetype and placeholder SVGs")

    # 5. Generate high-res 1024x1024 museum specimen raster plates
    specimen_dir = os.path.join(ROOT, "public", "museum_specimens")
    if os.path.isdir(specimen_dir):
        bf_svg_path = os.path.join(placeholder_dir, "butterfly.svg")
        bd_svg_path = os.path.join(placeholder_dir, "bird.svg")
        target_bf_jpg = os.path.join(specimen_dir, "_placeholder_butterfly.jpg")
        target_bd_jpg = os.path.join(specimen_dir, "_placeholder_bird.jpg")
        target_plate_jpg = os.path.join(specimen_dir, "_placeholder_plate.jpg")

        rsvg = shutil.which("rsvg-convert")
        magick = shutil.which("magick") or shutil.which("convert")
        if rsvg and magick:
            tmp_bf_png = "/tmp/spidex_ph_bf.png"
            tmp_bd_png = "/tmp/spidex_ph_bd.png"
            subprocess.run([rsvg, "-w", "1024", "-h", "1024", bf_svg_path, "-o", tmp_bf_png], check=True)
            subprocess.run([rsvg, "-w", "1024", "-h", "1024", bd_svg_path, "-o", tmp_bd_png], check=True)
            subprocess.run([magick, tmp_bf_png, "-quality", "92", target_bf_jpg], check=True)
            subprocess.run([magick, tmp_bd_png, "-quality", "92", target_bd_jpg], check=True)
            # Default _placeholder_plate.jpg is high-res naturalist butterfly plate
            shutil.copyfile(target_bf_jpg, target_plate_jpg)
            for tmp in (tmp_bf_png, tmp_bd_png):
                if os.path.exists(tmp):
                    os.remove(tmp)
            print("generated 1024x1024 museum specimen placeholder plates")


if __name__ == "__main__":
    main()
