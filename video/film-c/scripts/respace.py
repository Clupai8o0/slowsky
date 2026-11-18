"""Move a finished soundtrack onto the beat grid of the same frames played at another fps, stretching nothing.

usage: python3 scripts/respace.py IN OUT.wav --from-fps 30 --to-fps 24 [--frames-per-beat 15] [--offset 0]
       [--frames N]

Played at --to-fps instead of --from-fps, every beat of --frames-per-beat frames gets longer (or shorter).
This cuts IN (anything ffmpeg reads: a wav, an mp3, the sound of an mp4) into those beats and puts each one at
its beat's new start, as it was: when the beat got longer, silence fills the rest of it; when it got shorter,
its end is cut. Each cut is made 5 ms before the beat and fades over 5 ms, so nothing clicks and every sound on
a beat keeps its attack. Pitch and transients stay as they were, which a time stretch (ffmpeg's atempo) can't
promise: it smears clicks and doubles hits.

It stands in for the film's music re-exported at the new BPM (from its source, or by scripts/score.py when that
made it), for when there is only the finished mix: a test section, a client's mix. Percussive sound (clicks, drums, hits) comes
through whole; a sound held across a beat (a pad, a reverb tail) is cut at the beat's end and pulses.

--offset is the frame, counted from IN's start, where a beat starts (0 when IN starts on one); a part beat
before it plays from 0. --frames is the picture's length (default: IN's length at --from-fps, rounded), and OUT
is that many frames at --to-fps, to the sample: a 24-bit, 48 kHz stereo WAV.

Then it checks OUT: its length, and that every onset in IN (a jump of 12 dB or more) is in OUT at its new
place, within 10 ms. Onsets inside a fade, or in the part of a beat that was cut, are skipped and counted.
Exits 0 when the checks pass, 1 when one fails, 2 on bad arguments. Needs numpy and ffmpeg.
"""
import argparse
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
FADE = 0.005       # s: each beat is cut this long before it starts, and fades in and out over it
TOLERANCE = 0.010  # s an onset may sit from its new place


def decode(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-f", "f32le", "-ac", "2", "-ar", str(SR),
                        "-"], capture_output=True)
    if p.returncode or not p.stdout:
        sys.exit(f"ffmpeg could not read sound from {path}:\n{p.stderr.decode(errors='replace')[-600:]}")
    return np.frombuffer(p.stdout, "<f4").reshape(-1, 2).astype(float)


