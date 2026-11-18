"""Write a promo score that fits the picture: its length, beats and hits all land on whole frames.

usage: python3 scripts/score.py --frames 480 --fps 24 [--frames-per-beat 15] [--hits drop=120,lift=240]
       [--hits-from src/film/timing.ts] [--key C] [--minor] [--out public/audio/score] [--mp3] [--lufs -14]

A beat is --frames-per-beat frames, so the beat runs at 60 * fps / frames-per-beat BPM (15 frames at 24 fps is
96 BPM), and the score is exactly --frames / --fps seconds. It has an intro without drums, a groove (kick on
every beat, clap on 2 and 4, hats between, bass, plucked chords) and a lift that adds a lead, over I-V-vi-IV
(i-VI-III-VII with --minor). The intro ends on the first hit on a downbeat in the first half and the lift
starts on the first one in the second half, so the music turns where the picture does. Every hit gets a
crash and a heavy kick, with a riser into it and the drums out for the beat before. The last hit in the
final third is the final stab (with none there, the last downbeat a bar or more before the end): the drums
stop there and the chord rings out to the end.

--hits-from reads `export const HIT = { name: frame, ... }` from a timing file; a value may be a number,
beat(n), bar(n) or a sum of those. --hits adds names to it and wins on a clash.

The mix is set to --lufs (-14 LUFS, the level the platforms play at), and a limiter that looks ahead keeps
its true peak at or under -1.5 dBTP. It writes <out>.wav (24-bit, 48 kHz), <out>.mp3 with --mp3,
and <out>-beats.json: the grid in seconds and frames, the hits, sections and chords, and the check results.
The same arguments always write the same score.

Then it checks what it wrote, the WAV and the decoded mp3: the length, the loudness (within 0.5 LU of
--lufs), the true peak (at or under -1 dBTP) and that every kick (each beat, each hit and the stab) starts
within 10 ms of its frame. Exits 0 when every check passes, 1 when one fails, 2 on bad arguments. Needs numpy and ffmpeg.
"""
import argparse
import json
import re
import subprocess
import sys
import wave
import zlib
from functools import lru_cache
from pathlib import Path

import numpy as np

SR = 48000
CEILING = -1.5     # dBTP the master is set under; the check allows -1.0, since an mp3 overshoots a little
TOLERANCE = 0.010  # s a kick may sit from its frame
KEYS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7,
        "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
SHARPS = "C C# D D# E F F# G G# A A# B".split()
FLATS = "C Db D Eb E F Gb G Ab A Bb B".split()
# one chord a bar, looped from bar 0 in the intro and from the drop on: (semitones above the key, minor chord)
MAJOR = [(0, False), (7, False), (9, True), (5, False)]   # I V vi IV
MINOR = [(0, True), (8, False), (3, False), (10, False)]  # i VI III VII
CADENCE = {False: (7, False), True: (10, False)}          # the bar before the final stab: V, or VII in minor
PENTA = {False: [0, 2, 4, 7, 9], True: [0, 3, 5, 7, 10]}
# the lead's hook over four bars: start and length in eighths, and a step up the key's pentatonic scale
HOOK = [(0, 3, 3), (3, 1, 4), (4, 4, 3), (8, 2, 1), (10, 2, 2), (12, 4, 1),
        (16, 3, 2), (19, 1, 3), (20, 4, 4), (24, 2, 4), (26, 2, 3), (28, 4, 4)]
ARP = [0, 1, 2, 3, 2, 1, 0, 2]  # the pluck's eighths, as steps up the chord
# every voice is made at a peak of 1 and mixed at these levels, so the balance is set here and nowhere else
LEVEL = {"kick": 0.9, "hit": 0.9, "clap": 0.85, "hat": 0.4, "crash": 0.35, "riser": 0.3, "boom": 0.4,
         "bass": 0.45, "pluck": 0.4, "pad": 0.25, "lead": 0.16, "stab": 0.24}


def noise(tag, n):
    return np.random.default_rng(zlib.crc32(tag.encode())).standard_normal(n)


