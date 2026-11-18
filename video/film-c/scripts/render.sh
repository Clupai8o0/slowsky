#!/bin/sh
# Every render of this project, from one place. It reads the frames from src/film/timing.ts and the rate and
# beat from src/lib/beat.ts, so the score, the scenes and the finished cut always agree with the code.
# A cut is a composition with its own entry, src/entries/<id without dashes>.tsx: Film, or Reel once the
# project has one. Exits 1 when a render or a check fails, 2 on bad arguments. One render at a time on a
# machine: each one takes most of its cores and memory. When several agents render scenes at once, give
# each a share with CONCURRENCY=2 (Remotion's browser tabs per render).
set -e
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
SCORE=public/audio/score.wav # the file src/film/Film.tsx plays
case "${CONCURRENCY:-}" in
  '') CONC= ;;
  *[!0-9]*) CONC=- ;;
  *[1-9]*) CONC="--concurrency=$CONCURRENCY" ;;
  *) CONC=- ;; # 0, 00 ...
esac
if [ "$CONC" = - ]; then
  echo "render.sh: CONCURRENCY must be a whole number of tabs, 1 or more, not '$CONCURRENCY'" >&2
  exit 2
fi

usage()
{
  cat >&2 <<'EOF'
usage: sh scripts/render.sh <mode> ...
  score [score.py args]           the music on timing.ts's hits, public/audio/score.wav (e.g. --key A --minor)
  still FRAME [cut=Film]          one frame at full size: out/<cut>-<FRAME>.png
  scene N|rN [scale=0.5] [every=3]  scene N alone (rN: the reel's), and a contact sheet of film frames
  draft [cut=Film] [scale=0.5]    the whole cut with its sound, small, and a contact sheet
  master [cut=Film]               the finished cut, full size, with its checks: frame count, loudness and
                                  true peak, then a poster (the last frame), a contact sheet and a cut sheet
EOF
  exit 2
}

die()
{
  echo "render.sh: $*" >&2
  exit 1
}

# val FILE NAME: the number in `export const NAME = <number>`
val()
{
  "$PY" - "$1" "$2" <<'EOF'
import re
import sys
m = re.search(r"export const %s = (\d+)\b" % sys.argv[2], open(sys.argv[1]).read())
if not m:
    sys.exit("render.sh: %s has no `export const %s = <number>`" % (sys.argv[1], sys.argv[2]))
print(m.group(1))
EOF
}

# range N: scene sN's first and last frame
range()
{
  "$PY" - "s$1" <<'EOF'
import re
import sys
m = re.search(r"\b%s: \{ from: (\d+), to: (\d+)" % sys.argv[1], open("src/film/timing.ts").read())
if not m:
    sys.exit("render.sh: src/film/timing.ts has no scene %s" % sys.argv[1])
print(m.group(1), int(m.group(2)) - 1)
EOF
}

# the first frame of every scene, for the cut sheet
starts()
{
  "$PY" - <<'EOF'
import re
print(",".join(re.findall(r"\bs\d+: \{ from: (\d+)", open("src/film/timing.ts").read())))
EOF
}

# entry ID: the bundle that renders composition ID (Film-S2 is src/entries/FilmS2.tsx)
entry()
{
  E="src/entries/$(printf '%s' "$1" | tr -d -).tsx"
  [ -f "$E" ] || die "no $E, so no composition $1"
  echo "$E"
}

# the files under src/ still marked PLACEHOLDER: the starter's brand, words and stand-in scenes
placeholders()
{
  grep -rl PLACEHOLDER src | xargs || true
}

count()
{
  ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$1"
}

FPS=$(val src/lib/beat.ts FPS)
FPB=$(val src/lib/beat.ts FRAMES_PER_BEAT)
LENGTH=$(val src/film/timing.ts LENGTH)
MODE="$1"
[ -n "$MODE" ] || usage
shift
mkdir -p out
case "$MODE" in
  score)
    "$PY" scripts/score.py --frames "$LENGTH" --fps "$FPS" --frames-per-beat "$FPB" \
      --hits-from src/film/timing.ts --out "${SCORE%.wav}" "$@"
    ;;
  still)
    FRAME="$1"
    ID="${2:-Film}"
    case "$FRAME" in
      '' | *[!0-9]*) usage ;;
    esac
    [ "$FRAME" -lt "$LENGTH" ] || die "frame $FRAME is past the last frame, $((LENGTH - 1))"
    E=$(entry "$ID")
    npx remotion still "$E" "$ID" "out/$ID-$FRAME.png" --frame="$FRAME" --log=error
    echo "still: out/$ID-$FRAME.png"
    ;;
  scene)
    case "$1" in
      r[1-9]*)
        N="${1#r}"
        ID="Reel-S$N"
        ;;
      [1-9]*)
        N="$1"
        ID="Film-S$N"
        ;;
      *) usage ;;
    esac
    SCALE="${2:-0.5}"
    EVERY="${3:-3}"
    E=$(entry "$ID")
    R=$(range "$N")
    FROM="${R% *}"
    LAST="${R#* }"
    npx remotion render "$E" "$ID" "out/$ID.mp4" --frames="$FROM-$LAST" --scale="$SCALE" $CONC --log=error
    case "$ID" in
      Reel*) "$PY" scripts/sheet.py "out/$ID.mp4" "out/$ID-sheet.png" "$EVERY" 10 216 "$FROM" ;;
      *) "$PY" scripts/sheet.py "out/$ID.mp4" "out/$ID-sheet.png" "$EVERY" 8 360 "$FROM" ;;
    esac
    echo "scene: out/$ID.mp4 (film frames $FROM-$LAST), sheet out/$ID-sheet.png"
    ;;
  draft)
    ID="${1:-Film}"
    SCALE="${2:-0.5}"
    E=$(entry "$ID")
    [ -f "$SCORE" ] || echo "note: no score yet, so the draft is silent (sh scripts/render.sh score)" >&2
    npx remotion render "$E" "$ID" "out/$ID-draft.mp4" --scale="$SCALE" $CONC --log=error
    case "$ID" in
      Reel*) "$PY" scripts/sheet.py "out/$ID-draft.mp4" "out/$ID-draft-sheet.png" 6 15 160 ;;
      *) "$PY" scripts/sheet.py "out/$ID-draft.mp4" "out/$ID-draft-sheet.png" 6 10 300 ;;
    esac
    echo "draft: out/$ID-draft.mp4, sheet out/$ID-draft-sheet.png"
    # The draft's sound is the master's sound, so its loudness is the master's: fix the mix here, before the
    # full render, which fails a cut outside the targets.
    if [ -f "$SCORE" ]; then
      sh scripts/loudness.sh "out/$ID-draft.mp4" || echo "note: the master will fail this mix; fix it first" >&2
    fi
    ;;
  master)
    ID="${1:-Film}"
    E=$(entry "$ID")
    P=$(placeholders)
    if [ -n "$P" ] && [ "${ALLOW_PLACEHOLDER:-0}" != 1 ]; then
      die "a master ships what it shows, and these are still placeholders: $P"
    fi
    [ -f "$SCORE" ] || die "no $SCORE yet: sh scripts/render.sh score"
    OUT="out/$ID.mp4"
    npx remotion render "$E" "$ID" "$OUT" --props='{"master":true}' --codec=h264 --crf=18 --x264-preset=slow --audio-codec=aac \
      --audio-bitrate=320k $CONC --log=error
    GOT=$(count "$OUT")
    echo "master: $OUT, $GOT frames at $FPS fps"
    FAIL=0
    if [ "$GOT" != "$LENGTH" ]; then
      echo "render.sh: $OUT has $GOT frames, not $LENGTH" >&2
      FAIL=1
    fi
    sh scripts/loudness.sh "$OUT" || FAIL=1
    ffmpeg -y -loglevel error -i "$OUT" -vf "select=eq(n\,$((GOT - 1)))" -fps_mode vfr -frames:v 1 -q:v 2 \
      "out/$ID-poster.jpg"
    case "$ID" in
      Reel*)
        "$PY" scripts/sheet.py "$OUT" "out/$ID-sheet.png" 6 15 160
        "$PY" scripts/cuts.py "$OUT" "out/$ID-cuts.png" --cuts "$(starts)" --tile 180
        ;;
      *)
        "$PY" scripts/sheet.py "$OUT" "out/$ID-sheet.png" 6 10 300
        "$PY" scripts/cuts.py "$OUT" "out/$ID-cuts.png" --cuts "$(starts)"
        ;;
    esac
    echo "poster out/$ID-poster.jpg, sheets out/$ID-sheet.png and out/$ID-cuts.png"
    exit $FAIL
    ;;
  *) usage ;;
esac
