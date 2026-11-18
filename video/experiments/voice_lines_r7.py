"""Round 7 (15 Nov): the same six lines, voiced again (three takes each), each take picked by measurement.

Usage: python3 video/experiments/voice_lines_r7.py [--no-api]
Copy of voice_lines.py's method, not an edit of it. Same voice, same model, same words, same previous_text /
next_text; voice settings a little more alive (stability 0.50-0.55, style 0.20-0.25, speaker boost on).
Takes are cached in experiments/lines-r7/lineN_tK.{mp3,json}; a cached take is never re-made. The r6 takes are kept
in experiments/lines-r6/ (backed up before this ran). Nobody can listen, so a take wins on numbers only:
  - every word has a timing, and the take starts and ends in silence (no word cut at either edge);
  - no pause inside longer than MAX_PAUSE (from the word timings and from silencedetect);
  - it fits its slot at speed 1.0 (no speed-up): the line starts where r6's did, ends GAP before the next line;
  - among the ones that pass, the closest in length to the r6 line wins.
If no take passes, the r6 take is kept for that line. Writes experiments/lines/lineN.{mp3,json} (the chosen take),
experiments/voice-r7.json (placement for mix_r7.py), film-c/src/film/captions.ts and the HIT block of timing.ts
(scene cuts stay as they are). Key: ELEVENLABS_API_KEY from .env.local, read by el_common.py, never printed.
"""
import base64
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import el_common  # noqa: E402
ARGS, sys.argv = sys.argv[1:], sys.argv[:1]  # voice_lines.py reads its voice and model from argv at import
from voice_lines import SCRIPT, VOICE, MODEL, VOICE_FROM, VOICE_TO, MIN_GAP, edge_silence, words_of  # noqa: E402

EXP = Path(__file__).resolve().parent
FILM = EXP.parent / "film-c"
R6 = EXP / "lines-r6"
R7 = EXP / "lines-r7"
LINES = EXP / "lines"
FPS = 24
TAKES = [  # (stability, style): a little more alive than r6's 0.62 / 0.15
    (0.50, 0.25),
    (0.52, 0.22),
    (0.55, 0.20),
]
# line 2: its first three takes were one 0.8 s short and two with a 0.8 s pause, so it got three more
EXTRA = {2: [(0.53, 0.21), (0.51, 0.23), (0.54, 0.24)]}
MAX_PAUSE = 0.45  # s
GAP = 0.45        # s of silence a line must leave before the next one starts
LAST_END = 672    # frame: the last line ends by here (the end card holds to 708)


def tts(text, prev, nxt, stability, style, cost):
    body = {
        "text": text,
        "model_id": MODEL,
        "voice_settings": {"stability": stability, "similarity_boost": 0.8, "style": style,
                           "use_speaker_boost": True},
        "previous_text": prev,
        "next_text": nxt,
    }
    return json.loads(el_common.call(f"/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
                                     body, cost=cost))


