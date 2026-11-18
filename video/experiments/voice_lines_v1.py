"""Voice the film line by line (deep, even storyteller), fit each line into its slot, mix with the score,
and write the caption timings.

Usage: python3 video/experiments/voice_lines.py [voice_id] [model]
Needs ELEVENLABS_API_KEY (from .env.local). Writes video/experiments/lines/*, mix_lines.wav and
video/slowsky-film/src/film/captions.ts + public/audio/score.wav.
"""
import base64
import json
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

# (spoken text, shown caption groups, start frame, last frame the line may reach)
SCRIPT = [
    ("Team Clupai, from Melbourne.", ["Team Clupai, from Melbourne."], 10, 60),
    ("Pluto was found... by blinking two photos.", ["Pluto was found...", "by blinking two photos."], 63, 147),
    ("Slow sky: type any coordinates, and watch the sky change.",
     ["Slowsky: type any coordinates,", "and watch the sky change."], 150, 241),
    ("NASA's SPHEREx maps the whole sky in a hundred and two infrared colours.",
     ["NASA's SPHEREx maps the whole sky", "in 102 infrared colours."], 244, 346),
    ("These are its real pixels, with ESA Gaia stars on top.",
     ["These are its real pixels,", "with ESA Gaia stars on top."], 349, 436),
    ("Volunteers found over three thousand brown dwarf candidates by blinking images.",
     ["Volunteers found over 3,000", "brown dwarf candidates", "by blinking images."], 439, 557),
    ("Now anyone can join the hunt.", ["Now anyone can join the hunt."], 560, 600),
]
# How many spoken words each shown group covers (shown text can differ: "Slowsky", "102", "3,000").
SPOKEN_COUNTS = [[4], [3, 4], [5, 5], [6, 7], [5, 6], [5, 3, 3], [6]]


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


def main():
    LINES.mkdir(parents=True, exist_ok=True)
    texts = [s[0] for s in SCRIPT]
    chunks = []
    filters, inputs = [], []
    for i, (text, groups, f0, f1) in enumerate(SCRIPT):
        d = tts(text, " ".join(texts[:i])[-300:], " ".join(texts[i + 1:])[:300])
        raw = LINES / f"line{i + 1}.mp3"
        raw.write_bytes(base64.b64decode(d["audio_base64"]))
        a = d["alignment"]
        s0, s1, dur = speech_bounds(raw)
        slot = (f1 - f0) / FPS
        tempo = max(1.0, (s1 - s0) / slot)
        print(f"line {i + 1}: speech {s1 - s0:.2f}s, slot {slot:.2f}s, tempo {tempo:.3f}" + ("  TOO LONG" if tempo > 1.25 else ""))
        # words with times in film frames
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
        to_f = lambda t: round(f0 + (t - s0) / tempo * FPS)
        fw = [{"w": w, "from": max(f0, to_f(x)), "to": to_f(y)} for w, x, y in words]
        k = 0
        for g, n in zip(groups, SPOKEN_COUNTS[i]):
            ws = fw[k:k + n]
            k += n
            chunks.append({"text": g, "from": ws[0]["from"], "to": ws[-1]["to"] + 5, "words": ws})
        assert k == len(fw), (text, k, len(fw))
        inputs += ["-i", str(raw)]
        ms = int(f0 / FPS * 1000)
        filters.append(f"[{i}:a]atrim=start={s0:.3f},asetpts=PTS-STARTPTS,atempo={tempo:.4f},adelay={ms}|{ms}[l{i}]")
    for a_, b_ in zip(chunks, chunks[1:]):
        a_["to"] = min(a_["to"], b_["from"])
    n = len(SCRIPT)
    mix = ";".join(filters) + ";" + "".join(f"[l{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0[v]"
    mix += f";[{n}:a]volume=0.16[m];[v][m]amix=inputs=2:duration=longest:normalize=0,atrim=0:{TOTAL},loudnorm=I=-14:TP=-1.5[a]"
    out = EXP / "mix_lines.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-i", str(EXP / "score.wav"),
                    "-filter_complex", mix, "-map", "[a]", "-ar", "44100", "-ac", "2", str(out)], check=True)
    (FILM / "public/audio/score.wav").write_bytes(out.read_bytes())
    hdr = ("// Made by video/experiments/voice_lines.py from the ElevenLabs timings: one take per line, each placed\n"
           "// at its scene's start frame. Film frames at 24 fps.\n"
           "export type Word = { w: string; from: number; to: number };\n"
           "export type Chunk = { text: string; from: number; to: number; words: Word[] };\n")
    (FILM / "src/film/captions.ts").write_text(hdr + "export const CAPTIONS: Chunk[] = " + json.dumps(chunks, indent=1) + ";\n")
    for c in chunks:
        print(c["from"], c["to"], c["text"])


if __name__ == "__main__":
    main()
