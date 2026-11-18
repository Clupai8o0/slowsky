"""Round 7c (15 Nov): mix_r7b.py minus six effects (see DROP). Was: Round 7b: mix_r7.py with sound effects made in code (sfx_synth_r7b.py) instead of AI effects.

Usage: python3 video/experiments/mix_r7b.py
Same inputs always give the same file. Writes only inside experiments/: score-r7c.wav (48 kHz, 24-bit, stereo,
29.5 s, the film's score.wav format), mix-r7c.mp3 (for a phone), mix-r7c-effects-only.mp3 (the effects row alone at
its mixed level + 12 dB), mix-r7c-map.png and mix-r7c.json. It also masters the same mix with the effects muted
and compares it with film-c/public/audio/score.wav (r7a), to show the voice and bed are r7a's.

r7b level rules (more careful than r7): every effect's peak at least 10 dB under the voice's typical peak (the median
of each spoken word's peak; warm_chime over the wordmark 8 dB); an effect on a word plays a further 6 dB down unless
it can move to a gap; ambience at least 24 dB under the voice. The four comparator_clack variants take turns.

How r6 was made (found 15 Nov): voice_lines.py mixed the six takes over experiments/score.wav at volume 0.16 and ran
ffmpeg loudnorm (I=-14, TP=-1.5) into mix_lines.wav, copied as the film's score.wav (same md5). That score.wav is
render.py's make_audio(): a soft pad (A minor add9, F maj7, C, G) plus three 1760 Hz ticks placed on an old voice
take's timings, so they fell on no picture event. score.py (risers, crashes, booms) was never used for this film.
Here the pad is rebuilt with the same formula, without the ticks (real effects now mark the moments).

r7 rules, kept where r7b's are not stricter: voice on top; music and ambience duck 6 dB under every spoken line (120 ms ramps); no effect peaks above the
voice; an effect whose start lands on a word moves up to 6 frames to the nearest gap (or, when it is locked to a
picture cut, plays 10 dB lower); 15 ms fades on every clip; ambience at least 18 dB under the voice. Mastered to
-15 LUFS with score.py's true-peak limiter (ceiling -1.5 dBTP).
"""
import json
import re
import subprocess
import sys
from pathlib import Path


import numpy as np

EXP = Path(__file__).resolve().parent
FILM = EXP.parent / "film-c"
sys.path.insert(0, str(FILM / "scripts"))
import score as S  # noqa: E402  (measure, limiter, master, write_wav; SR 48000)

SR = S.SR
FPS = 24
TOTAL = 29.5
N = int(TOTAL * SR)
TARGET = -15.0
S.CEILING = -1.5
FADE = 0.015
DUCK = -6.0
DUCK_RAMP = 0.120

timing = (FILM / "src/film/timing.ts").read_text()
HIT = {k: int(v) for k, v in re.findall(r"^  (\w+): (\d+),$", timing.split("export const HIT = {")[1], re.M)}
SC = {k: (int(a), int(b)) for k, a, b in re.findall(r"\b(s\d): \{ from: (\d+), to: (\d+)", timing)}
CAPS = json.loads((FILM / "src/film/captions.ts").read_text().split("CAPTIONS: Chunk[] = ")[1].rstrip().rstrip(";"))
WORDS = [(w["from"], w["to"]) for c in CAPS for w in c["words"]]
VOICE = json.loads((EXP / "voice-r7.json").read_text())["lines"]


def at_words(f, n=1):
    """True when a spoken word overlaps frames f .. f + n - 1."""
    return any(a <= f + n - 1 and b >= f for a, b in WORDS)


def body_frames(x):
    """How many frames an effect stays within 20 dB of its own peak (its audible body, after the lead)."""
    m = np.abs(x).max(axis=1)
    loud = np.nonzero(m > 0.1 * m.max())[0]
    return max(1, int(np.ceil((loud[-1] - int(LEAD * SR)) / SR * FPS)) + 1)


