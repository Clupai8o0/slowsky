#!/bin/sh
# Make a cut's web copy: 1280 px on the long side (720p, or 720x1280 for a vertical cut), H.264 with AAC,
# small enough for an artifact page (15 MB a file).
# usage: sh web.sh <in.mp4> <out.mp4> [mb=14]
# A two-pass encode at the bitrate that fills the budget, so the copy is as sharp as the size allows.
# A fixed CRF can't promise a size: grain that changes every frame costs bits, and 1080p at CRF 26 came to
# about 43 MB for a 30 s film full of grain.
set -e
if [ $# -lt 2 ]; then
  echo "usage: sh web.sh <in.mp4> <out.mp4> [mb=14]" >&2
  exit 2
fi
IN="$1"
OUT="$2"
MB="${3:-14}"
if [ "$IN" = "$OUT" ]; then
  echo "web.sh: in and out are the same file" >&2
  exit 2
fi
AUDIO=160
SECS=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
# the budget in kbit/s over the cut's length, less the audio, less 3% for the container
VIDEO=$(awk -v s="$SECS" -v mb="$MB" -v a="$AUDIO" 'BEGIN { if (s + 0 > 0 && mb + 0 > 0) { v = int(mb * 1048576 * 8 / 1000 / s * 0.97 - a); if (v > 0) { print v } } }')
if [ -z "$VIDEO" ]; then
  echo "web.sh: no bitrate fits $MB MB over \"$SECS\" s of $IN" >&2
  exit 1
fi
# landscape scales its width to 1280, portrait its height
DIM=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$IN")
SIZE=$(echo "$DIM" | awk -F, '$1 > 0 && $2 > 0 { print ($1 >= $2) ? "1280:-2" : "-2:1280" }')
if [ -z "$SIZE" ]; then
  echo "web.sh: no video stream size in $IN" >&2
  exit 1
fi
# the two-pass log goes in a folder of its own, so two encodes at once cannot share one
TMP=$(mktemp -d "${TMPDIR:-/tmp}/web.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
LOG="$TMP/pass"

enc()
{
  ffmpeg -y -loglevel error -i "$IN" -vf "scale=$SIZE:flags=lanczos" -pix_fmt yuv420p \
    -c:v libx264 -preset slow -b:v "${VIDEO}k" -passlogfile "$LOG" "$@"
}

enc -pass 1 -an -f mp4 /dev/null
enc -pass 2 -c:a aac -b:a "${AUDIO}k" -movflags +faststart "$OUT"
BYTES=$(wc -c < "$OUT")
awk -v b="$BYTES" -v o="$OUT" -v v="$VIDEO" 'BEGIN { printf "web: %s, %.1f MB, video %s kbit/s\n", o, b / 1048576, v }'
