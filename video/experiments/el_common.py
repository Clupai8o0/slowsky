"""Shared ElevenLabs helpers for round 7: load the key from .env.local without printing it, call the API."""
import json
import urllib.error
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parents[2] / ".env.local"
API = "https://api.elevenlabs.io"


def key():
    for line in ENV.read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no ELEVENLABS_API_KEY line in .env.local")


def call(path, body=None, timeout=180, cost=None):
    """GET (body None) or POST JSON; returns raw bytes. Errors carry only the status and the reply text.
    cost: a list that gets the reply's `character-cost` header (credits charged), if the API sends one."""
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"xi-api-key": key(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if cost is not None:
                cost.append(r.headers.get("character-cost"))
            return r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ElevenLabs {path.split('?')[0]}: HTTP {e.code} {e.read()[:300]!r}") from None
    except urllib.error.URLError as e:
        raise SystemExit(f"ElevenLabs {path.split('?')[0]}: network error {e.reason}") from None


def credits():
    s = json.loads(call("/v1/user/subscription"))
    return s["character_count"], s["character_limit"]


if __name__ == "__main__":
    used, limit = credits()
    print(f"used {used} of {limit}, left {limit - used}")
