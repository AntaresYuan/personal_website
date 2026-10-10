# Work-home felt buddy

## What the site uses: felt frames

The live avatar is built from four pixel-aligned felt portraits in
`tools/buddy/felt/` (only eyes, brows and mouth differ between them).
`felt-frames.sh` composes two more frames by swapping the eye band, crops,
and writes the sprite and still that `scripts/buddy.js` plays:

```sh
bash tools/buddy/felt-frames.sh     # needs ffmpeg + cwebp (brew install ffmpeg webp)
```

| output | what |
|---|---|
| `media/buddy/felt.webp` | sprite, 6 frames x 192px: neutral, look, blink, happy, talk, closed |
| `media/buddy/felt-still.webp` | neutral frame, 160px — the no-JS / reduced-motion still and the rail avatar |

To change an expression, replace a source in `tools/buddy/felt/` with a
re-render that keeps the exact same framing, then rerun the script. Frame
order is `FRAMES` in `scripts/buddy.js`; keep the two in step.

## Alternative: the Blender build

`build_buddy.py` is the complete source for the Work-home avatar. It creates
the geometry, felt materials, lights, portrait camera, two-bone armature,
shape keys, named actions, and final Cycles frames. A `.blend` file is not a
source dependency.

## Requirements

```sh
brew install --cask blender
brew install ffmpeg
```

The checked render was made with Blender 5.2.2 and ffmpeg 8.0.1 on Apple
Silicon. Blender falls back to CPU rendering when a Cycles GPU is unavailable.

## Preview

From the repository root:

```sh
blender -b -P tools/buddy/build_buddy.py -- \
  --preview --engine eevee --samples 8
```

This writes `media/buddy/preview.png`. It is a local review file, not a site
asset. To inspect the generated rig and actions in Blender:

```sh
blender -b -P tools/buddy/build_buddy.py -- \
  --save-blend /tmp/buddy.blend
open -a Blender /tmp/buddy.blend
```

## Final Cycles render

```sh
blender -b -P tools/buddy/build_buddy.py -- \
  --render --clip all --engine cycles --samples 32 \
  --frames-dir /tmp/personal-website-buddy-frames
```

The command renders opaque 160 x 160 RGB PNG frames at 12 fps and writes the
neutral `media/buddy/still.webp` directly from Blender. Render one clip during
iteration with `--clip idle`, for example.

The armature contains `spine` and `head`. `Eyes` owns the `blink` and
`squint_happy` shape keys; `Mouth open control` owns `mouth_open`. Every clip
has a named rig action (`buddy_<clip>`) plus matching face, gaze, mouth, and
blush actions. Loop clips key the first pose again one frame beyond the last
rendered frame so the encoded last-to-first transition is continuous.

| Clip | Frames | Duration | Playback |
|---|---:|---:|---|
| `idle` | 48 | 4.0 s | loop |
| `blink` | 4 | 0.33 s | once |
| `hello` | 10 | 0.83 s | once |
| `listening` | 24 | 2.0 s | loop |
| `nod` | 4 | 0.33 s | once |
| `thinking` | 24 | 2.0 s | loop |
| `talking` | 12 | 1.0 s | loop |
| `happy` | 12 | 1.0 s | once |

## Encode MP4 and WebM

The quality settings are intentionally conservative because all 16 videos
share a 500 KB budget. H.264 Baseline covers Safari; VP9 covers Chromium and
other browsers that prefer WebM.

```sh
for clip in idle blink hello listening nod thinking talking happy; do
  ffmpeg -y -loglevel error -framerate 12 -start_number 1 \
    -i "/tmp/personal-website-buddy-frames/$clip/${clip}_%04d.png" \
    -an -c:v libx264 -profile:v baseline -level 3.0 -preset slow -crf 35 \
    -pix_fmt yuv420p -movflags +faststart "media/buddy/$clip.mp4"

  ffmpeg -y -loglevel error -framerate 12 -start_number 1 \
    -i "/tmp/personal-website-buddy-frames/$clip/${clip}_%04d.png" \
    -an -c:v libvpx-vp9 -b:v 0 -crf 47 -deadline good -cpu-used 2 \
    -row-mt 1 -pix_fmt yuv420p "media/buddy/$clip.webm"
done
```

Check dimensions, frame rates, codecs, and the total transfer size:

```sh
for file in media/buddy/*.{mp4,webm}; do
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames \
    -of default=noprint_wrappers=1 "$file"
done
du -ch media/buddy/*.{mp4,webm} media/buddy/still.webp
```

## Browser behavior

`scripts/buddy.js` owns only playback. Mood meaning remains in
`scripts/work.js`. The buddy listens for `avatar:mood` and `avatar:nod`, keeps
the current loop underneath one-shot clips, inserts a blink while idle or
listening, pauses in hidden tabs, and leaves `still.webp` in place when reduced
motion is requested or video startup fails.
