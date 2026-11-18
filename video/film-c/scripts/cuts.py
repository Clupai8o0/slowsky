"""Tile the frames either side of every scene cut of a rendered video into one labelled sheet.

usage: python3 cuts.py <video> <sheet.png> --cuts 120,240,360 [--before 3] [--after 3] [--tile 320]
One row per cut: `before` frames of the outgoing scene, then `after` frames of the incoming one, each labelled
with its frame number; the incoming scene's first frame has a red label. --cuts lists the first frame of every
scene (0 is ignored, since nothing comes before it); keep them in the one file your project writes scene
ranges in (src/film/timing.ts in the starter).
"""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser(description="Tile the frames either side of every scene cut into one sheet.")
ap.add_argument("video")
ap.add_argument("sheet")
ap.add_argument("--cuts", required=True, help="first frame of each scene, e.g. 120,240,360")
ap.add_argument("--before", type=int, default=3, help="frames of the outgoing scene (default 3)")
ap.add_argument("--after", type=int, default=3, help="frames of the incoming scene (default 3)")
ap.add_argument("--tile", type=int, default=320, help="tile width in px (default 320)")
args = ap.parse_args()
before, after, tile_w = args.before, args.after, args.tile
if min(before, after, tile_w) < 1:
    sys.exit("--before, --after and --tile must be 1 or more")
try:
    cuts = sorted({int(x) for x in args.cuts.split(",") if x.strip()} - {0})
except ValueError:
    sys.exit(f"--cuts must be frame numbers separated by commas, not {args.cuts!r}")
if not cuts:
    sys.exit("--cuts names no cut after frame 0")
if cuts[0] < before:
    sys.exit(f"cut {cuts[0]} has fewer than {before} frames before it")
rows = [[c + d for d in range(-before, after)] for c in cuts]
wanted = sorted({n for row in rows for n in row})

with tempfile.TemporaryDirectory() as tmp:
    pick = "+".join(f"eq(n\\,{n})" for n in wanted)
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", args.video,
         "-vf", f"select='{pick}',scale={tile_w}:-2",
         "-fps_mode", "vfr", f"{tmp}/f_%04d.png"],
        check=True,
    )
    files = sorted(Path(tmp).glob("f_*.png"))
    if len(files) != len(wanted):
        sys.exit(f"expected {len(wanted)} frames, got {len(files)}: does the video reach frame {wanted[-1]}?")
    by_frame = dict(zip(wanted, files))
    tw, th = Image.open(files[0]).size
    # labels get their own strip above each tile, so they never cover the picture's corner
    pad, gap, band = 4, 14, 24
    cols = before + after
    out = Image.new("RGB", (cols * (tw + pad) + pad + gap, len(rows) * (th + band + pad) + pad), "white")
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    draw = ImageDraw.Draw(out)
    for r, row in enumerate(rows):
        for i, n in enumerate(row):
            # a wider gap marks the cut itself
            x = pad + i * (tw + pad) + (gap if i >= before else 0)
            y = pad + r * (th + band + pad)
            out.paste(Image.open(by_frame[n]).convert("RGB"), (x, y + band))
            label = str(n)
            box = draw.textbbox((0, 0), label, font=font)
            fill = (220, 0, 90) if i == before else (0, 0, 0)
            draw.rectangle((x, y, x + box[2] + 10, y + band - 2), fill=fill)
            draw.text((x + 5, y + 1), label, fill=(255, 255, 255), font=font)
    out.save(args.sheet)
    print(f"cuts: {args.sheet} ({len(rows)} cuts, {before} frames before and {after} after each)")
