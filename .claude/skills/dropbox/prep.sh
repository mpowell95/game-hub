#!/usr/bin/env bash
# Turn one downloaded Dropbox file into images Claude can Read.
#   bash .claude/skills/dropbox/prep.sh <file> <out-dir>
# Video  -> contact sheets (12 frames each, timestamp on every frame) + duration/size line.
# HEIC   -> JPG (installs pillow-heif on first use; ImageMagick here cannot read iPhone HEIC).
# PNG/JPG-> resized copy (max 1600px) so it fits in one Read.
# Prints every image path to Read, one per line, prefixed "READ ".
set -euo pipefail
in="$1"; out="$2"; mkdir -p "$out"
base="$(basename "$in")"; stem="${base%.*}"; ext="${base##*.}"; ext="${ext,,}"
safe="$(printf '%s' "$stem" | tr -c 'A-Za-z0-9_-' '_')"

case "$ext" in
  mp4|mov|m4v|webm)
    dur="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$in")"
    size="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$in")"
    # ~36 frames whatever the length: short clips get up to 3 fps, long ones down to 1 every 5 s.
    fps="$(awk -v d="$dur" 'BEGIN{f=36/d; if(f>3)f=3; if(f<0.2)f=0.2; printf "%.3f", f}')"
    echo "VIDEO $base  duration=${dur}s  size=${size}  sampled at ${fps} fps"
    ffmpeg -v error -y -i "$in" -vf "fps=${fps},scale=360:-2,drawtext=text='%{pts\:hms}':x=8:y=h-th-8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6,tile=6x2:padding=4:color=white" \
      "$out/${safe}_sheet_%02d.jpg"
    for f in "$out/${safe}"_sheet_*.jpg; do echo "READ $f"; done
    echo "TIP  full-size frame at a moment: ffmpeg -v error -ss <sec> -i \"$in\" -frames:v 1 -vf scale=-2:1400 \"$out/${safe}_at_<sec>.jpg\""
    ;;
  heic|heif)
    python3 -c "import pillow_heif" 2>/dev/null || pip install -q pillow-heif >/dev/null 2>&1
    python3 - "$in" "$out/${safe}.jpg" <<'PY'
import sys
from pillow_heif import register_heif_opener; register_heif_opener()
from PIL import Image
im = Image.open(sys.argv[1]); im.thumbnail((1600, 1600)); im.convert('RGB').save(sys.argv[2], quality=88)
PY
    echo "READ $out/${safe}.jpg"
    ;;
  png|jpg|jpeg|webp|gif)
    python3 - "$in" "$out/${safe}.jpg" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]); im.thumbnail((1600, 1600)); im.convert('RGB').save(sys.argv[2], quality=88)
PY
    echo "READ $out/${safe}.jpg"
    ;;
  *)
    echo "OTHER $base (not an image or video; Read it directly if it is text, or use the Dropbox fetch tool)"
    ;;
esac
