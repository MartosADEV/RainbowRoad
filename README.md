# Rainbow Road: Safety Car — OHS Edition

13 kB game jam entry. Endless runner where you are **not** trying to survive Rainbow Road —
you are trying to make it safe while surviving it.

You are the Health & Safety officer sent ahead of the karts. The track is full of bananas,
oil spills, shells, broken barriers, missing signage, bob-ombs and road damage. You can dodge
them, or you can actually do your job.

## Briefing

The game opens on a three-card OHS personnel file that introduces the officer and the job, then
drops into the menu. It runs once per page load — retrying after a game over goes straight back
into play, so it never gets in the way of a score chase.

The officer is a 24x46 palette-index sprite drawn at integer scale 3. The whole briefing —
sprite, palette, three cards of copy, page dots and the state — cost 514 bytes zipped.

## Play

```bash
node build.mjs && node serve.mjs
```

Then open http://localhost:8137. Or just open `dist/index.html` directly — it is a single
self-contained file with no external requests.

### Controls

| Key | Action |
| --- | --- |
| `A` / `←` / `D` / `→` | Change lane |
| `E` / `Shift` | Safety action — CLEAN / REMOVE / REPAIR / SIGNAL (chosen automatically) |
| `Space` | Safety Brake (slows the world, buys reaction time, costs distance score) |
| `W` / `↑` | Temporary acceleration |
| `M` | Mute |

### Touch

Touch devices are detected with `matchMedia('(pointer:coarse)')` plus a user-agent fallback, and
get a different scheme — tap zones are fine with a cursor but useless with a thumb:

- **Swipe left / right** anywhere on the track to change lane. The swipe is repeatable without
  lifting your finger: every 26 buffer pixels of travel fires another lane change.
- **[E] button**, bottom left — the safety action.
- **[B] button**, below it — hold for the Safety Brake.

Both buttons are sticky and multi-touch: you can hold the brake with one thumb and swipe or tap
`E` with the other. The menu, the incident report and the final report all switch their prompts
to "tap" wording on touch devices.

There is no mute control on touch — `M` is keyboard only.

### The decision

Dodging keeps you alive. Fixing keeps you employed.

- **Avoid** (change lane) — no reward, small compliance cost, combo survives.
- **Mitigate** (stay in the lane, press `E` inside the action window) — Safety Score, points, combo.
- **Ignore** (leave it in your own lane) — full compliance penalty, combo resets.

A pure dodger survives but scores roughly a quarter of what an active officer scores over the
same distance. OHS inspections periodically grade you on hazards handled per row of track.

### Item boxes

Every 20-30s a row of Mario-Kart-style item boxes crosses the track with **exactly one lane
empty**. Sit in the gap and press `E` to restock the missing box — same credit as servicing a
hazard. Drive into either of the other two lanes and you take a mushroom, which is a *penalty*
here: 7 seconds at 1.45x speed, which is the last thing a safety officer needs. The mushroom rides
on the car roof with a countdown so the speed change is always attributable, and the Safety Brake
still cuts you back to a workable pace, so braking is the counter-play rather than something you
sit out.

Collecting a box costs no Safety (types 9 and 10 are outside the ignore/penalty path). The row is
spawned 40 units beyond the normal spawn line and suppresses normal hazard rows while it is in
play, so it always arrives as its own clean beat — otherwise a stray shell shares the gap lane and
the "go to the empty lane" read falls apart.

### The racer

The RACER APPROACHING event puts an actual kart on the track. It is hazard type 8: it closes at
1.8x the world scroll, cannot be cleaned or repaired, does not count as an ignored hazard when it
passes, and hits hard if you are still in its lane. A marshal flag floats above it while it is
distant so the lane is telegraphed early, and normal hazard rows are held back while it is inside
z 78 so its lane is never the only way through.

## Build

`node build.mjs` minifies `src/game.js` with terser, inlines it into `src/index.html`, writes
`dist/index.html`, and packs a deterministic `dist/game.zip`. It prints the size table and exits
non-zero if the ZIP breaks 13312 bytes (the js13kgames limit).

It also writes `dist/dev.html` — the unminified twin with `//DBG` instrumentation left in, served
at `/dev` for the test harness. Neither the harness nor `//DBG` lines ship.

