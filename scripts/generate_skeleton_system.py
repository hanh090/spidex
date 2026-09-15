#!/usr/bin/env python3
"""
Procedural Anatomical Skeleton & Key-Filling System for Spidex.
Builds pure vector SVG anatomical templates (skeletons) and applies
species-specific diagnostic color & pattern keys.
"""
import os

OUTPUT_DIR = "museum_specimens"
PUBLIC_DIR = "public/museum_specimens"
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(PUBLIC_DIR, exist_ok=True)

# ==============================================================================
# 1. BUTTERFLY ANATOMICAL SKELETON & SPECIES SYSTEM
# ==============================================================================

def render_butterfly_svg(species_key=None, show_labels=False):
    """
    Renders an anatomical butterfly specimen at 100% full symmetrical spread.
    If species_key is None, renders the structural wireframe skeleton.
    """
    # Color definitions per species
    if species_key == "helena":
        fw_ground = "#141416"
        fw_streak = "#2a2a2e"
        hw_base = "#141416"
        hw_cell = "#f2b705"    # Brilliant golden yellow
        hw_border = "#141416"
        hw_spots = "#f2b705"
        body_col = "#141416"
        abd_segments = "#d49a00"
        tail_present = False
    elif species_key == "sarpedon":
        fw_ground = "#181719"
        fw_streak = "#1fc8b2"    # Luminous turquoise medial band
        hw_base = "#181719"
        hw_cell = "#1fc8b2"
        hw_border = "#181719"
        hw_spots = "#181719"
        body_col = "#1e1d21"
        abd_segments = "#2d2c33"
        tail_present = False
    elif species_key == "polytes":
        fw_ground = "#18181a"
        fw_streak = "#28282c"
        hw_base = "#18181a"
        hw_cell = "#f4f3ed"    # White band across hindwing
        hw_border = "#18181a"
        hw_spots = "#c9242b"   # Red submarginal lunules
        body_col = "#18181a"
        abd_segments = "#28282c"
        tail_present = True
    elif species_key == "genutia":
        fw_ground = "#e66012"  # Bright orange
        fw_streak = "#ffffff"  # White apical spots
        hw_base = "#e66012"
        hw_cell = "#e66012"
        hw_border = "#161517"
        hw_spots = "#ffffff"
        body_col = "#161517"
        abd_segments = "#8a3c0e"
        tail_present = False
    else:
        # Wireframe Skeleton mode
        fw_ground = "#f8f9fa"
        fw_streak = "#edf2f7"
        hw_base = "#f8f9fa"
        hw_cell = "#edf2f7"
        hw_border = "#f8f9fa"
        hw_spots = "#edf2f7"
        body_col = "#e2e8f0"
        abd_segments = "#cbd5e1"
        tail_present = True

    stroke_col = "#0f172a" if not species_key else "#0a0a0c"
    stroke_w = "2" if show_labels else "1.5"
    
    svg = []
    svg.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="100%" height="100%">')
    svg.append('  <rect width="600" height="600" fill="#fbfaf7"/>')
    svg.append('  <g transform="translate(300, 300)">')

    # Symmetric wing rendering function
    def render_wings(side=1):
        s = side # 1 for right, -1 for left
        # Forewing outer contour
        fw_path = f"M 0 -30 Q {s*80} -140 {s*250} -210 Q {s*260} -120 {s*200} -20 Q {s*120} 20 0 0 Z"
        # Forewing discal cell
        fw_discal = f"M 0 -20 Q {s*60} -70 {s*130} -100 Q {s*110} -40 {s*60} -20 Z"
        # Forewing apical band / streaks
        fw_apex1 = f"M {s*130} -100 Q {s*190} -150 {s*240} -195 Q {s*230} -160 {s*180} -115 Z"
        fw_apex2 = f"M {s*120} -80 Q {s*180} -100 {s*220} -120 Q {s*200} -80 {s*150} -60 Z"
        
        # Hindwing outer contour
        if tail_present and species_key == "polytes":
            hw_path = f"M 0 0 Q {s*100} -10 {s*170} 60 Q {s*150} 140 {s*130} 180 L {s*145} 230 L {s*125} 220 Q {s*80} 210 0 80 Z"
        else:
            hw_path = f"M 0 0 Q {s*110} -10 {s*180} 70 Q {s*160} 170 {s*90} 210 Q {s*30} 170 0 80 Z"
            
        # Hindwing discal cell
        hw_discal = f"M 0 20 Q {s*50} 40 {s*90} 90 Q {s*50} 120 0 70 Z"
        # Hindwing central cells (for Helenas gold / Sarpedons cyan)
        hw_medial = f"M {s*60} 30 Q {s*130} 70 {s*150} 130 Q {s*100} 170 {s*40} 140 Q {s*60} 100 {s*60} 30 Z"
        # Hindwing submarginal spots
        hw_subm1 = f"M {s*130} 120 Q {s*145} 140 {s*125} 160 Q {s*115} 140 {s*130} 120 Z"
        hw_subm2 = f"M {s*105} 155 Q {s*115} 175 {s*95} 190 Q {s*85} 175 {s*105} 155 Z"

        return f'''
        <!-- Hindwing (Side {side}) -->
        <path d="{hw_path}" fill="{hw_base}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        <path d="{hw_medial}" fill="{hw_cell}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        <path d="{hw_discal}" fill="{hw_border if species_key else hw_cell}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        <path d="{hw_subm1}" fill="{hw_spots}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        <path d="{hw_subm2}" fill="{hw_spots}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>

        <!-- Forewing (Side {side}) -->
        <path d="{fw_path}" fill="{fw_ground}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        <path d="{fw_discal}" fill="{fw_streak if species_key == 'genutia' else fw_ground}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        <path d="{fw_apex1}" fill="{fw_streak}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        <path d="{fw_apex2}" fill="{fw_streak}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
        '''

    svg.append(render_wings(-1)) # Left wings
    svg.append(render_wings(1))  # Right wings

    # Anatomical Body
    svg.append(f'''
      <!-- Abdomen segments -->
      <ellipse cx="0" cy="90" rx="14" ry="70" fill="{body_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
      <line x1="-12" y1="45" x2="12" y2="45" stroke="{abd_segments}" stroke-width="2"/>
      <line x1="-13" y1="65" x2="13" y2="65" stroke="{abd_segments}" stroke-width="2"/>
      <line x1="-13" y1="85" x2="13" y2="85" stroke="{abd_segments}" stroke-width="2"/>
      <line x1="-12" y1="105" x2="12" y2="105" stroke="{abd_segments}" stroke-width="2"/>
      <line x1="-10" y1="125" x2="10" y2="125" stroke="{abd_segments}" stroke-width="2"/>
      
      <!-- Thorax -->
      <ellipse cx="0" cy="0" rx="16" ry="32" fill="{body_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
      
      <!-- Head & Eyes -->
      <ellipse cx="0" cy="-38" rx="12" ry="12" fill="{body_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
      <circle cx="-10" cy="-40" r="4.5" fill="#2d3748" stroke="{stroke_col}" stroke-width="1"/>
      <circle cx="10" cy="-40" r="4.5" fill="#2d3748" stroke="{stroke_col}" stroke-width="1"/>
      
      <!-- Antennae -->
      <path d="M -4 -48 Q -40 -120 -80 -150" fill="none" stroke="{stroke_col}" stroke-width="2"/>
      <circle cx="-80" cy="-150" r="3" fill="{stroke_col}"/>
      <path d="M 4 -48 Q 40 -120 80 -150" fill="none" stroke="{stroke_col}" stroke-width="2"/>
      <circle cx="80" cy="-150" r="3" fill="{stroke_col}"/>
    ''')

    # Anatomical Labels if Skeleton Mode
    if show_labels:
        svg.append('''
          <!-- Callout pointers & labels -->
          <g font-family="-apple-system, sans-serif" font-size="11" fill="#334155" text-anchor="middle">
            <!-- Antenna -->
            <line x1="-80" y1="-150" x2="-140" y2="-170" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="-180" y="-170">Antenna</text>
            
            <!-- Discal cell -->
            <line x1="80" y1="-60" x2="150" y2="-30" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="185" y="-26">Discal Cell</text>
            
            <!-- Apical Margin -->
            <line x1="220" y1="-180" x2="260" y2="-150" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="260" y="-136">Forewing Apex</text>
            
            <!-- Thorax -->
            <line x1="16" y1="0" x2="80" y2="5" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="105" y="9">Thorax</text>
            
            <!-- Abdomen -->
            <line x1="14" y1="90" x2="80" y2="85" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="110" y="89">Abdomen</text>
            
            <!-- Hindwing Central Area -->
            <line x1="-100" y1="100" x2="-160" y2="100" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="-210" y="104">Hindwing Cell</text>
            
            <!-- Submarginal Spots / Margin -->
            <line x1="-120" y1="170" x2="-170" y2="180" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="-215" y="184">Submarginal Lunules</text>
          </g>
        ''')

    svg.append('  </g>')
    svg.append('</svg>')
    return "".join(svg)