def band(x, lo, hi=SR / 2):
    """x with everything outside lo..hi Hz taken out; for noise, before its envelope goes on."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(spec, len(x))


def unit(x):
    m = np.abs(x).max()
    return x / m if m > 0 else x


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def ramp(n, attack, release):
    e = np.ones(n)
    a, r = min(n, max(1, int(attack * SR))), min(n, max(1, int(release * SR)))
    e[:a] *= np.linspace(0, 1, a)
    e[n - r:] *= np.linspace(1, 0, r)
    return e


def sweep(freq):
    """A sine that follows freq, an array of Hz a sample."""
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


@lru_cache(None)
def kick():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    body = sweep(50 + 100 * np.exp(-t / 0.022)) * np.exp(-t / 0.13)
    click = band(noise("kick", n), 1800, 9000) * np.exp(-t / 0.0012) * 0.4
    return unit(np.tanh(1.8 * (body + click)) * ramp(n, 0.0005, 0.03))


@lru_cache(None)
def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    env = np.zeros(n)
    # a clap is a few hands a few ms apart, then the room
    for i, at in enumerate((0.0, 0.010, 0.021)):
        s = np.maximum(t - at, 0)
        env += (t >= at) * np.exp(-s / 0.0055) * np.clip(s / 0.0008, 0, 1) * (0.75 + 0.12 * i)
    s = np.maximum(t - 0.021, 0)
    env += (t >= 0.021) * np.exp(-s / 0.085) * 0.5 * np.clip(s / 0.001, 0, 1)
    return unit(band(noise("clap", n), 850, 3200) * env)


@lru_cache(None)
def hat(open_=False):
    n = int((0.32 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    x = band(noise("hat-open" if open_ else "hat", n), 7000, 15500)
    return unit(x * np.exp(-t / (0.085 if open_ else 0.016)) * ramp(n, 0.0005, 0.01))


@lru_cache(None)
def crash():
    n = int(2.4 * SR)
    t = np.arange(n) / SR
    x = band(noise("crash", n), 3000, 16000) + 0.4 * band(noise("crash-body", n), 400, 3000)
    return unit(x * np.exp(-t / 0.7) * ramp(n, 0.0005, 0.3))


@lru_cache(None)
def boom():
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    return unit(sweep(30 + 50 * np.exp(-t / 0.08)) * np.exp(-t / 0.5) * ramp(n, 0.001, 0.2))


@lru_cache(None)
def riser(n):
    """n samples of noise that swells and brightens into a hit, then drops out just before it."""
    u = np.arange(n) / n
    w = noise("riser", n)
    x = (1 - u) * band(w, 300, 2500) + u * band(w, 2500, 12000)
    env = u ** 2.5
    gap, fade = int(0.012 * SR), int(0.02 * SR)  # out 12 ms early, so the hit lands from a hush
    env[n - gap:] = 0
    env[n - gap - fade:n - gap] *= np.linspace(1, 0, fade)
    return unit(x * env)


@lru_cache(None)
def pluck(m, dur, decay=0.14):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    x = sum(np.sin(2 * np.pi * f * k * t) * np.exp(-t * k / (3 * decay)) / k ** 1.3 for k in range(1, 7))
    return unit(x * np.exp(-t / decay) * ramp(n, 0.002, 0.02))


@lru_cache(None)
def pad(notes, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * mtof(m) * (1 + d) * t) for m in notes for d in (-0.003, 0.003))
    return unit(x * ramp(n, 0.25, 0.4))


@lru_cache(None)
def bass(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.1 * np.sin(6 * np.pi * f * t)
    return unit(x * ramp(n, 0.004, 0.04) * np.exp(-t / 0.5))


@lru_cache(None)
def lead(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    vibrato = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.25, 0, 1)
    ph = 2 * np.pi * np.cumsum(mtof(m) * vibrato) / SR
    x = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph) + 0.06 * np.sin(4 * ph)
    return unit(x * ramp(n, 0.008, 0.08))


class Mix:
    def __init__(self, n):
        self.buf = np.zeros((n, 2))
        self.kicks = set()  # samples where a kick starts (every beat, hit and the stab); the check finds each one

    def add(self, x, i, level, pan=0.0, kick=False):
        if i < 0:
            x, i = x[-i:], 0
        x = x[:max(0, len(self.buf) - i)] * level
        a = (pan + 1) * np.pi / 4  # equal power, 1 in each side at the centre
        self.buf[i:i + len(x), 0] += x * np.cos(a) * np.sqrt(2)
        self.buf[i:i + len(x), 1] += x * np.sin(a) * np.sqrt(2)
        if kick and len(x):
            self.kicks.add(i)


def compose(frames, fps, fpb, hits, key, minor):
    spf = SR // fps
    bar = 4 * fpb
    beat_s = fpb / fps
    mix = Mix(frames * spf)

    def at(frame):
        return int(round(frame * spf))

    late = [f for f in hits.values() if f >= frames * 2 / 3]
    stab = max(late) if late else (frames - bar) // bar * bar
    turns = sorted(f for f in set(hits.values()) if f % bar == 0 and 0 < f < stab)
    intro = next((f for f in turns if f <= stab / 2), bar)
    lift = next((f for f in turns if f >= (intro + stab) / 2), intro + (stab - intro) // (2 * bar) * bar)
    hit_frames = set(hits.values())
    # the beat before each hit plays no drums or bass, so the hit lands out of a gap
    gaps = {-(-h // fpb) - 1 for h in hit_frames if h >= fpb}

    tonic = 48 + (key if key <= 5 else key - 12)
    names = FLATS if key in (1, 3, 5, 8, 10) else SHARPS
    prog = MINOR if minor else MAJOR

    def chord(b):
        start = b * bar
        if b == (stab - 1) // bar and b > 0 and start >= intro:
            return CADENCE[minor]
        first = 0 if start < intro else intro  # the drop lands on I, and the loop runs on through the lift
        return prog[(start - first) // bar % 4]

    def place(pcs, lo):  # each pitch class (semitones above the key) in the octave from MIDI note lo up
        return sorted(lo + (tonic + p - lo) % 12 for p in pcs)

    def tones(root, is_minor):
        return [root, root + (3 if is_minor else 4), root + 7]

    chords = []
    for b in range(-(-stab // bar)):
        start = b * bar
        root, is_minor = chord(b)
        ct = tones(root, is_minor)
        chords.append({"bar": b, "frame": start, "t": round(start / fps, 4),
                       "chord": names[(tonic + root) % 12] + ("m" if is_minor else "")})
        end = min(start + bar, stab)
        mix.add(pad(tuple(place(ct, 52) + [place([root], 64)[0]]), (end - start) / fps + 0.3), at(start), LEVEL["pad"])
        arp = place(ct, 60)
        arp.append(arp[0] + 12)
        lo = 33 + (tonic + root - 33) % 12
        for k in range(4):
            g = b * 4 + k
            f = g * fpb
            if f >= stab:
                break
            if start < intro:
                mix.add(pluck(arp[k], round(0.9 * beat_s, 4), 0.25), at(f), LEVEL["pluck"], (-0.2, 0.2)[k % 2])
                mix.add(hat(), at(f), LEVEL["hat"] * 0.5, 0.3)
                continue
            for e in range(2):
                fe = f + e * fpb / 2
                if fe < stab:
                    mix.add(pluck(arp[ARP[(2 * k + e) % 8]], round(0.5 * beat_s, 4)), at(fe), LEVEL["pluck"],
                            (-0.25, 0.25)[e])
            if g in gaps:
                continue
            if f not in hit_frames:
                mix.add(kick(), at(f), LEVEL["kick"], kick=True)
            if k in (1, 3):
                mix.add(clap(), at(f), LEVEL["clap"], -0.1)
            mix.add(hat(), at(f + fpb / 2), LEVEL["hat"], 0.3)
            if start >= lift:
                for q in (0.25, 0.75):
                    mix.add(hat(), at(f + q * fpb), LEVEL["hat"] * 0.4, 0.35)
                if k == 3:
                    mix.add(hat(True), at(f + fpb / 2), LEVEL["hat"] * 0.8, 0.3)
            mix.add(bass(lo, round(0.45 * beat_s, 4)), at(f), LEVEL["bass"])
            mix.add(bass(lo + 12, round(0.4 * beat_s, 4)), at(f + fpb / 2), LEVEL["bass"] * 0.7)
        if start >= lift:
            base = (72 if key <= 4 else 60) + key  # the hook sits between F4 and D6 in any key
            for s, length, step in HOOK[(start - lift) // bar % 4 * 3:][:3]:
                fs = start + s * fpb / 2
                if fs < stab:
                    note = base + PENTA[minor][step]
                    mix.add(lead(note, round(length * beat_s / 2 * 0.95, 4)), at(fs), LEVEL["lead"], 0.1)

    for h in sorted(hit_frames):
        if h >= fpb:
            n = at(h) - at(h - fpb)
            mix.add(riser(n), at(h) - n, LEVEL["riser"], -0.2)
        mix.add(crash(), at(h), LEVEL["crash"], 0.15)
        if h != stab:
            mix.add(kick(), at(h), LEVEL["hit"], kick=True)

    # the final stab: the drums stop and the key's chord, with its 9th, rings out to the end
    ring = (frames - stab) / fps
    third = 3 if minor else 4
    stack = [tonic - 12, tonic, tonic + 7, tonic + 12, tonic + 14, tonic + 12 + third]
    mix.add(crash(), at(stab), LEVEL["crash"], 0.15)
    mix.add(kick(), at(stab), LEVEL["hit"], kick=True)
    mix.add(boom(), at(stab), LEVEL["boom"])
    for i, m in enumerate(stack):  # strummed 6 ms apart: it sounds played, and the notes don't peak together
        mix.add(pluck(m, round(ring, 4), 1.2), at(stab) + i * int(0.006 * SR), LEVEL["stab"], (-0.3, 0.3)[i % 2])
    mix.add(pad(tuple(stack[1:]), round(ring, 4)), at(stab), LEVEL["pad"])
    chords.append({"bar": stab // bar, "frame": stab, "t": round(stab / fps, 4),
                   "chord": names[tonic % 12] + ("m" if minor else "") + "add9", "final_stab": True})

    fade = int(min(0.8, max(0.1, 0.6 * ring)) * SR)
    mix.buf[-fade:] *= ((1 + np.cos(np.pi * np.arange(fade) / fade)) / 2)[:, None]

    sections = [("intro", 0, intro), ("groove", intro, lift), ("lift", lift, stab), ("ring-out", stab, frames)]
    sections = [{"name": s, "from": a, "to": b, "from_s": round(a / fps, 4), "to_s": round(b / fps, 4)}
                for s, a, b in sections if b > a]
    return mix, stab, sections, chords


def measure(audio=None, path=None):
    """Integrated loudness (LUFS) and true peak (dBTP), by ffmpeg's EBU R128 meter."""
    src = ["-i", str(path)] if path else ["-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0"]
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *src, "-af", "ebur128=peak=true:framelog=quiet",
                        "-f", "null", "-"], input=None if path else audio.astype("<f4").tobytes(),
                       capture_output=True)
    text = p.stderr.decode(errors="replace")
    summary = text[text.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summary)
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary)
    if p.returncode or not (i and tp):
        sys.exit(f"ffmpeg could not measure the loudness of {path or 'the mix'}:\n{text[-600:]}")
    return float(i.group(1)), float(tp.group(1))


