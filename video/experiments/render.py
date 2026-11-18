"""Style tests for the Slowsky 30 s demo. Throwaway: not the final edit, never shipped.

Usage: research/.venv/bin/python video/experiments/render.py STYLE   (doc | blink | instrument | product)
Writes video/experiments/out/<style>.mp4 (1920x1080, 30 fps, voice + score).
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
EXP = ROOT / "video" / "experiments"
OUT = EXP / "out"
PREV = ROOT / "research" / "data" / "previews"
SHOT = Path.home() / "Documents/projects/slowsky-design/shots/v3-desk.png"

W, H, FPS = 1920, 1080, 30
TOTAL = 29.5
TEMPO = 1.15          # voice sped up 15% (pitch kept) so speech fits about 24 s
VO_START = 0.35

NAVY = (6, 10, 24)
INK = (236, 240, 250)
DIM = (150, 160, 185)
GOLD = (222, 184, 120)

FONT_SANS = "/System/Library/Fonts/Avenir Next.ttc"
FONT_MONO = "/System/Library/Fonts/Menlo.ttc"


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


F = {
    "cap": font(FONT_SANS, 46, 5),       # Avenir Next Medium
    "cap_big": font(FONT_SANS, 96, 0),   # Bold
    "title": font(FONT_SANS, 120, 0),
    "sub": font(FONT_SANS, 44, 5),
    "small": font(FONT_SANS, 30, 5),
    "mono": font(FONT_MONO, 24),
    "mono_big": font(FONT_MONO, 34),
}

# ---------- voice timing ----------

align = json.load(open(EXP / "vo_align.json"))
chars = align["characters"]
starts = [s / TEMPO + VO_START for s in align["character_start_times_seconds"]]
ends = [e / TEMPO + VO_START for e in align["character_end_times_seconds"]]
text = "".join(chars)


def words_from_alignment():
    out, cur, t0, depth = [], "", None, 0
    for i, c in enumerate(chars):
        if c == "[":
            depth += 1
            continue
        if c == "]":
            depth -= 1
            continue
        if depth:
            continue
        if c.isspace():
            if cur:
                out.append((cur, t0, ends[i - 1]))
            cur, t0 = "", None
        else:
            if t0 is None:
                t0 = starts[i]
            cur += c
    if cur:
        out.append((cur, t0, ends[len(chars) - 1]))
    return out


WORDS = words_from_alignment()


def t_of(word):
    return starts[text.find(word)]


BEATS = {
    "pluto": t_of("Pluto"),
    "name": t_of("Slowsky"),
    "nasa": t_of("NASA"),
    "these": t_of("These"),
    "vol": t_of("Volunteers"),
    "now": t_of("Now"),
}
VO_END = WORDS[-1][2]
END_CARD = min(VO_END + 0.25, TOTAL - 2.6)


def caption_chunks(max_chars=40):
    chunks, cur = [], []
    for w in WORDS:
        trial = " ".join(x[0] for x in cur + [w])
        if cur and (len(trial) > max_chars or cur[-1][0][-1] in ".:"):
            chunks.append(cur)
            cur = [w]
        else:
            cur.append(w)
    if cur:
        chunks.append(cur)
    return [(" ".join(x[0] for x in c), c[0][1], c[-1][2] + 0.15, c) for c in chunks]


CHUNKS = caption_chunks()

# ---------- sky assets (real SPHEREx frames from the research previews; stand-ins only) ----------


def gif_frames(name, crop_top=16):
    im = Image.open(PREV / name)
    frames = []
    for k in range(getattr(im, "n_frames", 1)):
        im.seek(k)
        f = im.convert("RGB")
        f = f.crop((0, crop_top, f.width, f.height))
        frames.append(f)
    return frames


SKY = {
    "pluto": gif_frames("epsindib_D1_blink.gif"),
    "rwaur": gif_frames("rwaur_D1_12mo_pair_marked.gif"),
    "barnard": gif_frames("barnard_D6_12mo_pair_marked.gif"),
    "wise": gif_frames("wise0855_D6_coadd_blink_marked.gif"),
    "share": gif_frames("teegarden_D1_blink.gif"),
}
LABELS = {
    "rwaur": "RW Aurigae: about 1.5× brighter in a year",
    "barnard": "Barnard's Star: the ring is where Gaia predicts it",
    "wise": "WISE 0855: turns red in the D6 stack",
}


def scene_at(t):
    """Which shot is on screen at time t (shared by all styles)."""
    b = BEATS
    third = (b["vol"] - b["nasa"]) / 3
    if t < b["pluto"] - 0.1:
        return "title", 0.0
    if t < b["name"] - 0.1:
        return "pluto", b["pluto"] - 0.1
    if t < b["nasa"] - 0.1:
        return "name", b["name"] - 0.1
    if t < b["nasa"] - 0.1 + third:
        return "rwaur", b["nasa"] - 0.1
    if t < b["nasa"] - 0.1 + 2 * third:
        return "barnard", b["nasa"] - 0.1 + third
    if t < b["vol"] - 0.1:
        return "wise", b["nasa"] - 0.1 + 2 * third
    if t < END_CARD:
        return "share", b["vol"] - 0.1
    return "end", END_CARD


def blink_frame(key, t, rate=0.55):
    frames = SKY[key]
    return frames[int(t / rate) % len(frames)]


def fit(img, size, resample=Image.NEAREST):
    return img.resize((size, size), resample)


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ---------- shared text helpers ----------


def text_center(d, xy, s, f, fill=INK, anchor="mm"):
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def draw_caption(img, t, style="box", y=H - 110):
    cur = [c for c in CHUNKS if c[1] <= t < c[2]]
    if not cur:
        return
    s = cur[0][0]
    d = ImageDraw.Draw(img, "RGBA")
    f = F["cap"]
    bb = d.textbbox((W // 2, y), s, font=f, anchor="mm")
    if style == "box":
        pad = 18
        d.rounded_rectangle((bb[0] - pad, bb[1] - pad + 4, bb[2] + pad, bb[3] + pad), 12, fill=(0, 0, 0, 175))
        d.text((W // 2, y), s, font=f, fill=INK, anchor="mm")
    elif style == "shadow":
        for dx, dy in ((2, 2), (-2, 2), (2, -2), (-2, -2), (0, 3)):
            d.text((W // 2 + dx, y + dy), s, font=f, fill=(0, 0, 0, 200), anchor="mm")
        d.text((W // 2, y), s, font=f, fill=INK, anchor="mm")


def watermark(img):
    d = ImageDraw.Draw(img, "RGBA")
    d.text((W - 24, 20), "STYLE TEST · not final · prototype + research frames", font=F["mono"],
           fill=(255, 255, 255, 110), anchor="ra")


def title_card(img, t, align_left=False):
    d = ImageDraw.Draw(img, "RGBA")
    a = int(255 * ease(t / 0.4))
    if align_left:
        d.text((140, 430), "Sam · Team Clupai · Melbourne", font=F["sub"], fill=INK + (a,))
        d.text((140, 500), "Challenge: Planet X and SPHEREx", font=F["small"], fill=DIM + (a,))
    else:
        text_center(d, (W // 2, H // 2 - 30), "Sam · Team Clupai · Melbourne", F["sub"], INK + (a,))
        text_center(d, (W // 2, H // 2 + 34), "Challenge: Planet X and SPHEREx", F["small"], DIM + (a,))


def name_card(img, t, y=H // 2):
    d = ImageDraw.Draw(img, "RGBA")
    a = int(255 * ease(t / 0.35))
    text_center(d, (W // 2, y - 40), "Slowsky", F["title"], INK + (a,))
    text_center(d, (W // 2, y + 50), "Type any coordinates. Watch the sky change.", F["sub"], DIM + (a,))
    text_center(d, (W // 2, y + 110), "[tagline + live URL go here]", F["mono"], GOLD + (a,))


def end_card(img, t):
    d = ImageDraw.Draw(img, "RGBA")
    a = int(255 * ease(t / 0.4))
    text_center(d, (W // 2, 420), "Slowsky", F["title"], INK + (a,))
    text_center(d, (W // 2, 520), "[live URL]", F["sub"], GOLD + (a,))
    text_center(d, (W // 2, 640), "Data: NASA SPHEREx via IRSA (NASA/IPAC). Gaia: ESA/Gaia/DPAC.", F["small"], DIM + (a,))
    text_center(d, (W // 2, 690), "Voice: AI (ElevenLabs) · Team Clupai, Melbourne", F["small"], DIM + (a,))


def sky_backdrop(t, blur=18, dim=0.45):
    base = fit(SKY["pluto"][0], W, Image.BICUBIC).crop((0, (W - H) // 2, W, (W - H) // 2 + H))
    base = base.filter(ImageFilter.GaussianBlur(blur))
    return Image.blend(Image.new("RGB", (W, H), NAVY), base, dim)


# ---------- style A: documentary (slow push-ins, crossfades, calm) ----------

BACKDROP = None


def style_doc(t):
    global BACKDROP
    if BACKDROP is None:
        BACKDROP = sky_backdrop(0)
    scene, t0 = scene_at(t)
    lt = t - t0
    img = BACKDROP.copy()
    if scene == "title":
        title_card(img, lt)
    elif scene == "name":
        name_card(img, lt)
    elif scene == "end":
        img = Image.new("RGB", (W, H), NAVY)
        end_card(img, lt)
    else:
        z = 1.0 + 0.06 * lt / 4
        size = int(700 * z)
        sky = fit(blink_frame(scene, t, 0.7), size, Image.BICUBIC)
        cx = W // 2 if scene not in LABELS else 1300
        img.paste(sky, (cx - size // 2, 470 - size // 2))
        if scene in LABELS:
            d = ImageDraw.Draw(img, "RGBA")
            head, tail = LABELS[scene].split(":")
            d.text((140, 330), head, font=F["sub"], fill=INK)
            d.text((140, 400), tail.strip(), font=F["small"], fill=DIM)
            d.text((140, 470), "Real NASA SPHEREx data", font=F["small"], fill=GOLD)
        # crossfade in from the backdrop
        if lt < 0.35:
            img = Image.blend(BACKDROP, img, ease(lt / 0.35))
    draw_caption(img, t, "box")
    return img


# ---------- style B: blink cut (hard cuts, full-bleed pixels, kinetic words) ----------


def style_blink(t):
    scene, t0 = scene_at(t)
    lt = t - t0
    img = Image.new("RGB", (W, H), (0, 0, 0))
    if scene in ("title", "name", "end"):
        img = sky_backdrop(t, blur=6, dim=0.6)
        if scene == "title":
            title_card(img, lt + 1, align_left=True)
        elif scene == "name":
            name_card(img, lt + 1)
        else:
            end_card(img, lt + 1)
    else:
        sky = fit(blink_frame(scene, t, 0.4), W)
        img.paste(sky, (0, -(W - H) // 2))
        d = ImageDraw.Draw(img, "RGBA")
        if scene in LABELS:
            d.rectangle((0, 70, 1020, 150), fill=(0, 0, 0, 190))
            d.text((60, 110), LABELS[scene], font=F["sub"], fill=INK, anchor="lm")
        # big current word, upper centre
        cur = [w for w in WORDS if w[1] <= t < w[2] + 0.08]
        if cur:
            text_center(d, (W // 2, 330), cur[0][0].upper(), F["cap_big"], (255, 255, 255, 235))
    # white flash on every cut
    if lt < 0.06 and t > 0.2:
        img = Image.blend(img, Image.new("RGB", (W, H), (255, 255, 255)), 0.7)
    draw_caption(img, t, "shadow")
    return img


# ---------- style C: instrument (HUD read-outs, mono type, matches the Depth UI) ----------

HUD = {
    "pluto": ("Eps Ind B", "22h 04m 10s  -56° 46′ 58″", "1.00 µm · D1"),
    "rwaur": ("RW Aurigae", "05h 07m 49.5s  +30° 24′ 05″", "1.00 µm · D1"),
    "barnard": ("Barnard's Star", "17h 57m 48.5s  +04° 41′ 36″", "4.41 µm · D6"),
    "wise": ("WISE 0855−0714", "08h 55m 10.8s  -07° 14′ 43″", "D6 stack"),
    "share": ("Teegarden's Star", "02h 53m 00.9s  +16° 52′ 53″", "1.00 µm · D1"),
}


def style_instrument(t):
    scene, t0 = scene_at(t)
    lt = t - t0
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img, "RGBA")
    # faint grid
    for x in range(0, W, 120):
        d.line((x, 0, x, H), fill=(255, 255, 255, 10))
    for y in range(0, H, 120):
        d.line((0, y, W, y), fill=(255, 255, 255, 10))
    if scene in ("title", "name", "end"):
        if scene == "title":
            title_card(img, lt)
        elif scene == "name":
            name_card(img, lt)
        else:
            end_card(img, lt)
        d.text((60, H - 60), f"T+{t:05.2f}s", font=F["mono"], fill=DIM)
    else:
        size = 760
        x0, y0 = (W - size) // 2, (H - size) // 2 - 30
        frames = SKY[scene]
        k = int(t / 0.6) % len(frames)
        img.paste(fit(frames[k], size), (x0, y0))
        # reticle
        cx, cy = x0 + size // 2, y0 + size // 2
        for r in (60,):
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=GOLD + (200,), width=2)
        for a, b in ((-140, -80), (80, 140)):
            d.line((cx + a, cy, cx + b, cy), fill=GOLD + (200,), width=2)
            d.line((cx, cy + a, cx, cy + b), fill=GOLD + (200,), width=2)
        # corner ticks
        L = 28
        for (px, py, sx, sy) in ((x0, y0, 1, 1), (x0 + size, y0, -1, 1), (x0, y0 + size, 1, -1), (x0 + size, y0 + size, -1, -1)):
            d.line((px, py, px + sx * L, py), fill=INK, width=3)
            d.line((px, py, px, py + sy * L), fill=INK, width=3)
        name, coord, band = HUD[scene]
        d.text((x0, y0 - 46), name, font=F["mono_big"], fill=INK)
        d.text((x0 + size, y0 - 40), coord, font=F["mono"], fill=DIM, anchor="ra")
        d.text((x0, y0 + size + 16), f"Frame {k + 1} of {len(frames)}", font=F["mono"], fill=DIM)
        d.text((x0 + size, y0 + size + 16), band, font=F["mono"], fill=DIM, anchor="ra")
        if scene in LABELS:
            d.text((120, 300), LABELS[scene].split(":")[0], font=F["sub"], fill=INK)
            d.multiline_text((120, 360), LABELS[scene].split(":")[1].strip().replace(" in ", "\nin "),
                             font=F["small"], fill=DIM, spacing=8)
            d.text((120, 470), "REAL NASA SPHEREx DATA", font=F["mono"], fill=GOLD)
        # scan line sweeping down on a new shot
        if lt < 0.5:
            y = y0 + int(size * lt / 0.5)
            d.line((x0, y, x0 + size, y), fill=GOLD + (160,), width=2)
    draw_caption(img, t, "box", y=H - 70)
    return img


# ---------- style D: product-first (UI shot, camera moves into the player) ----------

SHOT_IMG = None
PLAYER = (513, 92, 927, 506)   # player box in the 1440x900 prototype shot


def product_frame(scene, t):
    """Prototype screenshot at 1920 wide with real frames pasted into the player."""
    global SHOT_IMG
    if SHOT_IMG is None:
        SHOT_IMG = Image.open(SHOT).convert("RGB").resize((W, int(900 * W / 1440)), Image.LANCZOS)
    img = SHOT_IMG.copy()
    s = W / 1440
    x0, y0, x1, y1 = (int(v * s) for v in PLAYER)
    key = scene if scene in SKY else "rwaur"
    sky = blink_frame(key, t, 0.6).resize((x1 - x0, y1 - y0), Image.NEAREST)
    img.paste(sky, (x0, y0))
    return img, (x0, y0, x1, y1)


def camera(img, box, z):
    """Zoom z (0 = full frame, 1 = tight on box)."""
    bx0, by0, bx1, by1 = box
    pad = 140
    tx0, ty0 = bx0 - pad * 2.2, by0 - pad
    tw = (bx1 - bx0) + pad * 4.4
    th = tw * H / W
    cx0 = 0 + (tx0 - 0) * z
    cy0 = 0 + (ty0 - 0) * z
    cw = W + (tw - W) * z
    ch = cw * H / W
    return img.crop((int(cx0), int(cy0), int(cx0 + cw), int(cy0 + ch))).resize((W, H), Image.BICUBIC)


def style_product(t):
    scene, t0 = scene_at(t)
    lt = t - t0
    if scene == "title":
        img = sky_backdrop(t)
        title_card(img, lt)
    elif scene == "end":
        img = Image.new("RGB", (W, H), NAVY)
        end_card(img, lt)
    else:
        frame, box = product_frame(scene, t)
        if scene == "name":
            z = 0.0
        elif scene == "pluto":
            z = 1.0 - 0.15 * ease(lt / 3)
        elif scene == "share":
            z = 0.6 * (1 - ease(lt / 1.2))
        else:
            z = 0.55 + 0.35 * ease(lt / 1.0)
        img = camera(frame, box, z)
        d = ImageDraw.Draw(img, "RGBA")
        if scene == "name":
            a = int(255 * ease(lt / 0.35))
            d.rounded_rectangle((W // 2 - 520, 730, W // 2 + 520, 930), 24, fill=(5, 8, 20, int(a * 0.85)))
            text_center(d, (W // 2, 790), "Slowsky", F["title"], INK + (a,))
            text_center(d, (W // 2, 880), "Type any coordinates. Watch the sky change.", F["small"], DIM + (a,))
        if scene in LABELS:
            d.rounded_rectangle((60, 60, 1010, 200), 18, fill=(5, 8, 20, 210))
            d.text((90, 85), LABELS[scene], font=F["small"], fill=INK)
            d.text((90, 140), "Real NASA SPHEREx data", font=F["small"], fill=GOLD)
        if scene == "share":
            d.rounded_rectangle((W - 520, 60, W - 60, 140), 40, fill=(236, 240, 250, int(255 * ease(lt / 0.3))))
            d.text((W - 290, 100), "Link copied", font=F["small"], fill=NAVY, anchor="mm")
    draw_caption(img, t, "box")
    return img


STYLES = {"doc": style_doc, "blink": style_blink, "instrument": style_instrument, "product": style_product}

# ---------- audio: voice (sped up) + an original score made here ----------


def make_audio():
    sr = 44100
    n = int(TOTAL * sr)
    t = np.arange(n) / sr
    # slow pad: A minor add9 -> F major 7 -> C -> G, soft attack, detuned pairs
    chords = [(110.0, 164.81, 220.0, 246.94), (87.31, 130.81, 220.0, 164.81),
              (130.81, 196.0, 261.63, 329.63), (98.0, 146.83, 246.94, 293.66)]
    seg = TOTAL / len(chords)
    pad = np.zeros(n)
    for i, ch in enumerate(chords):
        a, b = int(i * seg * sr), int(min(TOTAL, (i + 1) * seg + 1.5) * sr)
        tt = t[a:b] - t[a]
        env = np.minimum(1, tt / 1.8) * np.minimum(1, (tt[-1] - tt + 1e-3) / 1.5)
        for f in ch:
            pad[a:b] += env * (np.sin(2 * np.pi * f * tt) + 0.6 * np.sin(2 * np.pi * f * 1.003 * tt)) / 8
    # gentle tick on each blink cut
    for key in ("pluto", "nasa", "vol"):
        s0 = int(BEATS[key] * sr)
        k = np.arange(int(0.25 * sr))
        pad[s0:s0 + len(k)] += 0.25 * np.sin(2 * np.pi * 1760 * k / sr) * np.exp(-k / (0.03 * sr))
    pad /= np.max(np.abs(pad)) + 1e-9
    pad *= 0.9
    fade = np.minimum(1, (TOTAL - t) / 1.2)
    pad *= fade
    import wave
    with wave.open(str(EXP / "score.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((pad * 32000).astype(np.int16).tobytes())
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(EXP / "vo.mp3"), "-i", str(EXP / "score.wav"),
        "-filter_complex",
        f"[0:a]atempo={TEMPO},adelay={int(VO_START * 1000)}|{int(VO_START * 1000)},volume=1.0[v];"
        "[1:a]volume=0.16[m];[v][m]amix=inputs=2:duration=longest:normalize=0,"
        f"atrim=0:{TOTAL},loudnorm=I=-14:TP=-1.5[a]",
        "-map", "[a]", "-ar", "44100", "-ac", "2", str(EXP / "mix.wav"),
    ], check=True)


def render(style):
    OUT.mkdir(parents=True, exist_ok=True)
    if not (EXP / "mix.wav").exists():
        make_audio()
    fn = STYLES[style]
    out = OUT / f"{style}.mp4"
    p = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", str(EXP / "mix.wav"),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-t", str(TOTAL),
        "-metadata", "comment=Voiceover generated with ElevenLabs (AI). Style test, not final.",
        "-movflags", "+faststart", str(out),
    ], stdin=subprocess.PIPE)
    for i in range(int(TOTAL * FPS)):
        img = fn(i / FPS)
        watermark(img)
        p.stdin.write(img.convert("RGB").tobytes())
    p.stdin.close()
    p.wait()
    print(out)


if __name__ == "__main__":
    for s in sys.argv[1:] or STYLES:
        render(s)