# ==============================================================================
# 2. BIRD ANATOMICAL SKELETON & SPECIES SYSTEM
# ==============================================================================

def render_bird_svg(species_key=None, show_labels=False):
    """
    Renders an anatomical bird lateral profile plate.
    If species_key is None, renders the anatomical wireframe skeleton.
    """
    if species_key == "bulbul": # Pycnonotus jocosus
        bill_col = "#1b1918"
        bill_shape = "short_pointed"
        has_crest = True
        crest_col = "#1b1918"
        ear_patch = "#c8242a"    # Crimson red cheek patch
        cheek_col = "#ffffff"    # Pure white cheek
        throat_col = "#ffffff"
        necklace_col = "#382d24" # Dark breast necklace
        mantle_col = "#5e4b3c"   # Warm brown back
        wing_col = "#4a3b2f"
        wing_bar = "#5e4b3c"
        breast_col = "#f7f6f2"   # Clean white belly
        undertail_col = "#c8242a"# Red undertail coverts
        tail_col = "#3a2d24"
    elif species_key == "magpie_robin": # Copsychus saularis
        bill_col = "#111111"
        bill_shape = "slender"
        has_crest = False
        crest_col = "#111111"
        ear_patch = "#111111"
        cheek_col = "#111111"
        throat_col = "#111111"   # Glossy black throat & breast
        necklace_col = "#111111"
        mantle_col = "#161619"   # Blue-black back
        wing_col = "#111111"
        wing_bar = "#ffffff"     # Broad white wing stripe
        breast_col = "#ffffff"   # Clean white belly
        undertail_col = "#ffffff"
        tail_col = "#111111"
    elif species_key == "kingfisher": # Halcyon smyrnensis
        bill_col = "#bd2026"     # Massive coral-red dagger bill
        bill_shape = "dagger"
        has_crest = False
        crest_col = "#4a2d1f"
        ear_patch = "#4a2d1f"
        cheek_col = "#ffffff"
        throat_col = "#ffffff"   # Snow white bib
        necklace_col = "#ffffff"
        mantle_col = "#17a2b8"   # Luminous turquoise back
        wing_col = "#0e7490"     # Rich blue wings with black scapulars
        wing_bar = "#4a2d1f"
        breast_col = "#4a2d1f"   # Chocolate brown underparts
        undertail_col = "#17a2b8"
        tail_col = "#17a2b8"
    elif species_key == "hoopoe": # Upupa epops
        bill_col = "#2b2a29"     # Long decurved bill
        bill_shape = "decurved"
        has_crest = True         # Fan-shaped crest
        crest_col = "#d97736"    # Cinnamon crest with black tip
        ear_patch = "#d97736"
        cheek_col = "#d97736"
        throat_col = "#d97736"
        necklace_col = "#d97736"
        mantle_col = "#d97736"
        wing_col = "#1a1a1a"     # Zebra striped black & white
        wing_bar = "#f8f9fa"
        breast_col = "#e08443"
        undertail_col = "#f8f9fa"
        tail_col = "#1a1a1a"
    else:
        # Wireframe Skeleton mode
        bill_col = "#e2e8f0"
        bill_shape = "short_pointed"
        has_crest = True
        crest_col = "#cbd5e1"
        ear_patch = "#e2e8f0"
        cheek_col = "#f1f5f9"
        throat_col = "#f8fafc"
        necklace_col = "#cbd5e1"
        mantle_col = "#e2e8f0"
        wing_col = "#cbd5e1"
        wing_bar = "#ffffff"
        breast_col = "#f8fafc"
        undertail_col = "#e2e8f0"
        tail_col = "#cbd5e1"

    stroke_col = "#0f172a" if not species_key else "#111113"
    stroke_w = "2" if show_labels else "1.5"

    svg = []
    svg.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 500" width="100%" height="100%">')
    svg.append('  <rect width="600" height="500" fill="#fbfaf7"/>')
    svg.append('  <g transform="translate(40, 20)">')

    # Perched Branch
    svg.append(f'<path d="M 60 410 Q 240 370 480 340" fill="none" stroke="#64748b" stroke-width="7" stroke-linecap="round"/>')
    svg.append(f'<path d="M 220 375 L 210 395 M 230 372 L 225 395 M 240 370 L 245 392" stroke="{stroke_col}" stroke-width="2.5" stroke-linecap="round"/>')

    # Tail
    svg.append(f'<polygon points="120,290 40,430 75,445 155,320" fill="{tail_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Body Underparts (Belly & Breast)
    svg.append(f'<path d="M 230 180 Q 290 230 250 340 Q 200 375 140 330 Z" fill="{breast_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')
    svg.append(f'<path d="M 170 330 Q 140 370 120 340 Z" fill="{undertail_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Upperparts (Mantle / Back)
    svg.append(f'<path d="M 230 150 Q 280 200 240 290 L 170 240 Q 200 180 230 150 Z" fill="{mantle_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Wing & Wingbar
    svg.append(f'<path d="M 220 180 Q 250 210 230 300 L 110 345 Q 160 250 220 180 Z" fill="{wing_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')
    # Wingbar stripe
    svg.append(f'<path d="M 210 215 Q 185 240 145 285 L 135 275 Q 180 225 205 205 Z" fill="{wing_bar}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Neck, Throat & Breast Collar
    svg.append(f'<path d="M 250 145 Q 285 185 245 230 Q 225 200 230 165 Z" fill="{necklace_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')
    svg.append(f'<path d="M 260 140 Q 295 170 255 195 Q 240 160 260 140 Z" fill="{throat_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Head & Crown
    svg.append(f'<ellipse cx="270" cy="130" rx="36" ry="32" fill="{mantle_col if not has_crest else crest_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Crest (for Bulbul or Hoopoe)
    if has_crest:
        if species_key == "hoopoe":
            # Fan-shaped Hoopoe crest
            svg.append(f'''
              <path d="M 255 105 L 220 30 L 235 25 L 265 100 Z" fill="{crest_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
              <polygon points="220,30 235,25 231,45 223,48" fill="#111111"/>
              <path d="M 265 100 L 250 20 L 265 18 L 275 98 Z" fill="{crest_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
              <polygon points="250,20 265,18 261,38 252,40" fill="#111111"/>
              <path d="M 275 98 L 285 25 L 300 28 L 285 102 Z" fill="{crest_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>
              <polygon points="285,25 300,28 296,48 287,46" fill="#111111"/>
            ''')
        else:
            # Pointed Bulbul crest
            svg.append(f'<polygon points="250,115 265,45 285,110" fill="{crest_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Cheek & Ear Patch
    svg.append(f'<ellipse cx="275" cy="140" rx="14" ry="12" fill="{cheek_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')
    if species_key == "bulbul" or ear_patch != cheek_col:
        svg.append(f'<ellipse cx="264" cy="135" rx="6" ry="5" fill="{ear_patch}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Eye & Ring
    svg.append(f'<circle cx="285" cy="125" r="5" fill="#111111"/>')
    svg.append(f'<circle cx="286" cy="124" r="1.5" fill="#ffffff"/>')

    # Bill Shapes
    if bill_shape == "dagger": # Kingfisher
        svg.append(f'<polygon points="302,120 405,145 300,145" fill="{bill_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')
    elif bill_shape == "decurved": # Hoopoe
        svg.append(f'<path d="M 302 125 Q 360 145 410 180 Q 360 152 300 135 Z" fill="{bill_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')
    else: # Standard songbird bill
        svg.append(f'<polygon points="302,122 345,132 300,138" fill="{bill_col}" stroke="{stroke_col}" stroke-width="{stroke_w}"/>')

    # Anatomical Labels if Skeleton Mode
    if show_labels:
        svg.append('''
          <!-- Callout pointers & labels -->
          <g font-family="-apple-system, sans-serif" font-size="11" fill="#334155" text-anchor="middle">
            <!-- Crest / Crown -->
            <line x1="265" y1="45" x2="210" y2="20" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="175" y="22">Crest / Crown</text>

            <!-- Bill / Culmen -->
            <line x1="345" y1="130" x2="400" y2="105" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="445" y="107">Bill (Culmen)</text>

            <!-- Ear Patch & Eye-ring -->
            <line x1="264" y1="135" x2="220" y2="120" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="175" y="122">Ear Coverts</text>

            <!-- Throat / Bib -->
            <line x1="280" y1="170" x2="350" y2="185" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="395" y="188">Throat Bib</text>

            <!-- Mantle / Back -->
            <line x1="220" y1="170" x2="160" y2="150" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="120" y="152">Mantle (Back)</text>

            <!-- Wing Coverts & Wingbar -->
            <line x1="175" y1="240" x2="110" y2="230" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="75" y="232">Wing Bar</text>

            <!-- Breast / Underparts -->
            <line x1="245" y1="260" x2="320" y2="275" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="365" y="278">Breast & Belly</text>

            <!-- Tail (Rectrices) -->
            <line x1="70" y1="400" x2="30" y2="390" stroke="#64748b" stroke-dasharray="2 2"/>
            <text x="5" y="392">Tail</text>
          </g>
        ''')

    svg.append('  </g>')
    svg.append('</svg>')
    return "".join(svg)

# ==============================================================================
# 3. EXPORT ALL SYSTEM SVGS
# ==============================================================================

files_to_generate = [
    # Butterfly Skeletons & Filled Species
    ("butterfly_skeleton.svg", lambda: render_butterfly_svg(None, True)),
    ("butterfly_helena.svg", lambda: render_butterfly_svg("helena", False)),
    ("butterfly_sarpedon.svg", lambda: render_butterfly_svg("sarpedon", False)),
    ("butterfly_polytes.svg", lambda: render_butterfly_svg("polytes", False)),
    ("butterfly_genutia.svg", lambda: render_butterfly_svg("genutia", False)),

    # Bird Skeletons & Filled Species
    ("bird_skeleton.svg", lambda: render_bird_svg(None, True)),
    ("bird_bulbul.svg", lambda: render_bird_svg("bulbul", False)),
    ("bird_magpie_robin.svg", lambda: render_bird_svg("magpie_robin", False)),
    ("bird_kingfisher.svg", lambda: render_bird_svg("kingfisher", False)),
    ("bird_hoopoe.svg", lambda: render_bird_svg("hoopoe", False)),
]

for filename, generator in files_to_generate:
    svg_content = generator()
    p1 = os.path.join(OUTPUT_DIR, filename)
    p2 = os.path.join(PUBLIC_DIR, filename)
    with open(p1, "w", encoding="utf-8") as f:
        f.write(svg_content)
    with open(p2, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Generated {filename} (size: {len(svg_content)} bytes)")

print("\nAll anatomical skeleton and key-filled species vectors ready!")