def running_min(x, w):
    """min(x[i:i + w]) for every i where the window fits, in one pass (van Herk's method)."""
    b = np.concatenate([x, np.full(-len(x) % w, np.inf)]).reshape(-1, w)
    pre = np.minimum.accumulate(b, axis=1).ravel()
    suf = np.minimum.accumulate(b[:, ::-1], axis=1)[:, ::-1].ravel()
    i = np.arange(len(x) - w + 1)
    return np.minimum(suf[i], pre[i + w - 1])


def limiter(x, ceiling, ramp=0.010, hold=0.040):
    """The gain, a sample, that keeps x's true peak under ceiling dBTP. It looks ahead: it starts down `ramp` s
    before a peak, stays down `hold` s after it and moves in straight lines, so it never clicks."""
    n = len(x)
    peak = np.zeros(n)
    for ch in x.T:  # the peaks between samples count too, as on a true-peak meter: 4 times oversampled
        up = np.fft.irfft(np.fft.rfft(ch), 4 * n) * 4
        peak = np.maximum(peak, np.abs(up).reshape(n, 4).max(axis=1))
    need = np.minimum(1, 10 ** (ceiling / 20) / np.maximum(peak, 1e-12))
    r, h = int(ramp * SR), int(hold * SR)
    # the lowest need from h samples before to r after, averaged over the r samples up to each sample: every
    # window in that average covers the sample itself, so the gain is never above what the sample needs
    low = running_min(np.concatenate([np.ones(h + r), need, np.ones(r)]), h + r)[1:n + r]
    c = np.concatenate([[0], np.cumsum(low)])
    return (c[r:] - c[:-r]) / r