## Notes on the design

- No images, no audio files, no fonts, no libraries. Road, hazards, car, particles, text and
  sound are all generated at runtime.
- Pseudo-3D is a single projection `scale = CAM / (z + CAM)`; there is no 3D engine.
- Hazards are generated per row with a weighted digit-string table. A row never blocks all three
  lanes, so there is always a viable path (GDD §24).
- The incident report freezes the world deliberately — the bureaucratic beat is the joke.

## Notes on the pixel-art layer

- Everything draws into a **480x270 offscreen buffer**, blitted once per frame to the 960x540
  display canvas with `imageSmoothingEnabled = false`. That single indirection is what makes the
  whole game read as pixel art — nothing is authored in screen pixels.
- **Font**: a 5x7 bitmap face, one base-32 digit per glyph row (5 bits, MSB leftmost), 57 glyphs
  in 399 characters. It has no lowercase — `txt()` upper-cases everything, which is both cheaper
  and more arcade-correct. `^` renders the warning triangle, `~` the tick, `*` a star, `<`/`>` the
  arrow keys.
- **Sprites** are palette-index strings (`'0'` = transparent) baked once into offscreen canvases,
  so per-frame drawing is one scaled `drawImage` rather than hundreds of `fillRect`s. They also
  compress far better than the vector paths they replaced.
- **Dithering** is 2x2 checkerboard `createPattern` fills — used for the sky band seams and the
  haze at the vanishing point. The haze tracks `px(1, NSEG*SEG)`, the real projected end of the
  road, so it follows the curve and the hill.
- Scanlines and the vignette are applied on the display canvas after the blit, as one pattern fill
  and one gradient fill.

## Notes on the logo

The menu logo is `logo.png` converted to a palette-index sprite by `tools/logo.mjs`:

```bash
node tools/logo.mjs          # survey sizes/palettes, write previews to shots/
node tools/logo.mjs 112 12   # emit src/logo.js at the chosen size
```

`build.mjs` splices `src/logo.js` in at the `//LOGO` marker, so `game.js` stays readable and the
logo can be re-derived at any size without hand-editing.

**The source `logo.png` is not in the repo** — only the generated `src/logo.js` is, which is all
`build.mjs` needs. `tools/logo.mjs` will fail without it; put the original PNG back in the repo
root first if you want a different size or palette.

**Why not embed the PNG.** A PNG is already DEFLATE-compressed, so the jam zip cannot squeeze it
further — measured, a base64 PNG costs ~1.01x its own bytes, which capped the artwork at ~2.8 kB
and would have consumed the entire remaining budget. The same image as a palette-index string
compresses several times over, scales at integer factors without blurring, and reuses the `bake()`
pipeline every other sprite already goes through.

Sizing was chosen by measuring real build deltas, not estimates — the isolated string measurement
under-reports by ~350 B once palette literals and JS boilerplate are included:

| Size | Colours | Real zip total |
| --- | --- | --- |
| 128x68 | 12 | 13586 B — over budget |
| 120x64 | 12 | 13256 B |
| 128x68 | 8 | 13152 B |
| 112x59 | 16 | 13127 B |
| **112x59** | **12** | **12900 B (shipped)** |

12 colours is visually near-indistinguishable from 16 here and leaves 412 B of headroom instead
of 185 B. `bake()` reads `'0'`-`'9'` then `'A'` onward, so palettes can exceed ten entries.

## Notes on the music

Two oscillator voices over a four-bar chord progression (`CHORD`), with two arpeggio figures
(`NOTE` / `NOT2`) and the lead timbre swapping every four bars. Nothing repeats for 64 steps —
about 10 seconds — from three small arrays. During a OHS inspection the step time drops from
155 ms to 118 ms and the whole progression transposes down a fourth, so the pressure is audible.
`M` mutes.

Two level traps worth remembering if you touch the synth:

- A `triangle` carries far less energy than a `square` at the same gain, so the B section needs
  its own gain (.032 vs .017) or it drops out of the mix. Measured through a 200 Hz high-pass —
  roughly what a phone or laptop speaker passes — that took the A/B imbalance from 1.39x to 0.85x.
- The bass sits at 110 Hz base (87-147 Hz across the progression). An octave lower is under the
  rolloff of small speakers and simply disappears.
