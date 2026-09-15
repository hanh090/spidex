#!/usr/bin/env python3
"""
Scientific Specimen Plate Auditor CLI
Part of spidex:specimen-plate skill.
Audits plates for 1024x1024 resolution, JPEG format, size, corner/border luminance (shadowless), and specimen coverage.
"""
import os
import sys
import glob
import argparse
from PIL import Image
import numpy as np

def audit_plate(path):
    issues = []
    size = os.path.getsize(path)
    if size < 50000:
        issues.append(f"File size too small ({size} bytes)")
    
    try:
        with Image.open(path) as im:
            if im.format != "JPEG":
                issues.append(f"Invalid format: {im.format} (expected JPEG)")
            if im.size != (1024, 1024):
                issues.append(f"Invalid dimensions: {im.size} (expected 1024x1024)")
            
            rgb = im.convert("RGB")
            arr = np.asarray(rgb, dtype=float)
            
            # 1. Check 6 border inspection points for shadows or dark background bleed
            points = [(20, 20), (1004, 20), (20, 1004), (1004, 1004), (512, 20), (512, 1004)]
            min_lum = 255
            for p in points:
                px = rgb.getpixel(p)
                lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]
                if lum < min_lum:
                    min_lum = lum
            
            # Calibrated for a pure white background. A tint or halo that a
            # tinted-paper plate could hide still fails this threshold.
            if min_lum < 248:
                issues.append(f"Border luminance too low ({min_lum:.1f} < 248), possible drop shadow or non-white background")

            # 2. Specimen bounding box and coverage
            corners = np.concatenate([arr[:10, :10], arr[:10, -10:], arr[-10:, :10], arr[-10:, -10:]], axis=0)
            bg = np.mean(corners, axis=(0, 1))
            diff = np.max(np.abs(arr - bg), axis=2)
            coords = np.argwhere(diff > 25)
            if len(coords) > 0:
                y0, x0 = coords.min(axis=0)
                y1, x1 = coords.max(axis=0)
                w, h = x1 - x0, y1 - y0
                coverage_w = w / 1024.0 * 100
                coverage_h = h / 1024.0 * 100
                if coverage_w < 65 and coverage_h < 65:
                    issues.append(f"Specimen appears shrunk (<65% coverage: {w}x{h}, {coverage_w:.1f}%w, {coverage_h:.1f}%h)")
    except Exception as e:
        issues.append(f"Corrupt or unreadable image: {e}")

    return issues

def main():
    parser = argparse.ArgumentParser(description="Audit specimen plates for compliance with spidex:specimen-plate standards.")
    parser.add_argument("--dir", default="public/museum_specimens", help="Directory containing specimen plates.")
    parser.add_argument("--glob", default="*_plate.jpg", help="Glob pattern for plates (e.g. butterfly_*_plate.jpg).")
    args = parser.parse_args()

    plates = sorted(glob.glob(os.path.join(args.dir, args.glob)))
    print("=" * 60)
    print("🔬 SCIENTIFIC SPECIMEN PLATE AUDIT")
    print(f"Directory: {args.dir}")
    print(f"Total Plates Found: {len(plates)}")
    print("=" * 60)

    passed = 0
    failed = 0
    for p in plates:
        name = os.path.basename(p)
        issues = audit_plate(p)
        if issues:
            failed += 1
            print(f"  ❌ {name}: {'; '.join(issues)}")
        else:
            passed += 1

    print("\n--- Summary ---")
    print(f"Passed: {passed} / {len(plates)} ({(passed/len(plates)*100 if plates else 0):.1f}%)")
    print(f"Failed: {failed}")
    print("=" * 60)

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
