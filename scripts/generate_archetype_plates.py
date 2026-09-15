#!/usr/bin/env python3
"""
Draws the archetype plates — the fallback shown for a species that has no
illustrated plate of its own.

These matter more than their name suggests: Butterflies of Vietnam carries 60
real plates against 1,429 species, so an archetype is what most of that pack
actually looks like on screen.

The previous set was clip art — two teardrops and a bar for a butterfly, an
ellipse and a circle for a bird — in colours that competed with the real
plates while saying nothing about the animal. These are naturalist silhouettes
instead: one ink shape on the same ground the plate frame uses, drawn so the
family is readable from the outline alone. A swallowtail has its tails, a
lycaenid is small and round, a heron has its neck and legs. Being obviously
schematic is the point — a placeholder should not pretend to be a photograph,
but it should still tell you what kind of animal you are looking at.

Butterflies are drawn once for the right side and mirrored, so the two halves
cannot drift apart.

    python3 scripts/generate_archetype_plates.py
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Spidex tokens. The ground matches --panel so an archetype sits in the plate
# frame the same way a real image does; the subject is --ink at the weight of
# a printed silhouette.
GROUND = "#f0ebe1"
INK = "#141110"
SHADE = "#3c3630"

# The plate frame these land in is 4:3 with object-fit: cover, so a square
# drawing loses a band off the top and bottom — which is exactly where the
# antenna clubs and the swallowtail streamers live. The art is composed on the
# familiar 64-unit square and then fitted into a 4:3 canvas, so nothing that
# identifies the family is ever cropped away.
FIT = 'translate(32 24) scale(0.78) translate(-32 -34.4)'

SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" '
       'width="256" height="192" role="img" aria-label="{label}">'
       '<title>{label}</title>'
       '<rect width="64" height="48" fill="{ground}"/>'
       '<g transform="{fit}">{body}</g></svg>')


def butterfly(forewing, hindwing, body, antenna_flare=9.0, tail=""):
    """
    One half drawn, then mirrored about x=32. `tail` is extra hindwing
    structure (swallowtail streamers) drawn in the same half.
    """
    half = f'<path d="{forewing}"/><path d="{hindwing}"/>'
    if tail:
        half += f'<path d="{tail}"/>'
    return (
        f'<g fill="{INK}">'
        f'<g>{half}</g>'
        f'<g transform="translate(64,0) scale(-1,1)">{half}</g>'
        f'<path d="{body}" stroke="{GROUND}" stroke-width="0.9"/>'
        # Antennae: thin, clubbed, and the only stroked elements.
        f'<g fill="none" stroke="{INK}" stroke-width="1.1" stroke-linecap="round">'
        f'<path d="M31 18 C29 14 {32 - antenna_flare} 11 {32 - antenna_flare - 1.5} 8"/>'
        f'<path d="M33 18 C35 14 {32 + antenna_flare} 11 {32 + antenna_flare + 1.5} 8"/>'
        f'</g>'
        f'<circle cx="{32 - antenna_flare - 1.5}" cy="7.4" r="1.15"/>'
        f'<circle cx="{32 + antenna_flare + 1.5}" cy="7.4" r="1.15"/>'
        f'</g>'
    )


# Body shared by most families: thorax, tapered abdomen.
BODY = ("M32 16 C33.6 16 34.4 17.8 34.3 19.6 L33.5 50.5 "
        "C33.4 52.6 30.6 52.6 30.5 50.5 L29.7 19.6 C29.6 17.8 30.4 16 32 16 Z")
BODY_STOUT = ("M32 16 C34.1 16 35.1 18.2 35 20.2 L34 47 "
              "C33.8 49.4 30.2 49.4 30 47 L29 20.2 C28.9 18.2 29.9 16 32 16 Z")

BUTTERFLIES = {
    # Brush-footed: broad, angular forewing, scalloped hindwing margin.
    "bf-archetype-nymphalid.svg": dict(
        label="Nymphalid butterfly, archetype plate",
        forewing="M33 20 C42 15.5 51 11.5 59.5 9.5 C60.5 17.5 55 29 45.5 34.5 C40.5 37 36 36 33 33.5 Z",
        hindwing="M33 35 C40 34.6 47.5 38 51 43 C50.5 44.6 48.6 44.4 47.6 45.6 "
                 "C47.2 47.4 45 47.4 43.7 48.6 C43 50.2 40.8 50.4 39.4 51.4 "
                 "C36.8 52.6 33.6 50.8 33 47 Z",
        body=BODY,
    ),
    # Blues and hairstreaks: small, rounded, fine hindwing tail.
    "bf-archetype-lycaenid.svg": dict(
        label="Lycaenid butterfly, archetype plate",
        forewing="M33 22 C40 18.5 47.5 15.5 53.5 15 C54.5 22 50.5 30 43 34 C39 36 35.5 35.5 33 33.5 Z",
        hindwing="M33 35 C39 34.6 45 37.5 47.5 41.5 C46.5 46 41 49 36.5 49 C34 48.6 33 45 33 40 Z",
        tail="M44.5 47.5 C46.5 50.5 48 53.5 48.6 56 C47 54.6 45 51.6 43.4 49 Z",
        body=BODY,
        antenna_flare=7.5,
    ),
    # Swallowtails: triangular forewing, long streaming tail.
    "bf-archetype-papilionid.svg": dict(
        label="Papilionid butterfly, archetype plate",
        forewing="M33 20 C42.5 15 52 11 60 9 C60.5 18 54.5 29.5 45 34.5 C40 37 36 36 33 33.5 Z",
        hindwing="M33 35 C39.5 34.6 46 37.6 49 42 C48.4 45.6 45.4 48.6 41.6 50.4 "
                 "C38.4 51.6 34.4 50.4 33 46.6 Z",
        tail="M43.5 49.5 C46.5 53 49 57 50 60.5 C47.6 58.6 44.4 54.6 42 51.2 Z",
        body=BODY,
    ),
    # Whites and yellows: rounded, softer outline, no angular apex.
    "bf-archetype-pierid.svg": dict(
        label="Pierid butterfly, archetype plate",
        forewing="M33 21 C41 16.5 49.5 13.5 55.5 13.5 C57 21 52.5 30 44.5 34.5 C40 36.8 36 36 33 33.5 Z",
        hindwing="M33 35 C40 34.6 47 38 49.5 43 C48 48 42.5 51.5 37.5 51.5 C34.4 51 33 47.4 33 42 Z",
        body=BODY_STOUT,
        antenna_flare=8.0,
    ),
    # Swordtails: narrow, elongated forewing and a very long tail.
    "bf-archetype-graphium.svg": dict(
        label="Graphium butterfly, archetype plate",
        forewing="M33 20 C43 15 53.5 10.5 61 8.5 C61 16 55.5 27.5 46 33 C40.5 35.8 36 35.4 33 33 Z",
        hindwing="M33 34.5 C39 34.2 44.5 36.8 47 40.6 C46.4 44 43.6 46.8 40.4 48.4 "
                 "C37.4 49.6 34 48.4 33 45 Z",
        tail="M42.5 47.5 C45 52.5 47 58 47.6 62 C45.4 59 42.6 53.4 40.6 49 Z",
        body=BODY,
        antenna_flare=8.5,
    ),
    # Unplaced: the balanced generic form, deliberately unremarkable.
    "bf-archetype-general.svg": dict(
        label="Butterfly, archetype plate",
        forewing="M33 20.5 C41.5 16 50.5 12.5 57.5 11.5 C58.5 19.5 53 30 44 34.5 C39.5 36.8 36 36 33 33.5 Z",
        hindwing="M33 35 C40 34.6 46.8 38 49.5 42.8 C48.5 47.4 43.5 50.6 38.5 50.8 "
                 "C34.8 50.4 33 47 33 42 Z",
        body=BODY,
    ),
}


# Perched passerine reused as the base for the small-bird families; the bill
# and tail are what separate them.
def perched(head=(43, 26), r=7.0, bill="", tail="", body="", wing="", legs=(31, 37, 51, 57),
            lw=1.5, eye=None):
    """
    A perched bird. Bill paths begin inside the head circle so the two merge
    into one contour; the wing is cut in ground colour, which is what stops a
    silhouette reading as a pebble.
    """
    hx, hy = head
    ex, ey = eye or (hx - 0.6, hy - 1.2)
    x1, x2, y1, y2 = legs
    return (
        f'<g fill="{INK}">'
        f'<path d="{body}"/>'
        f'<circle cx="{hx}" cy="{hy}" r="{r}"/>'
        f'<path d="{tail}"/>'
        f'<path d="{bill}"/>'
        f'<path d="{wing}" fill="{GROUND}" opacity="0.34"/>'
        f'<path d="M{x1} {y1} L{x1 - 1} {y2} M{x2} {y1} L{x2 + 0.4} {y2}" '
        f'stroke="{INK}" stroke-width="{lw}" stroke-linecap="round" fill="none"/>'
        f'<circle cx="{ex}" cy="{ey}" r="1.35" fill="{GROUND}"/>'
        f'</g>'
    )


PERCHED_BODY = ("M40 27 C44 31 45.5 38 42 44 C38 50.5 28.5 52 22.5 47.5 "
                "C17 43.4 18 35.5 23.5 31 C28.5 27 35.5 25 40 27 Z")
PERCHED_WING = ("M37 31.5 C40.5 33.5 41.5 38.5 39 43 C36.5 47.5 30 50 25.5 48.5 "
                "C27 44 30 38 33 34.5 C34.4 32.8 35.8 31.4 37 31.5 Z")

BIRDS = {
    "bird-archetype-songbird.svg": dict(
        label="Songbird, archetype plate",
        markup=perched(
            body=PERCHED_BODY, wing=PERCHED_WING,
            # Starts at 44, inside the r=7 head, so bill and head are one shape.
            bill="M44 24.2 L56 27 L44 29.6 Z",
            tail="M22.6 46.4 C17 47.6 9.5 50 4.5 52.8 C10 53.2 17 52 22.4 49.8 Z",
        ),
    ),
    "bird-archetype-sparrow.svg": dict(
        label="Sparrow, archetype plate",
        markup=perched(
            head=(42.5, 27), r=7.4,
            body=PERCHED_BODY, wing=PERCHED_WING,
            # Conical seed bill: deep at the base, blunt.
            bill="M43 24.4 L53.5 28.4 L43 31.4 Z",
            tail="M22.6 46.6 C18.5 48 13 50.4 9.5 52.8 C14 53.2 19 52 22.6 50.2 Z",
        ),
    ),
    "bird-archetype-corvid.svg": dict(
        label="Corvid, archetype plate",
        markup=perched(
            head=(43, 23), r=7.6,
            body=("M40 24 C44.5 28.5 46 36.5 42.5 43.5 C38 51 27.5 52.6 21.5 47.6 "
                  "C15.5 42.6 17 34 23 29.5 C28.5 25.4 35.5 23 40 24 Z"),
            wing=("M36.5 28.5 C40.5 30.5 41.8 36 39 41 C36 46.5 29 49.5 24 48 "
                  "C26 43 29.5 36 33 32 C34.2 30.2 35.4 28.5 36.5 28.5 Z"),
            # Heavy, slightly decurved.
            bill="M44 20.6 C49.5 21.4 55.5 23.4 58.5 25.4 C54.5 26.4 48.5 26.8 44 26.4 Z",
            tail="M21.6 46.4 C15 48.8 6.5 53.4 1.5 58 C8 57 16 53 21.8 49.6 Z",
            legs=(30, 36, 51.5, 58), lw=1.8,
        ),
    ),
    "bird-archetype-raptor.svg": dict(
        label="Raptor, archetype plate",
        markup=perched(
            head=(41, 19), r=7.4,
            # Upright, deep-chested.
            body=("M38 20 C43 25 45 34 41.5 42 C37.5 50.5 27.5 52.6 22 47.6 "
                  "C16.5 42.4 18 32.5 23.5 26.5 C28 21.6 34 18.6 38 20 Z"),
            wing=("M35 25 C39.5 27.5 41 33.5 38.5 39.5 C36 45.5 28.5 49 24 47.5 "
                  "C26 42 29 33.5 32 28.5 C33 26.6 34 25 35 25 Z"),
            # Hooked: a smooth top line that turns down past the chin.
            bill=("M42 15.8 C47.5 16.4 52 18.4 54 20.6 C52.6 21.6 50 22.2 48 22.4 "
                  "C48.4 24.6 47.4 26.4 45.6 27.4 C43.6 24.4 42.2 20 42 15.8 Z"),
            tail="M22.6 46.6 C18 49.8 13.5 54.6 11 58.6 C15.5 57 20 53.6 23.4 50 Z",
            legs=(29.5, 37, 51, 58), lw=2.1,
        ),
    ),
    "bird-archetype-kingfisher.svg": dict(
        label="Kingfisher, archetype plate",
        markup=perched(
            # Outsized head, stubby tail, dagger bill — the whole family in three cues.
            head=(41.5, 24), r=8.6,
            body=("M39 25 C43.5 29.5 44.5 37.5 41 44 C37 50.6 28 52 22.5 47.5 "
                  "C17.5 43.2 19 35 24.5 30.5 C29.5 26.5 35 23.6 39 25 Z"),
            wing=("M36 30 C39.8 32 41 37 38.5 41.8 C36 46.5 29.5 49 25 47.5 "
                  "C26.6 43 29.8 36.5 32.8 33 C34 31.4 35 30 36 30 Z"),
            bill="M43 20.8 L62 26 L43 28.6 Z",
            tail="M23 47 C20 48.6 16.6 51 14.6 53.4 C18 53 21.6 51.6 24 50 Z",
            legs=(31, 37, 51.5, 56.5), lw=1.4,
        ),
    ),
    "bird-archetype-waterbird.svg": dict(
        label="Wading bird, archetype plate",
        markup=(
            f'<g fill="{INK}">'
            # Compact body low in the frame, long legs below it.
            '<path d="M34 38 C41 38 46.5 42 46.5 47 C46.5 51.6 41.5 55 34.5 55 '
            'C27 55 22 51.4 22 46.8 C22 42 27 38 34 38 Z"/>'
            f'<path d="M12 52 C17 48.5 21 46.4 23.5 45.6 C22.5 48.6 19 51.4 14.5 53 Z"/>'
            # S-neck as a stroke: a filled S is fragile, a stroked one is not.
            f'<path d="M38 39 C39.5 33 36.5 28.5 37.5 24 C38.4 19.6 41.5 16.6 44.5 15.5" '
            f'stroke="{INK}" stroke-width="4.2" stroke-linecap="round" fill="none"/>'
            '<circle cx="45.5" cy="14.5" r="4.6"/>'
            '<path d="M47 12.4 L61 15.8 L47 18 Z"/>'
            f'<path d="M30 54.6 L28.5 62.5 M37.5 54.6 L38.5 62.5" stroke="{INK}" '
            f'stroke-width="1.6" stroke-linecap="round" fill="none"/>'
            f'<circle cx="46.6" cy="13.4" r="1.25" fill="{GROUND}"/>'
            f'</g>'
        ),
    ),
    "bird-archetype-waterfowl.svg": dict(
        label="Waterfowl, archetype plate",
        markup=(
            f'<g fill="{INK}">'
            # Body sits ON the waterline; no legs, because none are visible.
            '<path d="M26 32 C33 31 41 33 45.5 37 C49.5 40.6 49 45.4 44 47.5 '
            'C38 50 27 49.6 19 47 C13 45 11.5 41.5 15 38.5 C18 36 22 33.5 26 32 Z"/>'
            f'<path d="M43 36 C40 39.5 34 42.5 27.5 43.5 C29.5 39.6 35 36.2 43 36 Z" '
            f'fill="{GROUND}" opacity="0.32"/>'
            # Neck into head, stroked so it merges with the body cleanly.
            f'<path d="M42.5 35.5 C43.5 30.5 44 25.5 44.8 21.5" stroke="{INK}" '
            f'stroke-width="5.4" stroke-linecap="round" fill="none"/>'
            '<circle cx="45.5" cy="20" r="5.2"/>'
            # Flat duck bill, started inside the head.
            '<path d="M47 17.6 C52.5 17.4 57.5 18.4 59.5 19.8 C57.5 21.6 52.5 22.6 47 22.4 Z"/>'
            f'<circle cx="46.4" cy="18.8" r="1.25" fill="{GROUND}"/>'
            f'<path d="M4 49 H60" stroke="{SHADE}" stroke-width="1.3" opacity="0.45" fill="none"/>'
            f'<path d="M9 53 H29 M35 53 H55" stroke="{SHADE}" stroke-width="1.3" '
            f'opacity="0.28" fill="none"/>'
            f'</g>'
        ),
    ),
}


def write(pack, name, markup, label):
    path = os.path.join(ROOT, "public", "packs", pack, "img", name)
    if not os.path.isdir(os.path.dirname(path)):
        print(f"  skip {pack}/{name}: no img directory")
        return False
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(SVG.format(label=label, ground=GROUND, body=markup, fit=FIT))
    return True


def main():
    written = 0
    for pack in ("butterfly-vn", "butterfly-th", "butterfly-sg", "butterfly-min"):
        for name, spec in BUTTERFLIES.items():
            markup = butterfly(
                spec["forewing"], spec["hindwing"], spec["body"],
                antenna_flare=spec.get("antenna_flare", 9.0),
                tail=spec.get("tail", ""),
            )
            written += write(pack, name, markup, spec["label"])
    for pack in ("bird-vn", "bird-th", "bird-min"):
        for name, spec in BIRDS.items():
            written += write(pack, name, spec["markup"], spec["label"])
    print(f"wrote {written} archetype plates")


if __name__ == "__main__":
    main()
