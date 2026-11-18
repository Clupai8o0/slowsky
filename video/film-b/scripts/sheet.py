"""Tile every Nth frame of a rendered video into one labelled contact sheet.

usage: python3 scripts/sheet.py <video.mp4> <sheet.png> [every=6] [cols=6] [tile_w=400] [offset=0]
Each tile carries the frame number it came from, so a critique can say "frame 48". `offset` is added
to every label, for a video that starts mid-film (scripts/scene.sh passes the scene's first frame).
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) < 3:
    sys.exit(__doc__)
video, sheet = sys.argv[1], sys.argv[2]
every = int(sys.argv[3]) if len(sys.argv) > 3 else 6
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
tile_w = int(sys.argv[5]) if len(sys.argv) > 5 else 400
offset = int(sys.argv[6]) if len(sys.argv) > 6 else 0
if min(every, cols, tile_w) < 1:
    sys.exit("every, cols and tile_w must be 1 or more")

with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", video,
         "-vf", f"select='not(mod(n\\,{every}))',scale={tile_w}:-2",
         "-fps_mode", "vfr", f"{tmp}/f_%04d.png"],
        check=True,
    )
    frames = sorted(Path(tmp).glob("f_*.png"))
    if not frames:
        sys.exit("no frames extracted")
    first = Image.open(frames[0])
    tw, th = first.size
    rows = (len(frames) + cols - 1) // cols
    # the label sits in its own strip above the tile: drawn on the picture it hid the top-left
    # corner and made a heading look cropped when it was not
    pad, band = 4, 24
    out = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + band + pad) + pad), "white")
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    draw = ImageDraw.Draw(out)
    for i, f in enumerate(frames):
        x = pad + (i % cols) * (tw + pad)
        y = pad + (i // cols) * (th + band + pad)
        out.paste(Image.open(f).convert("RGB"), (x, y + band))
        label = str(offset + i * every)
        box = draw.textbbox((0, 0), label, font=font)
        draw.rectangle((x, y, x + box[2] + 10, y + band - 2), fill=(0, 0, 0))
        draw.text((x + 5, y + 1), label, fill=(255, 255, 255), font=font)
    out.save(sheet)
    print(f"sheet: {sheet} ({len(frames)} tiles, every {every} frames)")
