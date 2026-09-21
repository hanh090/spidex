#!/usr/bin/env python3
"""
Test pipeline: Fetch specimen reference photo and convert to scientific line-art/vector drawings.
"""
import os
import sys
import json
import urllib.request
import subprocess
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageEnhance

TEST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_output")
os.makedirs(TEST_DIR, exist_ok=True)

def download_image(url, target_path):
    req = urllib.request.Request(url, headers={'User-Agent': 'Spidex-Pipeline/1.0'})
    with urllib.request.urlopen(req) as resp, open(target_path, 'wb') as f:
        f.write(resp.read())
    print(f"Downloaded: {target_path}")

def process_to_scientific_drawing(input_path, base_name):
    img = Image.open(input_path).convert('RGB')
    w, h = img.size
    # Standardize size (e.g. max 1024px)
    max_dim = 1024
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    
    gray = ImageOps.grayscale(img)
    # Enhance local contrast
    enhancer = ImageEnhance.Contrast(gray)
    contrast_img = enhancer.enhance(1.8)
    
    # 1. Difference of Gaussians (DoG) for clean sketch / contour line drawing
    blur1 = np.array(gray.filter(ImageFilter.GaussianBlur(radius=1)), dtype=np.float32)
    blur2 = np.array(gray.filter(ImageFilter.GaussianBlur(radius=3)), dtype=np.float32)
    dog = blur1 - blur2
    dog_norm = np.clip((dog + 10) * 12, 0, 255).astype(np.uint8)
    
    # Invert so lines are dark on white background
    sketch = 255 - dog_norm
    sketch_img = Image.fromarray(sketch)
    
    # Save raster line-art sketch
    sketch_path = os.path.join(TEST_DIR, f"{base_name}_sketch.png")
    sketch_img.save(sketch_path)
    print(f"Saved raster sketch: {sketch_path}")
    
    # 2. High-contrast thresholding for vectorization (potrace)
    threshold = np.mean(sketch) * 0.85
    binary = (sketch < threshold).astype(np.uint8) * 255
    bin_img = Image.fromarray(binary).convert('1')
    
    pbm_path = os.path.join(TEST_DIR, f"{base_name}.pbm")
    bin_img.save(pbm_path)
    
    # Vectorize with potrace
    svg_path = os.path.join(TEST_DIR, f"{base_name}_vector.svg")
    cmd = ["potrace", "-s", "--color", "#1f2421", "-o", svg_path, pbm_path]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"Saved SVG vector drawing: {svg_path} (size: {os.path.getsize(svg_path)} bytes)")
    else:
        print(f"Potrace error: {res.stderr}")
        
    return sketch_path, svg_path

if __name__ == "__main__":
    print("Testing specimen pipeline...")
    test_cases = [
        {
            "name": "troides_helena_dorsal",
            "url": "https://inaturalist-open-data.s3.amazonaws.com/photos/732403844/medium.jpg"
        },
        {
            "name": "troides_helena_ventral",
            "url": "https://inaturalist-open-data.s3.amazonaws.com/photos/732376991/medium.jpg"
        }
    ]
    for tc in test_cases:
        raw_path = os.path.join(TEST_DIR, f"{tc['name']}_raw.jpg")
        download_image(tc["url"], raw_path)
        process_to_scientific_drawing(raw_path, tc["name"])
