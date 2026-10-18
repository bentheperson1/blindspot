#!/usr/bin/env python3
"""
Convert every photo under a folder to a clean, GitHub-friendly JPG.

What it does to each image (.heic, .heif, .png, .webp, .bmp, .jpeg, .jpg):
  - applies the phone's rotation so photos aren't sideways
  - strips ALL metadata (EXIF, including GPS location) - important before pushing to GitHub
  - shrinks the long side to --max-size pixels (default 1600) to keep the repo small
  - saves as .jpg next to the original and deletes the original

Run (from the folder that contains data/):
  pip install pillow pillow-heif
  python convert_to_jpg.py data                 # convert in place
  python convert_to_jpg.py data --keep          # keep the originals too
  python convert_to_jpg.py data --dry-run       # just list what would change

Make a backup copy of data/ first if you want the full-resolution originals.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIF = True
except ImportError:
    HEIF = False

EXTS = {".heic", ".heif", ".png", ".webp", ".bmp", ".jpeg", ".jpg"}


def pick_dest(path, keep):
    dest = path.with_suffix(".jpg")
    if dest == path:                       # already a .jpg: overwrite in place unless --keep
        return dest.with_name(dest.stem + "_clean.jpg") if keep else dest
    if dest.exists():                      # e.g. IMG_1.heic and IMG_1.jpg both exist
        return dest.with_name(f"{path.stem}_{path.suffix.lstrip('.').lower()}.jpg")
    return dest


def convert(path, max_size, keep, dry_run):
    dest = pick_dest(path, keep)
    if dry_run:
        print(f"would convert {path} -> {dest.name}")
        return
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((max_size, max_size))
        # Re-create the image from raw pixels so no metadata (EXIF/GPS/XMP) carries over.
        clean = Image.frombytes("RGB", im.size, im.tobytes())
    tmp = dest.with_name(dest.stem + ".__tmp__.jpg")
    clean.save(tmp, "JPEG", quality=90, optimize=True)
    tmp.replace(dest)
    if not keep and path != dest:
        path.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", nargs="?", default="data")
    ap.add_argument("--max-size", type=int, default=1600, help="longest side in pixels")
    ap.add_argument("--keep", action="store_true", help="keep the original files")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = [p for p in sorted(Path(args.folder).rglob("*"))
             if p.is_file() and p.suffix.lower() in EXTS and ".__tmp__" not in p.name]
    if not files:
        sys.exit(f"No images found under {args.folder}")

    needs_heif = [p for p in files if p.suffix.lower() in (".heic", ".heif")]
    if needs_heif and not HEIF:
        sys.exit(f"{len(needs_heif)} .heic files found - run: pip install pillow-heif")

    ok = failed = 0
    for p in files:
        try:
            convert(p, args.max_size, args.keep, args.dry_run)
            ok += 1
        except Exception as e:
            failed += 1
            print(f"FAILED {p}: {e}")
    print(f"Done: {ok} converted{' (dry run)' if args.dry_run else ''}, {failed} failed.")


if __name__ == "__main__":
    main()
