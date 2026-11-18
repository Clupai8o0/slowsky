"""Pick volunteer-light spots for film scene 6 on lit city pixels of bg_world (no lights in dark land or sea).
Writes video/slowsky-film/src/film/s6/lights.ts: screen px (bg shown at 1.25x, no pan)."""
import random
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
im = Image.open(ROOT / "video/slowsky-film/public/ai/bg_world.png").convert("RGB")
W, H = im.size
CLUSTERS = [(520, 470, 110, 45, 5), (400, 540, 40, 25, 2), (570, 560, 25, 30, 1), (640, 420, 60, 30, 2),
            (760, 545, 55, 18, 2), (740, 670, 30, 30, 2), (1010, 620, 50, 40, 2), (1290, 640, 90, 60, 4),
            (900, 440, 120, 35, 1), (520, 590, 80, 25, 1)]


def lit(x, y):
    best = 0
    for dx in (-2, 0, 2):
        for dy in (-2, 0, 2):
            if 0 <= x + dx < W and 0 <= y + dy < H:
                r, g, b = im.getpixel((x + dx, y + dy))
                if r > 150 and r > b + 40 and g > 90:
                    best = max(best, r)
    return best


rng = random.Random(7)
wsum = sum(c[4] for c in CLUSTERS)
pts = []
tries = 0
while len(pts) < 150 and tries < 200000:
    tries += 1
    r = rng.random() * wsum
    for c in CLUSTERS:
        r -= c[4]
        if r < 0:
            break
    x = int(c[0] + (rng.random() + rng.random() - 1) * c[2])
    y = int(c[1] + (rng.random() + rng.random() - 1) * c[3])
    if y * 1.25 > 850 or not lit(x, y):
        continue
    if any((x - a) ** 2 + (y - b) ** 2 < 36 for a, b in pts):
        continue
    pts.append((x, y))
out = ROOT / "video/slowsky-film/src/film/s6/lights.ts"
body = ",\n".join(f"  [{x * 1.25:.0f}, {y * 1.25:.0f}]" for x, y in pts)
out.write_text("// Made by video/experiments/s6_lights.py: volunteer-light spots on lit city pixels of bg_world (screen px).\n"
               f"export const LIGHTS: [number, number][] = [\n{body},\n];\n")
print(len(pts), tries)
