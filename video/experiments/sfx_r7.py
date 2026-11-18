"""Round 7 (15 Nov): real-sounding sound effects for the film, from the ElevenLabs text-to-sound-effects API.

Usage: python3 video/experiments/sfx_r7.py [--no-api]
Model: eleven_text_to_sound_v3. Read on 15 Nov from
  https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert (model_id: v2 or v3, default v2)
  https://elevenlabs.io/docs/capabilities/sound-effects ("v2 is deprecated and will be removed on March 1, 2027";
  v3 is the current one; neither is marked beta, alpha or preview).
Each effect is made once and cached as experiments/sfx-r7/NAME.mp3 (mp3 44.1 kHz 128 kbit/s; the plan's WAV needs
Pro). A file that is near-silent or clipped is made again once (NAME.mp3 is replaced). Log:
experiments/ai-logs/sfx-r7.json (name, prompt, model id, seconds, date, file, sha256, credits). No key, no headers.
40 credits a second when a length is given. Placement in the film is in mix_r7.py.
"""
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import el_common  # noqa: E402

EXP = Path(__file__).resolve().parent
OUT = EXP / "sfx-r7"
LOG = EXP / "ai-logs" / "sfx-r7.json"
MODEL = "eleven_text_to_sound_v3"
BUDGET = 3500  # credits for effects

# name, prompt, seconds, prompt_influence. Real-world, close-miked, dry, no music; every one a different sound.
SFX = [
    ("room_tone", "Quiet interior of an old wooden observatory dome at night, faint low ventilation hum, very soft "
     "distant creak of wood, still air, no music, no voices", 6.0, 0.5),
    ("plates_slide", "Two thin glass photographic plates sliding out of a wooden holder, soft glass scrape, "
     "close-miked, dry, no music", 1.5, 0.6),
    ("comparator_clack", "One single mechanical clack of a vintage brass optical instrument shutter switching, "
     "close-miked, dry, short, no reverb, no music", 0.6, 0.7),
    ("glass_ping", "One small soft glassy ping, a fingernail tapping a thin wine glass once, gentle short tail, "
     "dry, no music", 1.5, 0.6),
    ("air_whoosh", "Soft low air whoosh, a gentle short gust of air passing close by, smooth, no boom, no impact, "
     "no music", 1.5, 0.5),
    ("mouse_click", "One crisp computer mouse click, close-miked, quiet room, dry, no music", 0.5, 0.7),
    ("shutter", "One soft mechanical camera shutter click, a quiet film camera, close-miked, dry, no winder, "
     "no music", 0.7, 0.7),
    ("glass_shimmer", "Gentle rising glass shimmer, small crystal wind chimes brushed softly, getting slowly "
     "brighter, delicate, no music, no melody", 2.5, 0.5),
    ("counter_roll", "Fast soft ticking of an old mechanical flip counter rolling over its digits, close-miked, "
     "dry, no music", 1.2, 0.6),
    ("night_air", "Quiet night air outdoors on a hill above a city, faint distant city hum, very soft far away "
     "crickets, gentle breeze, no music, no voices, no cars close by", 7.0, 0.5),
    ("low_swell", "Very soft deep low swell of wind across a wide valley at night, slow and warm, distant, "
     "no thunder, no music", 2.5, 0.5),
    ("screen_tap", "One soft fingertip tap on a smartphone glass screen, close-miked, quiet room, dry, no music",
     0.5, 0.7),
    ("warm_chime", "One soft warm chime, a small brass singing bowl struck gently once, long natural ringing tail, "
     "dry room, no music, no melody", 3.0, 0.6),
]


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "48000", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def problem(path):
    x = decode(path)
    peak = float(np.abs(x).max()) if len(x) else 0.0
    if peak < 10 ** (-40 / 20):
        return f"near-silent (peak {20 * np.log10(peak + 1e-9):.0f} dBFS)"
    if np.mean(np.abs(x) >= 0.999) > 0.0005:
        return "clipped"
    return None


def make(name, prompt, secs, infl, cost):
    body = {"text": prompt, "duration_seconds": secs, "prompt_influence": infl, "model_id": MODEL}
    data = el_common.call("/v1/sound-generation?output_format=mp3_44100_128", body, cost=cost)
    (OUT / f"{name}.mp3").write_bytes(data)


def main():
    no_api = "--no-api" in sys.argv
    OUT.mkdir(exist_ok=True)
    log = json.loads(LOG.read_text()) if LOG.exists() else {"model": MODEL, "effects": {}}
    spent = sum(e.get("credits_est", 0) for e in log["effects"].values())
    for name, prompt, secs, infl in SFX:
        path = OUT / f"{name}.mp3"
        entry = log["effects"].get(name)
        if path.exists() and entry and entry["prompt"] == prompt and entry["seconds"] == secs:
            continue
        if no_api:
            print(f"{name}: not made (--no-api)")
            continue
        tries = []
        for attempt in (1, 2):
            if spent + 40 * secs > BUDGET:
                print(f"{name}: skipped, over the {BUDGET}-credit budget")
                break
            cost = []
            make(name, prompt, secs, infl, cost)
            spent += 40 * secs
            bad = problem(path)
            tries.append({"attempt": attempt, "problem": bad, "credits_header": cost[0] if cost else None})
            if not bad:
                break
            print(f"{name}: {bad}, " + ("making it again" if attempt == 1 else "kept, flagged"))
        if not tries:
            continue
        log["effects"][name] = {
            "name": name, "prompt": prompt, "model": MODEL, "seconds": secs, "prompt_influence": infl,
            "date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "file": str(path.relative_to(EXP)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "tries": tries, "credits_est": 40 * secs * len(tries),
        }
        LOG.write_text(json.dumps(log, indent=1))
        print(f"{name}: made, {secs} s, {tries[-1]['credits_header']} credits (header)")
    total = sum(e.get("credits_est", 0) for e in log["effects"].values())
    print(f"effects: {len(log['effects'])}, credits (40/s estimate): {total:.0f} of {BUDGET}")


if __name__ == "__main__":
    main()