def inner_pauses(path, s0, s1):
    """Longest silence (-40 dB, 0.2 s or more) strictly inside the speech."""
    r = subprocess.run(["ffmpeg", "-i", str(path), "-af", "silencedetect=n=-40dB:d=0.2", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    longest, st = 0.0, None
    for x in r.splitlines():
        if "silence_start" in x:
            st = float(x.split("silence_start: ")[1])
        elif "silence_end" in x and st is not None:
            en = float(x.split("silence_end: ")[1].split(" ")[0])
            if st > s0 + 0.02 and en < s1 - 0.02:
                longest = max(longest, en - st)
            st = None
    return longest


def edge_levels(path):
    """RMS of the first 20 ms and the last 30 ms, in dB under the take's peak."""
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "44100", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    pk = 20 * np.log10(np.abs(x).max() + 1e-9)
    db = lambda y: 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9) - pk
    return float(db(x[:882])), float(db(x[-1323:]))


EDGE = -35.0  # dB under peak: louder than this at the very first/last samples means sound is running


def measure(mp3, a, text):
    words = words_of(a)
    s0, s1, dur = edge_silence(mp3)
    gaps = [b[1] - w[2] for w, b in zip(words, words[1:])]
    m = {
        "words": len(words), "want": len(text.split()), "s0": round(s0, 3), "s1": round(s1, 3), "dur": round(dur, 3),
        "len": round(s1 - s0, 3), "word_gap": round(max(gaps, default=0.0), 3),
        "inner": round(inner_pauses(mp3, s0, s1), 3),
        "first_word": round(words[0][1], 3), "last_word": round(words[-1][2], 3),
    }
    bad = []
    if m["words"] != m["want"]:
        bad.append("word count")
    # a word is cut when sound is already running at the first sample, or when the last word's timing runs
    # into the file's end while sound is still running there (a loud tail after the last word is breath/room)
    head, tail = edge_levels(mp3)
    m.update({"head_db": round(head, 1), "tail_db": round(tail, 1)})
    if head > EDGE:
        bad.append(f"cut at start ({head:.0f} dB)")
    # the closing "." is timed to the file's end, so use the end of the last letter
    k = max(j for j, c in enumerate(a["characters"]) if c.isalnum())
    last = a["character_end_times_seconds"][k]
    m["last_letter"] = round(last, 3)
    if tail > EDGE and last > dur - 0.25:
        bad.append(f"cut at end ({tail:.0f} dB, last letter ends {dur - last:.2f} s before the end)")
    if max(m["word_gap"], m["inner"]) > MAX_PAUSE:
        bad.append("long pause")
    m["bad"] = bad
    return m, words


def r6_layout():
    """r6's line starts and on-screen lengths, recomputed the way voice_lines.py placed them."""
    takes = []
    for i in range(len(SCRIPT)):
        s0, s1, _ = edge_silence(R6 / f"line{i + 1}.mp3")
        takes.append((s0, s1))
    speech = sum(b - a for a, b in takes)
    n = len(SCRIPT)
    tempo = max(1.0, speech / (VOICE_TO - VOICE_FROM - MIN_GAP * (n - 1)))
    gap = (VOICE_TO - VOICE_FROM - speech / tempo) / (n - 1)
    t, starts, lens = VOICE_FROM, [], []
    for s0, s1 in takes:
        starts.append(round(t * FPS))
        lens.append((s1 - s0) / tempo)
        t += (s1 - s0) / tempo + gap
    return tempo, starts, lens


def main():
    no_api = "--no-api" in ARGS
    R7.mkdir(exist_ok=True)
    tempo6, starts, lens6 = r6_layout()
    print(f"r6: tempo {tempo6:.4f}, starts {starts}, lengths {[round(x, 2) for x in lens6]}")
    texts = [s[0] for s in SCRIPT]
    log = {"date": datetime.now(timezone.utc).isoformat(timespec="seconds"), "voice_model": MODEL,
           "takes": TAKES, "r6_tempo": tempo6, "lines": []}
    chars, costs = 0, []
    chosen = []
    for i, (text, groups, counts) in enumerate(SCRIPT):
        prev, nxt = " ".join(texts[:i])[-300:], " ".join(texts[i + 1:])[:300]
        slot_end = (starts[i + 1] / FPS - GAP) if i + 1 < len(SCRIPT) else LAST_END / FPS
        room = slot_end - starts[i] / FPS
        cands = []
        for k, (stab, sty) in enumerate(TAKES + EXTRA.get(i + 1, [])):
            mp3, meta = R7 / f"line{i + 1}_t{k + 1}.mp3", R7 / f"line{i + 1}_t{k + 1}.json"
            if not (mp3.exists() and meta.exists()):
                if no_api:
                    continue
                cost = []
                d = tts(text, prev, nxt, stab, sty, cost)
                mp3.write_bytes(base64.b64decode(d["audio_base64"]))
                meta.write_text(json.dumps({"text": text, "voice": VOICE, "model": MODEL, "stability": stab,
                                            "style": sty, "alignment": d["alignment"], "cost": cost[0]}))
                chars += len(text)
                costs.append(cost[0])
            a = json.loads(meta.read_text())["alignment"]
            m, _ = measure(mp3, a, text)
            if m["len"] > room:
                m["bad"].append(f"too long for slot ({m['len']:.2f} > {room:.2f} s)")
            m.update({"take": k + 1, "stability": stab, "style": sty, "fit": round(abs(m["len"] - lens6[i]), 3)})
            cands.append(m)
            print(f"line {i + 1} take {k + 1}: len {m['len']:.2f} (r6 {lens6[i]:.2f}, room {room:.2f}) "
                  f"pause {max(m['word_gap'], m['inner']):.2f}  {'OK' if not m['bad'] else ', '.join(m['bad'])}")
        ok = [c for c in cands if not c["bad"]]
        if ok:
            win = min(ok, key=lambda c: c["fit"])
            src = R7 / f"line{i + 1}_t{win['take']}"
            why = f"take {win['take']}: passes, closest to r6 length ({win['len']:.2f} vs {lens6[i]:.2f} s)"
        else:
            win, src = None, R6 / f"line{i + 1}"
            why = "kept r6 take: no new take passed"
        shutil.copyfile(src.with_suffix(".mp3"), LINES / f"line{i + 1}.mp3")
        meta = json.loads(src.with_suffix(".json").read_text())
        meta["round"] = "r7" if win else "r6"
        (LINES / f"line{i + 1}.json").write_text(json.dumps(meta))
        print(f"line {i + 1}: {why}")
        chosen.append((LINES / f"line{i + 1}.mp3", meta["alignment"], win is None))
        log["lines"].append({"line": i + 1, "text": text, "candidates": cands, "chosen": why})
    # placement: each line starts on its r6 frame, at speed 1.0 (an r6 take keeps r6's tempo)
    chunks, place, ends = [], [], []
    for i, ((mp3, a, old), (text, groups, counts)) in enumerate(zip(chosen, SCRIPT)):
        tempo = tempo6 if old else 1.0
        s0, s1, _ = edge_silence(mp3)
        words = [(w, x, min(y, s1)) for w, x, y in words_of(a)]
        f0 = starts[i]
        to_f = lambda x: round(f0 + (x - s0) / tempo * FPS)
        fw = [{"w": w, "from": max(f0, to_f(x)), "to": to_f(y)} for w, x, y in words]
        k = 0
        for g, c in zip(groups, counts):
            ws = fw[k:k + c]
            k += c
            chunks.append({"text": g, "from": ws[0]["from"], "to": ws[-1]["to"] + 8, "words": ws})
        assert k == len(fw), (text, k, len(fw))
        ends.append(fw[-1]["to"])
        place.append({"file": str(mp3.relative_to(EXP)), "start_frame": f0, "trim_s": round(s0, 4),
                      "len_s": round((s1 - s0) / tempo, 4), "tempo": tempo, "end_frame": fw[-1]["to"]})
    for a_, b_ in zip(chunks, chunks[1:]):
        a_["to"] = min(a_["to"], b_["from"])
    (EXP / "voice-r7.json").write_text(json.dumps({"lines": place}, indent=1))
    hdr = ("// Made by video/experiments/voice_lines_r7.py (round 7) from the ElevenLabs timings: one take per line,\n"
           "// each line on its r6 start frame, at natural speed. Film frames at 24 fps.\n"
           "export type Word = { w: string; from: number; to: number };\n"
           "export type Chunk = { text: string; from: number; to: number; words: Word[] };\n")
    (FILM / "src/film/captions.ts").write_text(hdr + "export const CAPTIONS: Chunk[] = " + json.dumps(chunks, indent=1) + ";\n")
    first = lambda i, w: next(x["from"] for c in chunks for x in c["words"]
                              if re.sub("[^a-z]", "", x["w"].lower()).startswith(w) and x["from"] >= starts[i])
    hit = {"pluto": starts[0], "blinking": first(0, "blinking"), "name": starts[1], "star": first(1, "star"),
           "watch": first(1, "watch"), "nasa": starts[2], "colours": first(2, "hundred"), "these": starts[3],
           "real": first(3, "real"), "volunteers": starts[4], "thousand": first(4, "thousand"),
           "brown": first(4, "brown"), "now": starts[5], "hunt": first(5, "hunt")}
    tpath = FILM / "src/film/timing.ts"
    t = tpath.read_text()
    old = dict(re.findall(r"^  (\w+): (\d+),$", t.split("export const HIT = {")[1], re.M))
    block = "export const HIT = {\n" + "\n".join(f"  {k}: {v}," for k, v in hit.items()) + "\n} as const;"
    t = re.sub(r"export const HIT = \{.*?\} as const;", block, t, flags=re.S)
    t = t.replace("// Made by video/experiments/voice_lines.py:", "// Made by video/experiments/voice_lines.py (HIT: voice_lines_r7.py, round 7):", 1)
    tpath.write_text(t)
    moved = {k: (int(old[k]), v) for k, v in hit.items() if int(old.get(k, v)) != v}
    print("HIT moved:", moved or "none")
    print("ends:", ends, "s8 starts", re.search(r"s8: \{ from: (\d+)", t).group(1))
    log.update({"hit_moved": moved, "chars_sent": chars, "costs": costs, "placement": place})
    (EXP / "ai-logs" / "voice-r7.json").write_text(json.dumps(log, indent=1))
    print(f"characters sent this run: {chars}; charged (header): {costs}")


if __name__ == "__main__":
    main()