def master(mix, target):
    """The mix at the target loudness with its true peak under the ceiling: limit it, measure it, and turn it
    up by what the limiting took off until it lands within 0.1 LU. Returns (audio, most dB cut, gain)."""
    gain = target - measure(mix)[0]
    for _ in range(6):
        x = mix * 10 ** (gain / 20)
        g = limiter(x, CEILING)
        y = x * g[:, None]
        lufs, _ = measure(y)
        if abs(lufs - target) < 0.1:
            break
        gain += target - lufs
    return y, float(-20 * np.log10(g.min())), gain


def write_wav(path, audio):
    q = np.round(np.clip(audio, -1, 1 - 2 ** -23) * 2 ** 23).astype("<i4")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(q.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def decode(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                       capture_output=True)
    if p.returncode:
        sys.exit(f"ffmpeg could not decode {path}:\n{p.stderr.decode(errors='replace')[-600:]}")
    return np.frombuffer(p.stdout, "<f4").reshape(-1, 2)


def kick_errors(audio, kicks):
    """For each kick (a sample), how far the best match of the kick's low end within 30 ms sits from it, in s.

    Below 300 Hz only the kick and the bass play, so a crash or a clap on the same beat can't hide it."""
    tpl = band(kick(), 0, 300)[:int(0.06 * SR)]
    w = int(0.030 * SR)
    lo = np.concatenate([np.zeros(w), band(audio.mean(1), 0, 300), np.zeros(w + len(tpl))])
    out = []
    for s in sorted(kicks):
        c = np.correlate(lo[s:s + 2 * w + len(tpl)], tpl, "valid")
        out.append((int(np.argmax(c)) - w) / SR)
    return np.array(out)


def parse_hits(spec):
    hits = {}
    for part in filter(None, (p.strip() for p in spec.split(","))):
        name, sep, value = (s.strip() for s in part.partition("="))
        if not sep or not name or not re.fullmatch(r"\d+", value):
            raise ValueError(f"--hits wants name=frame pairs, e.g. drop=120,final=420, not {part!r}")
        hits[name] = int(value)
    return hits


def read_hits(path, fpb):
    text = Path(path).read_text()
    m = re.search(r"export\s+const\s+HIT\b[^=]*=\s*\{(.*?)\}", text, re.S)
    if not m:
        raise ValueError(f"{path} has no `export const HIT = {{ ... }}`")
    body = re.sub(r"//[^\n]*|/\*.*?\*/", "", m.group(1), flags=re.S)
    hits = {}
    for entry in filter(None, (e.strip() for e in body.split(","))):
        name, _, expr = (s.strip() for s in entry.partition(":"))
        frame = 0
        for term in (t.strip() for t in expr.split("+")):
            call = re.fullmatch(r"(beat|bar)\(\s*(\d+)\s*\)", term)
            if re.fullmatch(r"\d+", term):
                frame += int(term)
            elif call:
                frame += int(call.group(2)) * fpb * (4 if call.group(1) == "bar" else 1)
            else:
                raise ValueError(f"{path}: HIT.{name} = {expr} is not a number, beat(n), bar(n) or a sum of "
                                 f"them; pass that hit with --hits instead")
        hits[name.strip("'\"")] = frame
    return hits


def check(label, path, audio, frames, fps, kicks, target):
    """The length, loudness, true peak and kicks of one written file; returns (results, failures)."""
    want = frames / fps
    got = len(audio) / SR
    lufs, tp = measure(path=path)
    err = kick_errors(audio, kicks)
    worst = float(np.abs(err).max()) if len(err) else 0.0
    fails = []
    if abs(got - want) > (1 / SR if label == "wav" else 0.025):
        fails.append(f"{path.name} is {got:.3f} s, not {want:.3f} s")
    if abs(lufs - target) > 0.5:
        fails.append(f"{path.name} is {lufs:.1f} LUFS, not {target:g}")
    if tp > -1.0:
        fails.append(f"{path.name} peaks at {tp:.1f} dBTP, over -1")
    late = [(s, e) for s, e in zip(sorted(kicks), err) if abs(e) > TOLERANCE]
    if late:
        spf = SR // fps
        fails.append(f"{path.name}: {len(late)} kicks more than {TOLERANCE * 1000:g} ms from their frame, e.g. "
                     + ", ".join(f"frame {s / spf:g} ({e * 1000:+.0f} ms)" for s, e in late[:5]))
    print(f"{path}: {got:.3f} s, {lufs:.1f} LUFS, true peak {tp:.1f} dBTP, {len(err)} kicks, "
          f"worst {worst * 1000:.0f} ms off")
    return {"length_s": round(got, 4), "lufs": lufs, "true_peak_dbtp": tp, "kicks": len(err),
            "worst_kick_ms": round(worst * 1000, 1), "passed": not fails}, fails


def main():
    ap = argparse.ArgumentParser(description="Write a promo score whose beats and hits land on whole frames.")
    ap.add_argument("--frames", type=int, required=True, help="the picture's length in frames, e.g. 480")
    ap.add_argument("--fps", type=int, required=True, help="the rate the picture plays at, e.g. 24")
    ap.add_argument("--frames-per-beat", type=int, default=15, help="frames in a beat (default 15)")
    ap.add_argument("--hits", default="", help="name=frame pairs, e.g. drop=120,final=420")
    ap.add_argument("--hits-from", help="a timing file with `export const HIT = { ... }`, e.g. src/film/timing.ts")
    ap.add_argument("--key", default="C", choices=list(KEYS), help="the key (default C)")
    ap.add_argument("--minor", action="store_true", help="a minor key, i-VI-III-VII, instead of major")
    ap.add_argument("--out", default="public/audio/score", help="the path without its extension "
                    "(default public/audio/score)")
    ap.add_argument("--mp3", action="store_true", help="also write <out>.mp3, at 320 kbit/s")
    ap.add_argument("--lufs", type=float, default=-14.0, help="the loudness to master to (default -14)")
    a = ap.parse_args()
    fpb = a.frames_per_beat
    if a.fps < 1 or SR % a.fps:
        ap.error(f"--fps {a.fps} does not split 48000 samples a second into whole frames; use 24, 25, 30, 48, 50 or 60")
    if fpb < 2:
        ap.error("--frames-per-beat must be 2 or more")
    if not 40 <= 60 * a.fps / fpb <= 300:  # the riser before each hit needs a beat of at least 32 ms
        ap.error(f"{60 * a.fps / fpb:g} BPM ({fpb} frames a beat at {a.fps} fps) is outside 40-300")
    if a.frames < 8 * fpb:
        ap.error(f"--frames {a.frames} is under two bars ({8 * fpb} frames at {fpb} frames a beat)")
    if not -30 <= a.lufs <= -6:
        ap.error(f"--lufs {a.lufs:g} is outside -30..-6")
    try:
        hits = read_hits(a.hits_from, fpb) if a.hits_from else {}
        hits.update(parse_hits(a.hits))
    except (OSError, ValueError) as e:
        ap.error(str(e))
    for name, f in hits.items():
        if not 0 <= f < a.frames:
            ap.error(f"hit {name} at frame {f} is outside the picture's frames 0-{a.frames - 1}")

    bpm = 60 * a.fps / fpb
    out = Path(a.out)
    if out.suffix in (".wav", ".mp3"):
        out = out.with_suffix("")
    out.parent.mkdir(parents=True, exist_ok=True)
    wav, mp3, grid = (out.with_name(out.name + s) for s in (".wav", ".mp3", "-beats.json"))
    print(f"score: {bpm:g} BPM ({fpb} frames a beat at {a.fps} fps); {a.frames} frames, {a.frames / a.fps:.3f} s, "
          f"{a.frames / (4 * fpb):g} bars; {a.key} {'minor' if a.minor else 'major'}")
    if not 70 <= bpm <= 180:
        print(f"note: {bpm:g} BPM is outside the usual 70-180 for a promo")
    if a.frames % (4 * fpb):
        print(f"note: {a.frames} frames is not a whole number of bars, so the score ends mid-bar")
    for name, f in sorted(hits.items(), key=lambda h: h[1]):
        if f % fpb:
            print(f"note: hit {name} at frame {f} falls between beats (beat {f / fpb:.2f}), off the groove")
        if f % 2:
            print(f"note: hit {name} is on odd frame {f}: key it to its own frame, not onTwos(), or a picture drawn "
                  f"on twos shows it a frame early")

    mix, stab, sections, chords = compose(a.frames, a.fps, fpb, hits, KEYS[a.key], a.minor)
    audio, cut, gain = master(mix.buf, a.lufs)
    write_wav(wav, audio)
    files = {"wav": wav.name}
    if a.mp3:
        p = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "320k",
                            str(mp3)], capture_output=True, text=True)
        if p.returncode:
            sys.exit(f"ffmpeg could not write {mp3}:\n{p.stderr[-600:]}")
        files["mp3"] = mp3.name
    print("sections (frames): " + ", ".join(f"{s['name']} {s['from']}-{s['to']}" for s in sections))
    if hits:
        print("hits: " + ", ".join(f"{n} {f} (beat {f / fpb:g})" for n, f in sorted(hits.items(), key=lambda h: h[1])))
    print(f"final stab at frame {stab}; master: {gain:+.1f} dB, the limiter taking up to {cut:.1f} dB off the peaks")
    if cut > 6:
        print(f"note: the limiter took {cut:.1f} dB off the loudest peaks, so the beat may pump; a quieter --lufs pumps less")

    checks, fails = {}, []
    checks["wav"], f = check("wav", wav, decode(wav), a.frames, a.fps, mix.kicks, a.lufs)
    fails += f
    if a.mp3:
        checks["mp3"], f = check("mp3", mp3, decode(mp3), a.frames, a.fps, mix.kicks, a.lufs)
        fails += f
    checks["passed"] = not fails

    beats = range(-(-a.frames // fpb))
    doc = {
        "bpm": bpm, "fps": a.fps, "frames_per_beat": fpb, "frames": a.frames, "duration_s": a.frames / a.fps,
        "time_signature": "4/4", "key": f"{a.key} {'minor' if a.minor else 'major'}",
        "beats": [round(b * fpb / a.fps, 4) for b in beats],
        "downbeats": [round(b * fpb / a.fps, 4) for b in beats if b % 4 == 0],
        "beat_frames": [b * fpb for b in beats],
        "downbeat_frames": [b * fpb for b in beats if b % 4 == 0],
        "hits": {n: {"frame": f, "t": round(f / a.fps, 4), "beat": round(f / fpb, 4), "on_beat": f % fpb == 0,
                     "sound": "final stab" if f == stab else "crash + kick"}
                 for n, f in sorted(hits.items(), key=lambda h: h[1])},
        "final_stab": {"frame": stab, "t": round(stab / a.fps, 4)},
        "sections": sections, "chords": chords, "files": files, "checks": checks,
    }
    grid.write_text(json.dumps(doc, indent=2) + "\n")
    print(grid)
    for line in fails:
        print("FAIL: " + line)
    print("all checks pass" if not fails else f"{len(fails)} checks failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
