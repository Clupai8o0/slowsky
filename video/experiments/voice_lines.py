"""Voice the film line by line (deep, even storyteller), fit each line into its slot, mix with the score,
and write the caption timings.

Usage: python3 video/experiments/voice_lines.py [voice_id] [model]
Needs ELEVENLABS_API_KEY (from .env.local). Writes video/experiments/lines/*, mix_lines.wav and
video/slowsky-film/src/film/captions.ts + public/audio/score.wav.
"""
import base64
import json
import re
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXP = ROOT / "video" / "experiments"
FILM = ROOT / "video" / "slowsky-film"
LINES = EXP / "lines"
FPS = 24
TOTAL = 29.5

VOICE = sys.argv[1] if len(sys.argv) > 1 else "NFG5qt843uXKj4pFvR7C"  # Adam Stone - Smooth, Deep and Relaxed
MODEL = sys.argv[2] if len(sys.argv) > 2 else "eleven_multilingual_v2"

# (spoken text, shown caption groups, spoken words per group). Shown text can differ ("Slowsky", "102", "3,000").
# v2 (Sam, 14 Nov): fewer words, natural pace, a breath between every line. The team name is on the title card.
SCRIPT = [
    ("Pluto was found by blinking two photos.", ["Pluto was found", "by blinking two photos."], [3, 4]),
    ("Slow sky: pick a star, and watch the sky change.", ["Slowsky: pick a star,", "and watch the sky change."], [5, 5]),
    ("NASA's SPHEREx maps the sky in a hundred and two infrared colours.",
     ["NASA's SPHEREx maps the sky", "in 102 infrared colours."], [5, 7]),
    ("These are real SPHEREx pixels.", ["These are real SPHEREx pixels."], [5]),
    ("Volunteers found over three thousand brown dwarf candidates.",
     ["Volunteers found over 3,000", "brown dwarf candidates."], [5, 3]),
    ("Now anyone can join the hunt.", ["Now anyone can join the hunt."], [6]),
]
VOICE_FROM = 1.0   # s: the title breathes first
VOICE_TO = 27.5    # s: the end card gets the last 2 s
MIN_GAP = 0.75     # s of silence between lines; speed up (max 1.08x) only if the gaps would be shorter
LEAD = 8           # frames a scene starts before its line, so the picture leads the voice


def tts(text, prev, nxt):
    body = {
        "text": text,
        "model_id": MODEL,
        "voice_settings": {"stability": 0.62, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True},
        "previous_text": prev,
        "next_text": nxt,
    }
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
        data=json.dumps(body).encode(),
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=120))


def speech_bounds(path):
    """First and last moment of speech (silencedetect), in seconds."""
    r = subprocess.run(["ffmpeg", "-i", str(path), "-af", "silencedetect=n=-40dB:d=0.08", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                str(path)], capture_output=True, text=True).stdout)
    start, end = 0.0, dur
    ends = [float(x.split("silence_end: ")[1].split(" ")[0]) for x in r.splitlines() if "silence_end" in x]
    starts = [float(x.split("silence_start: ")[1]) for x in r.splitlines() if "silence_start" in x]
    if ends and starts and starts[0] < 0.05:
        start = ends[0]
    if starts and starts[-1] > start + 0.3:
        end = starts[-1]
    return start, end, dur


def edge_silence(path):
    r = subprocess.run(["ffmpeg", "-i", str(path), "-af", "silencedetect=n=-40dB:d=0.1", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                str(path)], capture_output=True, text=True).stdout)
    pairs, st = [], None
    for x in r.splitlines():
        if "silence_start" in x:
            st = float(x.split("silence_start: ")[1])
        elif "silence_end" in x and st is not None:
            pairs.append((st, float(x.split("silence_end: ")[1].split(" ")[0])))
            st = None
    if st is not None:
        pairs.append((st, dur))
    s0 = next((e for b, e in pairs if b < 0.05), 0.0)
    s1 = next((b + 0.06 for b, e in pairs if e > dur - 0.06 and b > s0), dur)
    return max(0.0, s0 - 0.02), s1, dur


def words_of(a):
    words, cur, t0 = [], "", None
    for k, c in enumerate(a["characters"]):
        if c.isspace():
            if cur:
                words.append((cur, t0, a["character_end_times_seconds"][k - 1]))
            cur, t0 = "", None
        else:
            if t0 is None:
                t0 = a["character_start_times_seconds"][k]
            cur += c
    if cur:
        words.append((cur, t0, a["character_end_times_seconds"][-1]))
    return words


