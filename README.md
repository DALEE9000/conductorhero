# Conductor Hero

Guitar Hero for orchestral conducting. Upload an MP3 (or play the built-in demo
symphony), the game analyzes beats / tempo / dynamics / section entries offline,
builds a choreography, and you conduct a 3D orchestra with your hand (webcam,
MediaPipe hand tracking) or the mouse. Score by hitting beats on time, matching
gesture size to the music's dynamics, and cueing sections when they enter.

## Run

```
cd conductorhero
python -m http.server 8123
# then open http://localhost:8123
```

No build step. Three.js and MediaPipe load from CDN (internet required).
Camera mode needs localhost or https (secure context) — `http.server` on
localhost qualifies.

## Play

- **Demo Symphony** — synthesizes a ~76s orchestral piece in-browser, then
  analyzes it like any upload. Zero files needed.
- **Upload** — any MP3/WAV/OGG/M4A the browser can decode.
  - Spotify streams are DRM-protected; the browser cannot read their raw audio.
    Export/record to MP3 first, then upload.
- **Input**: three baton modes —
  - *Camera (hand)*: MediaPipe hand tracking; fingertip points, wrist velocity
    detects beats (wrist survives motion blur).
  - *Camera (pen/baton tip)*: color-blob tracking of a real baton/pen tip.
    Calibration samples the tip's color first (hold it in the gold circle);
    works best with a brightly colored tip — wrap red/green/blue tape around it.
    Holding a pen also confuses hand tracking, so use this mode when conducting
    with an object.
  - *Mouse*.
- **Beats**: flick downward so the bottom of the stroke lands when a marker
  reaches the gold ictus ring. PERFECT < 90 ms, GOOD < 170 ms.
- **Dynamics**: the right-side meter shows the target level; make your strokes
  bigger (forte) or smaller (piano) to keep the needle in the band → bonus.
- **Expression** (the choreography follows the music's contour, not just the grid):
  - *Hairpins* over the highway: `cresc.` = grow your strokes across the span
    (+300), `dim.` = shrink them (+300) — judged start-of-span vs end-of-span.
  - *Silences*: shaded "𝄐 hold still" regions — keep the baton still (+200).
  - *Sforzando stars*: star-shaped beats want a big whipped stroke (+150).
  - *Slurs* under connected beats mark legato passages; the pattern-guide box
    also breathes — bigger figure when the music is forte.
- **Cues**: "CUE: VIOLINS ◀ / ✋" — either point the baton into that third of
  the screen, or (camera modes) raise your LEFT hand up-left and hold it a
  moment, at the cue time (±0.75s) → +250 and the section lights up.
- **Pattern box** (top-left): gold dot = where the baton should be (music-synced
  guide), white ring = where your baton is.
- **YouTube score video** (optional, menu field): embeds the video muted,
  centered behind the HUD, and keeps it seek-synced to your MP3 (±0.4s).
  Browsers cannot read YouTube's audio (DRM/cross-origin), so the analyzed and
  audible track is always your uploaded file — use a video of the same recording.
- **Calibrate** (menu → Advanced, or the Ready screen): two phases —
  4 free flicks teach the game your stroke strength (sensitivity), then 8
  metronome clicks measure your input latency (offset). Run it once per input
  mode; results persist in localStorage. Camera modes show a big preview with
  the tracker's view drawn on it (green dots = hand landmarks, gold ring =
  where the game thinks the baton is) plus a status line that says *why*
  nothing is seen: `NO CAMERA FRAMES` (another app holds the webcam),
  `TRACKER ERROR` (GPU delegate failed — the game retries on CPU
  automatically), `TOO DARK`, or `NOT SEEN · camera 30 fps` (feed fine, hand
  or tip not recognized — reframe / recalibrate the tip color). Camera tips:
  face a light source, keep the hand inside the preview, conduct with clear
  vertical strokes. Console `[vision]` lines carry the raw errors.
- **Input offset** slider (menu → Advanced): manual override of the measured
  latency. Positive = your gestures register late. Default 60 ms camera / 0 mouse.
- **Performance**: pixel ratio capped at 1.5, bloom at half resolution; a
  governor watches fps and degrades one-way (bloom off + 1x pixels below ~45,
  shadows off below ~36) — see `[perf]` lines in the console.

## Architecture

| File | Role |
|---|---|
| `src/audio-analysis.js` | FFT, spectral-flux onsets, autocorrelation tempo, DP beat tracking (Ellis-style), RMS dynamics, band energies, section-entry cues |
| `src/demo-song.js` | OfflineAudioContext-rendered demo piece (strings/winds/brass/timpani, crescendo arc) |
| `src/choreography.js` | analysis → beat/cue/dynamic event timeline |
| `src/vision.js` | webcam + MediaPipe HandLandmarker or mouse; ictus (downbeat flick) detection, stroke amplitude |
| `src/orchestra.js` | three.js stage: ~23 procedural players in sections, bowing/sway/timpani-strike animation, cue spotlights, bloom |
| `src/game.js` | state machine, scoring, combo, results |
| `src/hud.js` | 2D canvas overlay: beat highway, baton trail, dynamics meter, cue banners, score |
| `src/main.js` | DOM wiring, rAF loop |

## Roadmap (AAA loop)

- [x] v1: full pipeline playable end to end
- [x] Multi-agent review pass; 4 majors + 8 minors fixed (offset-aware miss sweep,
  rate-independent ictus hysteresis, mode-gated pointer input, HUD above preview,
  camera-stream lifecycle, short-file guard)
- [x] Calibration screen (8 metronome clicks → median offset, per input mode)
- [x] Meter estimation (2/4, 3/4, 4/4 by accent contrast) + conducting-pattern guide overlay
- [x] Difficulty levels (Apprentice / Kapellmeister / Virtuoso) + local high scores per piece+difficulty
- [x] Hall dressing: organ pipes, chandeliers, section risers
- [x] Structural boundaries: ≥3 bands rising together → TUTTI cue (outranks nearby
  section cues); whole stage lights up
- [x] Pattern guide traces the stroke: beat-synced dot travels between nodes
- [x] Performance pass: chairs/stands/organ pipes merged per material (~120 fewer draw calls)
- [ ] 6/8 and compound meters (currently detected as 2 or 3 — ponytail ceiling:
  accent-contrast over eighth-note pulse; add compound grouping if real scores misread)
- [ ] More instrument variety (oboe/bassoon reeds, harp), concertmaster nod, page turns
- [ ] Browser-verified visuals (needs Chrome extension or a human playtest)
