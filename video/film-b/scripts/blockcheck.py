"""Compare two renders of one cut frame by frame and list the frames that differ. A one-frame glitch (a
texture or a font missing for a frame) shows up as a lone frame far above its neighbours.

Per frame it takes the worst 40x40 block: the mean absolute RGB difference (0-255) inside it. Two renders
of the same code scored at most 7.1 there (median 0); a halftone tone missing for a frame scored 38-245
(22 Oct 2026). A render of changed code also differs wherever the code changed: name those frames in
--expect, and only the rest count.

usage: python3 scripts/blockcheck.py A B [--flag 20] [--expect 291-321,685] [--frames 900]
Exits 1 when a frame outside --expect is over the flag, when the two differ in length or are not --frames
long, or when ffmpeg fails to decode either one.
"""
import argparse
import subprocess
import sys

import numpy as np

K = 40


def size(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout
    w, h = (int(x) for x in out.strip().split(",")[:2])
    return w, h


def reader(path):
    return subprocess.Popen(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                            stdout=subprocess.PIPE)


def frames(spec):
    out = set()
    for part in filter(None, spec.split(",")):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out


def ranges(ns):
    runs = []
    for n in sorted(ns):
        if runs and n == runs[-1][1] + 1:
            runs[-1][1] = n
        else:
            runs.append([n, n])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in runs) or "none"


ap = argparse.ArgumentParser()
ap.add_argument("a")
ap.add_argument("b")
ap.add_argument("--flag", type=float, default=20.0)
ap.add_argument("--expect", default="", help="frames the code changed, e.g. 291-321,685")
ap.add_argument("--frames", type=int, help="how many frames each render must have, e.g. 900")
args = ap.parse_args()
# also refuses nan, which no frame is ever over
if not 0 <= args.flag <= 255:
    sys.exit(f"--flag must be between 0 and 255, not {args.flag}")

(w, h), (w2, h2) = size(args.a), size(args.b)
if (w, h) != (w2, h2):
    sys.exit(f"sizes differ: {w}x{h} vs {w2}x{h2}")
n_bytes = w * h * 3
# block edges; the last row and column of blocks are narrower when a side is not a multiple of K
ys, xs = np.arange(0, h, K), np.arange(0, w, K)
area = np.outer(np.diff(np.append(ys, h)), np.diff(np.append(xs, w)))
pa, pb = reader(args.a), reader(args.b)
worst = []
while True:
    ra, rb = pa.stdout.read(n_bytes), pb.stdout.read(n_bytes)
    if len(ra) < n_bytes or len(rb) < n_bytes:
        break
    fa = np.frombuffer(ra, np.uint8).reshape(h, w, 3).astype(np.int16)
    fb = np.frombuffer(rb, np.uint8).reshape(h, w, 3).astype(np.int16)
    e = np.abs(fa - fb).mean(axis=2)
    sums = np.add.reduceat(np.add.reduceat(e, ys, axis=0), xs, axis=1)
    worst.append(float((sums / area).max()))
# a short read is the end of that stream, so both must end at once, on a whole frame, with no bytes left over
uneven = len(ra) > 0 or len(rb) > 0
if uneven:
    pa.kill()
    pb.kill()
pa.wait()
pb.wait()
failed = [] if uneven else [p for p, proc in ((args.a, pa), (args.b, pb)) if proc.returncode != 0]
if not worst:
    sys.exit("no frames read")
worst = np.array(worst)
top = np.argsort(worst)[::-1][:8]
print(f"{len(worst)} frames compared; worst block error median {np.median(worst):.1f}, max {worst.max():.1f}")
print("top frames (frame, error):", ", ".join(f"{int(i)} {worst[i]:.1f}" for i in top))
over = {int(i) for i in np.where(worst > args.flag)[0]}
expect = frames(args.expect)
print(f"over {args.flag:g}: {ranges(over)}")
if expect:
    print(f"over {args.flag:g} outside --expect: {ranges(over - expect)}")
if uneven:
    print(f"lengths differ, or a frame is cut short: stopped after frame {len(worst) - 1}")
for p in failed:
    print(f"ffmpeg failed to decode {p}")
short = args.frames is not None and len(worst) != args.frames
if short:
    print(f"{len(worst)} frames, not {args.frames}")
sys.exit(1 if uneven or failed or short or over - expect else 0)