# (effect, frame, dB vs the voice's speech level, locked to the picture, how long it may play in frames or None)
# Ambience rows are long beds; the rest are spot effects on a picture event (frame numbers from timing.ts / scenes).
S2, S3, S5, S6, S7, S8 = SC["s2"], SC["s3"], SC["s5"], SC["s6"], SC["s7"], SC["s8"]
PLACE = [
    ("room_tone", 0, -26, True, S3[0] + 6),                  # s1-s2: old observatory room, out by the s3 cut
    ("plates_slide", HIT["pluto"] + 8, -12, True, None),     # s2: the plates rise out of the comparator
    ("glass_ping", HIT["blinking"] - 3, -13, True, None),    # s2: the amber ring lands on the moved dot
    *[("comparator_clack", f, -9 - 2 * min(k, 3), True, None)  # s2: every plate swap (HOLD 8)
      for k, f in enumerate(range(HIT["blinking"], S2[1], 8))],
    ("air_whoosh", S2[1] - 10, -14, False, None),            # s2 -> s3: push into the dot, match cut to the panel
    ("mouse_click", HIT["star"] + 11, -8, True, None),       # s3: the pointer clicks Barnard's Star (CLICK)
    ("shutter", HIT["watch"] + 4, -10, True, None),          # s3: first hard cut of the playing picture (BLINK)
    ("counter_roll", HIT["colours"], -16, True, 24),         # s4: the counter runs to 102
    ("glass_shimmer", HIT["colours"] - 4, -14, False, None),  # s4: the 102 colour bands resolve
    *[("shutter", f, -9 - 2 * k, True, None)                 # s5: first/last frame hard cuts (HOLD 14)
      for k, f in enumerate(range(HIT["real"], S5[1] - 6, 14))],
    ("night_air", S6[0], -26, True, S8[0] + 10 - S6[0]),     # s6-s7: night over the city, out into the end card
    ("counter_roll", HIT["thousand"], -16, True, 28),        # s6: the counter runs to 3,000+
    ("low_swell", HIT["brown"], -18, False, None),           # s6: the brown dwarf rises over the limb
    ("screen_tap", S7[0] + 9, -10, False, None),             # s7: the phone lands whole (IN_B)
    ("warm_chime", S8[0] + 12, -12, False, None),            # s8: the glint over the wordmark starts
]
# r7c (the lead, 15 Nov 11:08): the "lite" option. Only the effects whose spectrograms look like real objects
# (the builder's own list); the six most likely to sound artificial or to be inaudible on a phone are dropped.
DROP = {"night_air", "glass_shimmer", "plates_slide", "glass_ping", "low_swell", "room_tone"}
PLACE = [p for p in PLACE if p[0] not in DROP]
AMBIENCE = {"room_tone", "night_air"}
SFX_DIR = EXP / "sfx-synth"
LEAD = 0.020        # each synth spot effect starts with this much silence (sfx_synth_r7b.LEAD): start it this early
PEAK_GAP = 10.0     # dB every effect peak sits under the voice's typical peak
PEAK_GAP_CHIME = 8.0
ON_WORD = -6.0      # a further drop for an effect that has to stay on a word
TAIL = 0.3          # an effect cut by the end of the film fades out over this


def decode(path, ch=2):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", str(ch), "-ar", str(SR),
                          "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).astype(np.float64)


def fades(x, a=FADE, b=FADE):
    n = len(x)
    env = np.ones(n)
    ia, ib = min(n, int(a * SR)), min(n, int(b * SR))
    env[:ia] = np.linspace(0, 1, ia, endpoint=False)
    if ib:
        env[n - ib:] = np.minimum(env[n - ib:], np.linspace(1, 0, ib))
    return x * env[:, None]


def active_rms(x):
    m = np.abs(x).max(axis=1)
    on = m > 10 ** (-45 / 20) * (m.max() + 1e-12)
    return float(np.sqrt(np.mean(x[on] ** 2))) if on.any() else 1e-9


def add(buf, x, start):
    a = max(0, start)
    b = min(len(buf), start + len(x))
    if b > a:
        buf[a:b] += x[a - start:b - start]


def pad_bed():
    """render.py make_audio()'s pad, at 48 kHz, without its three ticks."""
    t = np.arange(N) / SR
    chords = [(110.0, 164.81, 220.0, 246.94), (87.31, 130.81, 220.0, 164.81),
              (130.81, 196.0, 261.63, 329.63), (98.0, 146.83, 246.94, 293.66)]
    seg = TOTAL / len(chords)
    pad = np.zeros(N)
    for i, ch in enumerate(chords):
        a, b = int(i * seg * SR), int(min(TOTAL, (i + 1) * seg + 1.5) * SR)
        tt = t[a:b] - t[a]
        env = np.minimum(1, tt / 1.8) * np.minimum(1, (tt[-1] - tt + 1e-3) / 1.5)
        for f in ch:
            pad[a:b] += env * (np.sin(2 * np.pi * f * tt) + 0.6 * np.sin(2 * np.pi * f * 1.003 * tt)) / 8
    pad = pad / (np.max(np.abs(pad)) + 1e-9) * 0.9 * np.minimum(1, (TOTAL - t) / 1.2)
    return np.stack([pad, pad], axis=1) * 0.16  # r6's level under the voice


