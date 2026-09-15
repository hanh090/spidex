#!/usr/bin/env python3
"""
Scientific Specimen-to-Drawing Engine for Spidex.
Converts specimen/observation photos into high-fidelity scientific line art,
wing venation diagrams, and scalable vector drawings (SVG).
"""
import os
import sys
import argparse
import subprocess
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageEnhance

def preprocess_specimen(img, target_size=(800, 800)):
    """
    Center and scale specimen on a standardized canvas.
    """
    img = img.convert("RGB")
    w, h = img.size
    scale = min(target_size[0] / w, target_size[1] / h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    resample_filter = getattr(Image, "Resampling", Image).LANCZOS
    resized = img.resize((new_w, new_h), resample_filter)
    
    canvas = Image.new("RGB", target_size, (255, 255, 255))
    paste_x = (target_size[0] - new_w) // 2
    paste_y = (target_size[1] - new_h) // 2
    canvas.paste(resized, (paste_x, paste_y))
    return canvas

def extract_scientific_lines(img):
    """
    Uses Difference of Gaussians (DoG) and gradient magnitude
    to extract fine anatomical lines (wing veins, margins, eyespots, bill lines).
    """
    gray = ImageOps.grayscale(img)
    # Local contrast enhancement
    contrast = ImageEnhance.Contrast(gray).enhance(2.0)
    
    # Difference of Gaussians (DoG) bandpass filter
    blur_fine = contrast.filter(ImageFilter.GaussianBlur(radius=1.2))
    blur_broad = contrast.filter(ImageFilter.GaussianBlur(radius=3.5))
    
    arr_fine = np.array(blur_fine, dtype=np.float32)
    arr_broad = np.array(blur_broad, dtype=np.float32)
    
    # Bandpass edge signal
    diff = arr_broad - arr_fine
    
    # Normalize and accentuate sharp features
    diff_norm = np.clip((diff - diff.min()) / (diff.max() - diff.min() + 1e-5) * 255.0, 0, 255)
    
    # Adaptive threshold: values above mean + std are strong morphological lines
    thresh = np.mean(diff_norm) + 0.6 * np.std(diff_norm)
    binary_lines = (diff_norm > thresh).astype(np.uint8) * 255
    
    # Suppress outer borders so Potrace does not trace the canvas boundary
    border_pad = 8
    binary_lines[:border_pad, :] = 0
    binary_lines[-border_pad:, :] = 0
    binary_lines[:, :border_pad] = 0
    binary_lines[:, -border_pad:] = 0

    # Invert so background is white (255) and lines are dark (0)
    ink_on_white = 255 - binary_lines
    return Image.fromarray(ink_on_white).convert("L")

def render_vector_svg(binary_img, output_svg_path, color="#1c1a17"):
    """
    Vectorizes a high-contrast binary drawing into smooth Bézier curves using potrace.
    """
    temp_pbm = output_svg_path + ".temp.pbm"
    # Convert to 1-bit bitmap for potrace (black lines on white)
    # Potrace traces black pixels
    pbm_img = binary_img.point(lambda p: 255 if p < 128 else 0, mode="1")
    pbm_img.save(temp_pbm)
    
    cmd = [
        "potrace",
        "-i",  # Invert bitmap so dark drawn lines are traced as vector paths
        "-s",  # SVG output
        "--color", color,
        "--opttolerance", "0.2",
        "--alphamax", "1.0",
        "-o", output_svg_path,
        temp_pbm
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if os.path.exists(temp_pbm):
        os.remove(temp_pbm)
        
    if res.returncode != 0:
        raise RuntimeError(f"Potrace failed: {res.stderr}")
    return output_svg_path

def render_field_plate(img, lines_img, output_plate_path, bg_tint="#f9f7f2"):
    """
    Combines clean ink lines with subtle diagnostic color tinting (Field Guide Plate style).
    """
    w, h = img.size
    plate = Image.new("RGB", (w, h), bg_tint)
    
    # Soft diagnostic color layer
    soft_color = img.filter(ImageFilter.GaussianBlur(radius=4))
    soft_color = ImageEnhance.Color(soft_color).enhance(1.2)
    soft_color = ImageEnhance.Brightness(soft_color).enhance(1.05)
    
    # Blend color with parchment background
    blended = Image.blend(plate, soft_color, alpha=0.65)
    
    # Multiply ink lines over the color plate
    lines_rgb = ImageOps.colorize(lines_img, black="#12100e", white="#ffffff")
    final_plate = ImageChops_multiply(blended, lines_rgb)
    final_plate.save(output_plate_path, quality=90)
    return output_plate_path

def ImageChops_multiply(a, b):
    from PIL import ImageChops
    return ImageChops.multiply(a, b)

def process_specimen_to_drawing(input_path, output_dir, base_id, aspect="dorsal"):
    """
    End-to-end transformation of a specimen photo into Spidex-compatible assets:
    - {base_id}-{aspect}.svg (Vector line drawing)
    - {base_id}-{aspect}-plate.webp (Field guide color plate)
    - {base_id}-{aspect}-thumb.webp (Optimized 256x256 thumbnail)
    """
    os.makedirs(output_dir, exist_ok=True)
    orig = Image.open(input_path)
    
    # Standardize to 800x800 canvas
    canvas = preprocess_specimen(orig, (800, 800))
    
    # 1. Extract scientific line art / skeleton
    lines = extract_scientific_lines(canvas)
    
    # 2. Render Vector SVG
    svg_filename = f"{base_id}-{aspect}.svg"
    svg_path = os.path.join(output_dir, svg_filename)
    render_vector_svg(lines, svg_path)
    
    # 3. Render Field Guide Plate (Full)
    plate_filename = f"{base_id}-{aspect}-plate.webp"
    plate_path = os.path.join(output_dir, plate_filename)
    render_field_plate(canvas, lines, plate_path)
    
    # 4. Render Thumbnail (256x256)
    thumb_filename = f"{base_id}-{aspect}-thumb.webp"
    thumb_path = os.path.join(output_dir, thumb_filename)
    resample_filter = getattr(Image, "Resampling", Image).LANCZOS
    canvas.resize((256, 256), resample_filter).save(thumb_path, "WEBP", quality=80)
    
    return {
        "svg": svg_path,
        "plate": plate_path,
        "thumb": thumb_path,
        "svg_bytes": os.path.getsize(svg_path),
        "plate_bytes": os.path.getsize(plate_path),
        "thumb_bytes": os.path.getsize(thumb_path)
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert specimen photo to scientific drawing/vector plate.")
    parser.add_argument("input_image", help="Path to input photo")
    parser.add_argument("--id", required=True, help="Species ID (e.g., bm-helena)")
    parser.add_argument("--aspect", default="d", help="Aspect code: d (dorsal), v (ventral), p (profile)")
    parser.add_argument("--out-dir", default="data/drawings", help="Output directory")
    args = parser.parse_args()
    
    results = process_specimen_to_drawing(args.input_image, args.out_dir, args.id, args.aspect)
    print(f"Generated assets for {args.id} ({args.aspect}):")
    for k, v in results.items():
        print(f"  {k}: {v}")