def main():
    LINES.mkdir(parents=True, exist_ok=True)
    texts = [s[0] for s in SCRIPT]
    takes = []
    for i, (text, groups, counts) in enumerate(SCRIPT):
        raw = LINES / f"line{i + 1}.mp3"
        meta = LINES / f"line{i + 1}.json"
        cached = json.loads(meta.read_text()) if meta.exists() else {}
        if cached.get("text") == text and cached.get("voice") == VOICE and raw.exists():
            a = cached["alignment"]  # reuse the take: same words, same voice
        else:
            d = tts(text, " ".join(texts[:i])[-300:], " ".join(texts[i + 1:])[:300])
            raw.write_bytes(base64.b64decode(d["audio_base64"]))
            a = d["alignment"]
            meta.write_text(json.dumps({"text": text, "voice": VOICE, "alignment": a}))
        words = words_of(a)
        # speech bounds: only silence touching the start or the end of the take counts (pauses inside stay)
        s0, s1, dur = edge_silence(raw)
        words = [(w, x, min(y, s1)) for w, x, y in words]
        takes.append((raw, s0, s1, words))
    n = len(SCRIPT)
    speech = sum(t[2] - t[1] for t in takes)
    window = VOICE_TO - VOICE_FROM
    tempo = max(1.0, speech / (window - MIN_GAP * (n - 1)))
    gap = (window - speech / tempo) / (n - 1)
    print(f"speech {speech:.2f}s, tempo {tempo:.3f}, gap {gap:.2f}s" + ("  TOO FAST" if tempo > 1.08 else ""))
    t = VOICE_FROM
    chunks, filters, inputs, starts, ends = [], [], [], [], []
    for i, ((raw, s0, s1, words), (text, groups, counts)) in enumerate(zip(takes, SCRIPT)):
        f0 = round(t * FPS)
        starts.append(f0)
        to_f = lambda x: round(f0 + (x - s0) / tempo * FPS)
        fw = [{"w": w, "from": max(f0, to_f(x)), "to": to_f(y)} for w, x, y in words]
        k = 0
        for g, c in zip(groups, counts):
            ws = fw[k:k + c]
            k += c
            chunks.append({"text": g, "from": ws[0]["from"], "to": ws[-1]["to"] + 8, "words": ws})
        assert k == len(fw), (text, k, len(fw))
        ends.append(fw[-1]["to"])
        inputs += ["-i", str(raw)]
        ms = int(t * 1000)
        filters.append(f"[{i}:a]atrim=start={s0:.3f},asetpts=PTS-STARTPTS,atempo={tempo:.4f},adelay={ms}|{ms}[l{i}]")
        print(f"line {i + 1}: {f0}-{fw[-1]['to']}  {text}")
        t += (s1 - s0) / tempo + gap
    for a_, b_ in zip(chunks, chunks[1:]):
        a_["to"] = min(a_["to"], b_["from"])
    mix = ";".join(filters) + ";" + "".join(f"[l{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0[v]"
    mix += f";[{n}:a]volume=0.16[m];[v][m]amix=inputs=2:duration=longest:normalize=0,atrim=0:{TOTAL},loudnorm=I=-14:TP=-1.5[a]"
    out = EXP / "mix_lines.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-i", str(EXP / "score.wav"),
                    "-filter_complex", mix, "-map", "[a]", "-ar", "44100", "-ac", "2", str(out)], check=True)
    (FILM / "public/audio/score.wav").write_bytes(out.read_bytes())
    hdr = ("// Made by video/experiments/voice_lines.py from the ElevenLabs timings: one take per line, a breath\n"
           "// between lines. Film frames at 24 fps.\n"
           "export type Word = { w: string; from: number; to: number };\n"
           "export type Chunk = { text: string; from: number; to: number; words: Word[] };\n")
    (FILM / "src/film/captions.ts").write_text(hdr + "export const CAPTIONS: Chunk[] = " + json.dumps(chunks, indent=1) + ";\n")
    # scenes: s1 title, s2-s7 one per line (each holds through the breath after it), s8 end card
    L = int(TOTAL * FPS)
    # the title is a 1 s cold open; the end card starts under the last line's final word so it gets ~2.6 s
    cuts = [0, starts[0] - 4] + [x - LEAD for x in starts[1:]] + [ends[-1] - 14, L]
    names = ["Title: Team Clupai, Melbourne", "Pluto was found by blinking two photos", "Slowsky: pick a star, watch the sky change",
             "SPHEREx maps the sky in 102 infrared colours", "These are real SPHEREx pixels (Gaia rings on top)",
             "Volunteers found 3,000+ brown dwarf candidates", "Now anyone can join the hunt", "End card"]
    rows = "\n".join(f'  s{k + 1}: {{ from: {cuts[k]}, to: {cuts[k + 1]}, name: "{names[k]}" }},' for k in range(8))
    first = lambda i, w: next(x["from"] for c in chunks for x in c["words"] if re.sub("[^a-z]", "", x["w"].lower()).startswith(w) and x["from"] >= starts[i])
    hit = {"pluto": starts[0], "blinking": first(0, "blinking"), "name": starts[1], "star": first(1, "star"),
           "watch": first(1, "watch"), "nasa": starts[2], "colours": first(2, "hundred"), "these": starts[3],
           "real": first(3, "real"), "volunteers": starts[4], "thousand": first(4, "thousand"),
           "brown": first(4, "brown"), "now": starts[5], "hunt": first(5, "hunt")}
    hits = "\n".join(f"  {k}: {v}," for k, v in hit.items())
    (FILM / "src/film/timing.ts").write_text(
        "// Made by video/experiments/voice_lines.py: the film's frames, the one place they are written down.\n"
        "// scripts/render.sh reads LENGTH and every scene's range from here. Each scene starts 8 frames before its\n"
        "// voice line and holds through the breath after it. 24 fps; 708 frames = 29.5 s (limit 30.0 s).\n"
        f"export const LENGTH = {L};\n\n"
        'export type SceneId = "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8";\n\n'
        f"export const SCENES: Record<SceneId, {{ from: number; to: number; name: string }}> = {{\n{rows}\n}};\n\n"
        "export const SCENE_IDS = Object.keys(SCENES) as SceneId[];\n\n"
        "// Moments the picture lands on (film frames): first frame of the named spoken word.\n"
        f"export const HIT = {{\n{hits}\n}} as const;\n")
    for c in chunks:
        print(c["from"], c["to"], c["text"])
    print(cuts)


if __name__ == "__main__":
    main()
