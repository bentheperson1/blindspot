#!/usr/bin/env python3
"""
Download street-level NEGATIVE photos (no ALPR camera) from Mapillary around UTD/Richardson.

Mapillary is open, crowdsourced street imagery (CC-BY-SA) - credit "Mapillary contributors".

Setup (free, ~2 min):
  1. Make an account at mapillary.com, then go to Dashboard -> Developers -> Register application.
  2. Copy the "Client Token" (starts with MLY|...).

Run:
  python mapillary_negatives.py --token "MLY|xxxx" --n 80
  python mapillary_negatives.py --token "MLY|xxxx" --n 80 --cameras utd_flock_cams.json

  --cameras: skip images taken within --min-dist meters of any known camera
             (uses the JSON from utd_flock_cams.py), so negatives really are negatives.

Output: data/no_camera/mapillary_<spot>/<image_id>.jpg
  One subfolder per sampled spot, so grouped cross-validation keeps nearby shots together.

Standard library only. Spot-check the results: a random street photo could still
contain an unmapped camera - delete any that do.
"""

import argparse
import json
import math
import random
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://graph.mapillary.com/images"

# Area to sample: UTD + Richardson / north Dallas (south, west, north, east)
AREA = (32.93, -96.80, 33.02, -96.68)


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def get_json(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "IBMZ-Datathon/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  retrying after error: {e}", file=sys.stderr)
            time.sleep(2 * (i + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", required=True, help='Mapillary client token, "MLY|..."')
    ap.add_argument("--n", type=int, default=80, help="number of images to download")
    ap.add_argument("--per-spot", type=int, default=2, help="max images per sampled spot")
    ap.add_argument("--cameras", help="JSON list with lat/lon of known cameras to stay away from")
    ap.add_argument("--min-dist", type=float, default=150, help="meters away from known cameras")
    ap.add_argument("--out", default="data/no_camera")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    cams = []
    if args.cameras:
        cams = [(c["lat"], c["lon"]) for c in json.load(open(args.cameras))]
        print(f"Avoiding {len(cams)} known cameras (>{args.min_dist:.0f} m)")

    out = Path(args.out)
    s, w, n, e = AREA
    got, spot, attempts = 0, 0, 0
    while got < args.n and attempts < args.n * 10:
        attempts += 1
        lat, lon = random.uniform(s, n), random.uniform(w, e)
        d = 0.0025  # small box (~250 m); Mapillary rejects very large bboxes
        params = {
            "access_token": args.token,
            "fields": "id,thumb_1024_url,geometry",
            "bbox": f"{lon - d},{lat - d},{lon + d},{lat + d}",
            "limit": 20,
        }
        try:
            data = get_json(f"{API}?{urllib.parse.urlencode(params)}").get("data", [])
        except Exception as ex:
            print(f"  query failed: {ex}", file=sys.stderr)
            continue
        random.shuffle(data)

        spot_dir = out / f"mapillary_{spot:03d}"
        saved_here = 0
        for img in data:
            if saved_here >= args.per_spot or got >= args.n:
                break
            url = img.get("thumb_1024_url")
            coords = (img.get("geometry") or {}).get("coordinates")
            if not url or not coords:
                continue
            ilon, ilat = coords
            if any(haversine_m(ilat, ilon, clat, clon) < args.min_dist for clat, clon in cams):
                continue
            spot_dir.mkdir(parents=True, exist_ok=True)
            dest = spot_dir / f"{img['id']}.jpg"
            try:
                urllib.request.urlretrieve(url, dest)
            except Exception as ex:
                print(f"  download failed: {ex}", file=sys.stderr)
                continue
            saved_here += 1
            got += 1
        if saved_here:
            spot += 1
            print(f"  {got}/{args.n} images ({spot} spots)")

    print(f"Done: {got} negative images in {out}/mapillary_*. Spot-check them before training!")
    if got < args.n:
        print("Fewer than requested - Mapillary coverage may be thin; widen AREA in the script.")


if __name__ == "__main__":
    main()