def main():
    voice, music, fx, amb, log, missing, v_rms, v_peak, typ = build()
    # the same voice and bed with the effects muted, mastered the same way, against r7a's film score.wav
    r7a = S.decode(FILM / "public/audio/score.wav").astype(np.float64)
    muted, _, mgain = S.master(voice + music, TARGET)
    d = np.abs(muted - r7a).max()
    ident = bool(np.array_equal(np.round(np.clip(muted, -1, 1 - 2 ** -23) * 2 ** 23),
                                np.round(r7a * 2 ** 23)))
    match = {"identical_24bit": ident, "max_diff_dbfs": round(20 * np.log10(d + 1e-12), 1),
             "residual_vs_r7a_db": round(20 * np.log10(np.sqrt(np.mean((muted - r7a) ** 2)) + 1e-12)
                                         - 20 * np.log10(np.sqrt(np.mean(r7a ** 2))), 1)}
    mix = voice + fx + amb + music
    out, cut, gain = S.master(mix, TARGET)
    match["voice_gain_change_db"] = round(gain - mgain, 2)  # the effects add loudness, so the master turns down
    dst = EXP / "score-r7c.wav"
    S.write_wav(dst, out)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(dst), "-c:a", "libmp3lame", "-b:a", "256k",
                    "-metadata", "comment=Slowsky film r7c mix. AI voice: ElevenLabs eleven_multilingual_v2. "
                    "Sound effects synthesised in code (sfx_synth_r7b.py), no AI audio.", str(EXP / "mix-r7c.mp3")],
                   check=True)
    eo = (fx + amb) * 10 ** ((gain + 12) / 20)
    eo_peak = float(np.abs(eo).max())
    if eo_peak > 10 ** (-1 / 20):
        eo *= 10 ** (-1 / 20) / eo_peak
    eo_wav = Path("/tmp/mix-r7c-effects-only.wav")
    S.write_wav(eo_wav, eo)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(eo_wav), "-c:a", "libmp3lame", "-b:a", "256k",
                    str(EXP / "mix-r7c-effects-only.mp3")], check=True)
    eo_wav.unlink()
    rows = {}
    for nm, x in (("voice", voice), ("effects", fx + amb), ("music", music)):
        y = x * 10 ** (gain / 20)
        pk = 20 * np.log10(np.abs(y).max() + 1e-12)
        lufs = S.measure(y.astype(np.float32))[0] if np.abs(y).max() > 1e-6 else float("-inf")
        rows[nm] = {"peak_dbfs": round(pk, 1), "lufs": lufs}
    total = S.measure(path=dst)
    report = {"lufs": total[0], "true_peak": total[1], "limiter_cut_db": round(cut, 2), "rows": rows,
              "voice_typical_peak_dbfs_premaster": round(20 * np.log10(typ), 1),
              "effects_only_mp3_gain_db": round(12 - max(0, 20 * np.log10(eo_peak) + 1), 1),
              "muted_vs_r7a": match, "effects": log, "missing_effects": sorted(missing)}
    (EXP / "mix-r7c.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != "effects"}, indent=1))
    for e in log:
        print(f"  {e['effect']:20s} frame {e['frame']:3d}  {e['seconds']:4.2f} s  rms {e['rms_vs_voice_db']:+6.1f}"
              f"  peak {e['peak_vs_voice_typ_peak_db']:+6.1f}  {e['note']}")
    draw_map(voice, fx + amb, music, log)


def build():
    voice = np.zeros((N, 2))
    for ln in VOICE:
        x = decode(EXP / ln["file"], 1)[int(ln["trim_s"] * SR):]
        if ln["tempo"] != 1.0:  # only an r6 take kept at r6's tempo
            sys.exit("mix_r7.py: a take needs a tempo change; this mix plays every line at speed 1.0")
        x = fades(np.repeat(x, 2, axis=1), 0.005, FADE)
        add(voice, x, round(ln["start_frame"] / FPS * SR))
    v_rms = active_rms(voice)
    v_peak = float(np.abs(voice).max())
    hop = SR // FPS
    typ = float(np.median([np.abs(voice[a * hop:(b + 1) * hop]).max() for a, b in WORDS]))
    # duck envelope: -6 dB while any line speaks (from its first to its last word), 120 ms ramps outside
    speak = np.zeros(N, bool)
    for ln in VOICE:
        speak[int(ln["start_frame"] / FPS * SR):int((ln["end_frame"] + 1) / FPS * SR)] = True
    g = np.where(speak, 10 ** (DUCK / 20), 1.0)
    r = int(DUCK_RAMP * SR)
    k = np.ones(2 * r + 1) / (2 * r + 1)
    duck = np.convolve(np.concatenate([np.ones(r), g, np.ones(r)]), k, "valid")
    music = pad_bed() * duck[:, None]
    fx = np.zeros((N, 2))
    amb = np.zeros((N, 2))
    log, missing = [], set()
    # pass 1: which file, where (an effect free of the picture moves up to 6 frames to clear a word), and
    # whether its audible body overlaps a spoken word
    rows, n_clack = [], 0
    for name, f, db, locked, cap in PLACE:
        base = name
        if name == "comparator_clack":
            name = f"comparator_clack_{'abcd'[n_clack % 4]}"
            n_clack += 1
        src = SFX_DIR / f"{name}.wav"
        if not src.exists():
            missing.add(name)
            continue
        x = decode(src)
        if cap:
            x = x[:int(cap / FPS * SR)]
        note = ""
        body = body_frames(x)
        if name not in AMBIENCE and at_words(f, body) and not locked:
            for d in (1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6):
                if not at_words(f + d, body) and f + d >= 0:
                    note = f"moved {d:+d} frames off a word"
                    f += d
                    break
        on_word = name not in AMBIENCE and at_words(f, body)
        rows.append([base, name, f, db, x, on_word, note])
    # a run of one effect (placements 16 frames apart or closer) plays at one level: if any is on a word, all drop
    for r in rows:
        run = {id(r)}
        while True:
            more = {id(q) for q in rows if q[0] == r[0] and id(q) not in run
                    and any(abs(q[2] - p[2]) <= 16 for p in rows if id(p) in run)}
            if not more:
                break
            run |= more
        if any(q[5] for q in rows if id(q) in run) and not r[5]:
            r[5] = True
            r[6] = (r[6] + " same level as its run").strip()
    for base, name, f, db, x, on_word, note in rows:
        if on_word:
            db += ON_WORD
            note = f"on a word: {-ON_WORD:.0f} dB lower" + (" (" + note + ")" if note else "")
        start = round(f / FPS * SR) - (0 if name in AMBIENCE else int(LEAD * SR))
        long_fade = 0.5 if name in AMBIENCE else FADE
        x = fades(x, long_fade, long_fade)
        if start + len(x) > N:  # runs past the film's end: fade it out before the cut
            x = fades(x[:N - start], 0, TAIL)
            note += " (tail faded at the film's end)"
        x = x * (v_rms * 10 ** (db / 20) / active_rms(x))
        gap = (PEAK_GAP_CHIME if name == "warm_chime" else PEAK_GAP) - (ON_WORD if on_word else 0)
        ceiling = typ * 10 ** (-gap / 20)
        if np.abs(x).max() > ceiling:
            x *= ceiling / np.abs(x).max()
            note += f" (peak held {gap:.0f} dB under the voice's typical peak)"
        if name in AMBIENCE:
            add(amb, x, start)
        else:
            add(fx, x, start)
        log.append({"effect": name, "frame": f, "seconds": round(len(x) / SR, 2), "on_word": on_word,
                    "rms_vs_voice_db": round(20 * np.log10(active_rms(x) / v_rms), 1),
                    "peak_vs_voice_typ_peak_db": round(20 * np.log10(np.abs(x).max() / typ), 1),
                    "note": note.strip()})
    amb *= duck[:, None]  # ambience ducks with the music under every line
    return voice, music, fx, amb, log, missing, v_rms, v_peak, typ


def draw_map(voice, fx, music, log):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    L = 708
    fig, axes = plt.subplots(3, 1, figsize=(16, 6), sharex=True)
    hop = SR // FPS
    for ax, (nm, x, col) in zip(axes, (("voice", voice, "#4a6fd8"), ("effects", fx, "#c9822b"),
                                        ("music", music, "#5a9e6f"))):
        env = np.array([np.abs(x[i * hop:(i + 1) * hop]).max() if i * hop < len(x) else 0 for i in range(L)])
        db = np.maximum(-60, 20 * np.log10(env + 1e-9))
        ax.fill_between(np.arange(L), -60, db, color=col, step="mid", linewidth=0)
        ax.set_ylim(-60, 0)
        ax.set_ylabel(f"{nm}\ndBFS", rotation=0, ha="right", va="center")
        for s, (a, b) in SC.items():
            ax.axvline(a, color="#999", linewidth=0.6)
            if ax is axes[0]:
                ax.text(a + 2, -4, s, fontsize=8, va="top")
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
    for c in CAPS:
        axes[0].text(c["from"], -58, c["text"], fontsize=6, va="bottom")
    for e in log:
        axes[1].text(e["frame"], -2, e["effect"], fontsize=6, rotation=90, va="top")
    axes[2].set_xlabel("film frame (24 fps, 708 frames)")
    axes[2].set_xlim(0, L)
    fig.suptitle("Slowsky film r7c (synth effects): voice, effects and music (levels before the master gain); grey lines = scene cuts")
    fig.tight_layout()
    fig.savefig(EXP / "mix-r7c-map.png", dpi=110)


if __name__ == "__main__":
    main()
