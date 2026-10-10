#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Build the Work-home avatar frames from the four felt portraits.
#
# Sources (tools/buddy/felt/, 1254x1254, pixel-aligned — only eyes, brows
# and mouth differ between them):
#   look.webp    eyes open, glancing right, closed smile
#   talk.webp    eyes open, looking ahead, mouth open
#   happy.webp   ^ ^ eyes, smile
#   closed.webp  eyes closed, calm smile
#
# Two more frames are composed by swapping only the eye band, which works
# because everything outside it is identical:
#   neutral = look + eyes from talk     (looking ahead, mouth closed)
#   blink   = look + eyes from closed
#
# Every sprite frame carries an 8% overscan on each side beyond the round
# crop the avatar shows, so breathing, hops and tilts never expose an edge.
# The sources stop at their own circle (white outside), so the overscan is
# synthesised: each pixel past radius R copies the pixel at radius R on the
# same ray. Background extends as background, and the sweater extends as
# near-vertical streaks that read as its ribbing.
#
# Output:
#   media/buddy/felt.webp        sprite, 6 frames in a row, 224px each
#                                (the visible circle is the middle 1/1.16):
#                                neutral look blink happy talk closed
#                                (order is FRAMES in scripts/buddy.js)
#   media/buddy/felt-still.webp  the neutral frame, 160px (fallback + rail)
#
# Needs ffmpeg and cwebp (brew install ffmpeg webp). Run from the repo root:
#   bash tools/buddy/felt-frames.sh
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

SRC=tools/buddy/felt
OUT=media/buddy
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

FRAME=224          # sprite cell incl. overscan, px (48px avatar at ~4x)
STILL=160
# The whole round portrait, just inside its own edge (the corners outside
# the circle are white). Keep the margin around the hair: a tighter crop
# made the head touch the top of the avatar.
CROP="crop=1210:1210:22:22"
# Overscan: pad by 80px, extend radially past R=598 (just inside the source
# circle's soft rim), then crop 1210 x 1.16 = 1404 around the same centre.
OVERSCAN="pad=1414:1414:80:80:color=white,format=gbrp,geq=\
r='st(0\,hypot(X-707\,Y-707));st(1\,if(gt(ld(0)\,598)\,598/ld(0)\,1));r(707+(X-707)*ld(1)\,707+(Y-707)*ld(1))':\
g='st(0\,hypot(X-707\,Y-707));st(1\,if(gt(ld(0)\,598)\,598/ld(0)\,1));g(707+(X-707)*ld(1)\,707+(Y-707)*ld(1))':\
b='st(0\,hypot(X-707\,Y-707));st(1\,if(gt(ld(0)\,598)\,598/ld(0)\,1));b(707+(X-707)*ld(1)\,707+(Y-707)*ld(1))',\
crop=1404:1404:5:5"

# Eye band: brows and eyes, stopping above the nose. geq rather than
# drawbox because drawbox on gray writes limited-range white (235), which
# leaves an 8% ghost of the base frame's pupils.
MASK="color=c=black:s=1254x1254:d=1,format=gray,geq=lum='if(between(X\,330\,930)*between(Y\,440\,680)\,255\,0)',gblur=sigma=16"

eyes_from() {   # $1 base, $2 donor of the eye band, $3 output
  ffmpeg -v error -y -i "$1" -i "$2" -filter_complex \
    "${MASK}[m];[1:v]format=rgba[e];[e][m]alphamerge[em];[0:v][em]overlay=format=auto,format=rgb24" \
    -frames:v 1 "$3"
}

eyes_from "$SRC/look.webp" "$SRC/talk.webp"   "$TMP/neutral.png"
eyes_from "$SRC/look.webp" "$SRC/closed.webp" "$TMP/blink.png"

FRAMES=("$TMP/neutral.png" "$SRC/look.webp" "$TMP/blink.png" "$SRC/happy.webp" "$SRC/talk.webp" "$SRC/closed.webp")
INPUTS=()
CHAINS=""
LABELS=""
for i in "${!FRAMES[@]}"; do
  INPUTS+=(-i "${FRAMES[$i]}")
  CHAINS+="[$i:v]format=rgb24,${OVERSCAN},scale=${FRAME}:${FRAME}:flags=lanczos,format=rgb24[f$i];"
  LABELS+="[f$i]"
done
ffmpeg -v error -y "${INPUTS[@]}" -filter_complex "${CHAINS}${LABELS}hstack=inputs=${#FRAMES[@]}" \
  -frames:v 1 "$TMP/sprite.png"
ffmpeg -v error -y -i "$TMP/neutral.png" -vf "${CROP},scale=${STILL}:${STILL}:flags=lanczos" \
  -frames:v 1 "$TMP/still.png"

mkdir -p "$OUT"
cwebp -quiet -q 84 -m 6 "$TMP/sprite.png" -o "$OUT/felt.webp"
cwebp -quiet -q 86 -m 6 "$TMP/still.png"  -o "$OUT/felt-still.webp"
ls -la "$OUT/felt.webp" "$OUT/felt-still.webp"
