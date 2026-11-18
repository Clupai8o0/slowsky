#!/bin/sh
# Measure a cut's loudness and true peak the way the platforms do (EBU R128, ffmpeg's ebur128) and gate them:
# exits 1 when the true peak is above -1 dBTP or the loudness is outside -17..-12 LUFS. YouTube, TikTok,
# Instagram and Spotify play everything at about -14 LUFS: a louder mix is turned down with its limiting
# still in it, and a quieter one plays quiet next to everything else.
# usage: sh loudness.sh <file> [lo=-17] [hi=-12]
set -e
if [ $# -lt 1 ]; then
  echo "usage: sh loudness.sh <file> [lo=-17] [hi=-12]" >&2
  exit 2
fi
FILE="$1"
LO="${2:--17}"
HI="${3:--12}"
# captured first, not piped: set -e only sees a pipe's last command, so a failed ffmpeg would pass
LOUD=$(ffmpeg -hide_banner -nostats -i "$FILE" -vn -af ebur128=peak=true -f null - 2>&1) || {
  printf '%s\n' "$LOUD" | tail -5 >&2
  exit 1
}
printf '%s\n' "$LOUD" | awk -v f="$FILE" -v lo="$LO" -v hi="$HI" '
  /Integrated loudness:/ { i = 1 } i && / I:/ { l = $2 } /True peak:/ { p = 1 }
  p && /Peak:/ {
    printf "%s: %s LUFS, true peak %s dBTP\n", f, l, $2
    fflush()
    bad = 0
    if ($2 + 0 > -1) {
      print "loudness.sh: the true peak is above -1 dBTP; lower the mix or limit it" > "/dev/stderr"
      bad = 1
    }
    if (l + 0 < lo + 0 || l + 0 > hi + 0) {
      printf "loudness.sh: %s LUFS is outside %s..%s; the platforms play at about -14\n", l, lo, hi > "/dev/stderr"
      bad = 1
    }
    done = 1
    exit bad
  }
  END { if (!done) { print "loudness.sh: no ebur128 summary from ffmpeg" > "/dev/stderr"; exit 1 } }'