def write_wav(path, audio):
    q = np.round(np.clip(audio, -1, 1 - 2 ** -23) * 2 ** 23).astype("<i4")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(q.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def slices(n_in, frames, from_fps, to_fps, fpb, offset):
    """(start in IN, length, start in OUT), in samples, for every beat that IN has sound for."""
    n = round(min(fpb / from_fps, fpb / to_fps) * SR)
    k = -int(np.ceil(offset / fpb))  # the part beat before --offset, if there is one
    out = []
    while True:
        a = round(((offset + k * fpb) / from_fps - FADE) * SR)
        start = round(((offset + k * fpb) / to_fps - FADE) * SR)
        if a >= n_in or start >= frames / to_fps * SR:
            return out
        if a < 0:  # IN starts inside this beat or its lead-in: play what there is from OUT's start
            if n + a > 0:
                out.append((0, min(n + a, n_in), 0))
        else:
            out.append((a, min(n, n_in - a), start))
        k += 1


def respace(x, frames, from_fps, to_fps, fpb, offset):
    n_out = round(frames / to_fps * SR)
    y = np.zeros((n_out, 2))
    f = int(FADE * SR)
    ramp = (1 - np.cos(np.pi * np.arange(f) / f)) / 2
    for a, n, start in slices(len(x), frames, from_fps, to_fps, fpb, offset):
        s = x[a:a + n].copy()
        if a > 0:
            s[:min(f, n)] *= ramp[:min(f, n), None]
        s[-min(f, n):] *= ramp[::-1][-min(f, n):, None]
        s = s[:max(0, n_out - start)]
        y[start:start + len(s)] += s
    return y


def onsets(x):
    """Times (s) where the sound jumps 12 dB or more over the 20 ms before, above -50 dBFS; 1 ms steps."""
    hop = SR // 1000
    m = x.mean(1)
    e = (m[:len(m) // hop * hop].reshape(-1, hop) ** 2).mean(1)
    before = np.array([e[max(0, i - 20):i].max() if i else 0.0 for i in range(len(e))])
    hit = (e > 16 * before) & (e > 1e-5)
    found, last = [], -1.0
    for i in np.flatnonzero(hit):
        if i / 1000 - last > 0.030:
            found.append(i / 1000)
            last = i / 1000
    return np.array(found)


def check(x, y, frames, from_fps, to_fps, fpb, offset):
    """(onsets matched, skipped, worst miss in s, failures)."""
    fails = []
    want = round(frames / to_fps * SR)
    if len(y) != want:
        fails.append(f"OUT is {len(y)} samples, not {want}")
    old, new = fpb / from_fps, fpb / to_fps
    got = onsets(y)
    matched, skipped, worst = 0, 0, 0.0
    for t in onsets(x):
        k = int(np.floor((t * from_fps - offset) / fpb + FADE / old))  # the beat whose slice holds t
        into = t - (offset + k * fpb) / from_fps                        # s after that beat starts
        kept = min(old, new) - 2 * FADE                                  # the part of the beat before its fade-out
        if k < 0 or into > kept or (offset + k * fpb) / to_fps >= frames / to_fps:
            skipped += 1
            continue
        t_out = (offset + k * fpb) / to_fps + into
        miss = np.abs(got - t_out).min() if len(got) else np.inf
        if miss > TOLERANCE:
            fails.append(f"the onset at {t:.3f} s in IN is not at {t_out:.3f} s in OUT")
        else:
            matched += 1
            worst = max(worst, miss)
    return matched, skipped, worst, fails


def main():
    ap = argparse.ArgumentParser(description="Move a soundtrack onto the beat grid of the same frames at another fps.")
    ap.add_argument("inp", metavar="IN", help="the sound, or a video with sound")
    ap.add_argument("out", metavar="OUT.wav", help="where to write the respaced sound")
    ap.add_argument("--from-fps", type=int, required=True, help="the rate IN's picture was made for, e.g. 30")
    ap.add_argument("--to-fps", type=int, required=True, help="the rate the picture plays at now, e.g. 24")
    ap.add_argument("--frames-per-beat", type=int, default=15, help="frames in a beat (default 15)")
    ap.add_argument("--offset", type=int, default=0, help="the frame where a beat starts (default 0)")
    ap.add_argument("--frames", type=int, help="the picture's length in frames (default: IN's length)")
    a = ap.parse_args()
    fpb = a.frames_per_beat
    if a.from_fps < 1 or a.to_fps < 1:
        ap.error("--from-fps and --to-fps must be 1 or more")
    if fpb < 1:
        ap.error("--frames-per-beat must be 1 or more")
    if a.frames is not None and a.frames < 1:
        ap.error("--frames must be 1 or more")
    if not 0 <= a.offset < fpb:
        ap.error(f"--offset must be 0-{fpb - 1}: a beat starts at one of IN's first {fpb} frames")
    if Path(a.out).suffix.lower() != ".wav":
        ap.error("OUT must be a .wav")
    if not Path(a.inp).is_file():
        ap.error(f"{a.inp} is not a file")

    x = decode(a.inp)
    exact = len(x) / SR * a.from_fps
    frames = a.frames if a.frames is not None else round(exact)
    if a.frames is None and abs(exact - frames) > 0.5:
        print(f"note: IN is {exact:.2f} frames long at {a.from_fps} fps; using {frames}")
    if frames < 1:
        ap.error("IN is shorter than one frame")
    y = respace(x, frames, a.from_fps, a.to_fps, fpb, a.offset)
    write_wav(a.out, y)
    back = decode(a.out)
    old_bpm, new_bpm = 60 * a.from_fps / fpb, 60 * a.to_fps / fpb
    print(f"respace: {frames} frames, {a.from_fps} -> {a.to_fps} fps ({old_bpm:g} -> {new_bpm:g} BPM), "
          f"{len(x) / SR:.3f} -> {len(back) / SR:.3f} s; beats every {fpb / a.to_fps:.4f} s")
    matched, skipped, worst, fails = check(x, back, frames, a.from_fps, a.to_fps, fpb, a.offset)
    print(f"{a.out}: {matched} onsets moved with their beats, worst {worst * 1000:.1f} ms off"
          + (f"; {skipped} skipped (in a fade or a cut-off part)" if skipped else ""))
    for line in fails[:10]:
        print("FAIL: " + line)
    if len(fails) > 10:
        print(f"FAIL: ... and {len(fails) - 10} more")
    print("all checks pass" if not fails else f"{len(fails)} checks failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
