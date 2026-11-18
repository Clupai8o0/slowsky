#!/bin/sh
# Finish a cut: put the mix under the rendered picture and play it at FPS frames a second (24 by default).
# The picture may be drawn at another rate (say 30 fps, played at 24): -r before -i re-times every
# frame without dropping or repeating one, so frame n plays at n / FPS s. After -i it would drop frames instead.
# Encodes H.264 CRF 18 with AAC 320k, then checks the result: the frame count (a mix shorter than the picture
# cuts it short, because of -shortest) and loudness.sh's gate (true peak at or under -1 dBTP, -17..-12 LUFS).
# Exits 1 when a check fails. POSTER=1 also writes the last frame as <out>-poster.jpg.
# usage: sh finish.sh <picture> <mix.wav> <out.mp4> [fps=24]
# The picture is any video ffmpeg reads. Render it muted and lossless first, one cut at a time, at the rate it
# was drawn for, e.g. for a film drawn at 30 fps:
#   npx remotion render src/index.ts Film out/.picture.mov --fps=30 --muted --codec=prores --prores-profile=hq
set -e
if [ $# -lt 3 ]; then
  echo "usage: sh finish.sh <picture> <mix.wav> <out.mp4> [fps=24]" >&2
  exit 2
fi
PIC="$1"
MIX="$2"
OUT="$3"
FPS="${4:-24}"
HERE=$(dirname "$0")
if [ "$OUT" = "$PIC" ] || [ "$OUT" = "$MIX" ]; then
  echo "finish.sh: the output would overwrite an input" >&2
  exit 2
fi

count()
{
  ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$1"
}

WANT=$(count "$PIC")
ffmpeg -y -loglevel error -r "$FPS" -i "$PIC" -i "$MIX" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 \
  -pix_fmt yuv420p -c:a aac -b:a 320k -shortest -movflags +faststart "$OUT"
GOT=$(count "$OUT")
echo "finish: $OUT, $GOT frames at $FPS fps"
FAIL=0
sh "$HERE/loudness.sh" "$OUT" || FAIL=1
if [ "$GOT" != "$WANT" ]; then
  echo "finish.sh: $OUT has $GOT frames but the picture has $WANT: is the mix shorter than the picture?" >&2
  FAIL=1
fi
if [ "${POSTER:-0}" = 1 ]; then
  ffmpeg -y -loglevel error -i "$OUT" -vf "select=eq(n\,$((GOT - 1)))" -fps_mode vfr -frames:v 1 -q:v 2 \
    "${OUT%.*}-poster.jpg"
  echo "poster: ${OUT%.*}-poster.jpg"
fi
exit $FAIL
