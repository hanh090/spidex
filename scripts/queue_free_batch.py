#!/usr/bin/env python3
"""
Helper to inspect the next queued species for free built-in generation.
"""
import json
import os

DATA_FILE = "data/vietnam_50_birds_50_butterflies.json"

def main():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    birds_queue = [b for b in data["birds"] if not b.get("plateReady")]
    bf_queue = [bf for bf in data["butterflies"] if not bf.get("plateReady")]

    print(f"=== Spidex Free Generation Queue ===")
    print(f"Remaining Birds: {len(birds_queue)}/50")
    print(f"Remaining Butterflies: {len(bf_queue)}/50")
    print(f"Total Remaining: {len(birds_queue) + len(bf_queue)}/100\n")

    print("Next 5 Birds in Queue:")
    for i, b in enumerate(birds_queue[:5], 1):
        slug = b["id"].replace("bvn-", "").replace("bird_", "")
        print(f"  {i}. {b['commonNameVi']} ({b['commonNameEn']} - {b['sciName']}) -> bird_{slug}")
        print(f"     Marks: {b['fieldMarks']}")

    print("\nNext 5 Butterflies in Queue:")
    for i, bf in enumerate(bf_queue[:5], 1):
        slug = bf["id"].replace("butterfly-", "").replace("butterfly_", "")
        print(f"  {i}. {bf['commonNameVi']} ({bf['commonNameEn']} - {bf['sciName']}) -> butterfly_{slug}")
        print(f"     Marks: {bf['fieldMarks']}")

if __name__ == "__main__":
    main()
