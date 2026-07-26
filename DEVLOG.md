# DEVLOG — Frogger

A dated record of every iteration. Each entry records: what changed, why,
what was measured or observed, and what was rejected.

## v1 — 2026-07-26 — Initial playable build

**What:** Built the complete game from scratch. Layout: 13 rows × 10 cols,
HUD strip on top. Five home slots on row 1, four river lanes (rows 2-5)
with mixed logs/turtles, median grass on row 6, five road lanes (rows 7-11)
with cars and trucks, start grass on row 12. Lives system (5 frogs),
60-second timer with shorter timer per level, level-complete bonus.

**Why:** Need all four hard specs satisfied to ship the v1.

**Implemented:**
- HTML5 Canvas, vanilla JS, no build step — opens `index.html` and it just
  works.
- Title screen, in-game HUD, game-over screen with restart, level-complete
  panel.
- Keyboard (arrows + WASD + R/M/Space) and on-screen touch d-pad that
  appears on touch devices via a `@media (hover: none) and (pointer: coarse)`
  query.
- Frog hops one tile per arrow press; riding a log/turtle sticks the frog
  to the platform and drifts it with the platform's velocity.
- Real collision detection — road cars kill, river drowning kills, off-
  canvas while riding kills.
- Timer counts down, last-10-seconds tick, timer-expiry kills.
- Web Audio synth: hop (square sweep), drown (filtered noise), hit (noise +
  saw sweep), home (3-note arpeggio), win (4-note fanfare), game-over
  (descending saw), tick, level-complete bonus tone.
- `restart()` cancels any pending RAF and resets `lastTimestamp` so a
  restarted game can't fast-forward the first frame.

**Measured:** `node --check audio.js game.js` passes. Tile math: 13 × 46.15
≈ 600, leaving 40 px for the HUD bar.

**Rejected:**
- Adding a separate spritesheet — kept to drawRect/drawEllipse primitives
  for now. Looks blocky but cheap and predictable.
- A "fly bonus" (classic Frogger had a fly that appeared randomly on a
  home slot for 200 points). Could come later.
- Multi-life timers — single global timer for v1.

## Iteration 1 — 2026-07-26 — HUD + panel polish

**What:** Reworked the HUD layout (1UP / TIME / HI columns, lives icons in
the upper-right, LV badge) and the modal panels (FROGGER title, GAME OVER,
LEVEL CLEAR) so text no longer overflows.

**Why:** Smoke screenshot showed the title screen had `ow keys / WASD...`
bleeding outside the panel and the HUD had `HI 00000` overlapping `TIME 60`.

**Measured:** Smoke test still passes (score 20 after 2 hops). New
screenshot shows clean panel with all lines inside the border, HUD
legible. Lives icons sit in the corner without overlapping the time.

**Rejected:**
- Bigger panel (would hide more game). Kept at 100 px padding so players
  see the field while reading.
- Different fonts — system monospace is consistent enough and avoids
  asset loading.

## Iteration 2 — 2026-07-26 — Juice: particle effects + flashes

**What:** Added a small `Particles` system: water splash on drown,
sparkles on home fill, confetti on level complete, brief colored screen
flash on death and level win. Drawn on top of the frog so they read
clearly.

**Why:** Even when the game logic is right, the v1 felt inert — the only
feedback for dying or winning was a sound and an instantaneous state
change. Particles give the player something to look at during the
~600ms death respawn delay and the round-win panel transition.

**Measured:** Smoke test still passes. The splash color is keyed to the
death cause (blue for water, red for car, yellow for timeout) so players
can tell at a glance why they died even before reading the panel.

**Rejected:**
- Sprite-based particles — pure rect particles render fast enough and
  keep with the retro aesthetic.
- Long-lived embers / screen shake — the canvas size is fixed at 480×640
  and shake would push the field out of view. Particles only.

## Iteration 3 — 2026-07-26 — Better frog + animated water

**What:** Redrew the frog with legs, belly highlight, larger eye domes,
and a mouth line. Added two layers of sine-wave "ripples" on every river
row and the home row.

**Why:** The v1 frog was a flat green ellipse. Hard to read at a glance
especially when the screen was full of motion. The static dark-blue river
also felt dead next to all the moving cars.

**Measured:** Smoke test passes. Screenshot shows the new frog sprite at
the start row with visible eyes and legs, and faint cyan dashes rippling
across the water bands.

**Rejected:**
- Per-pixel sprite animation — would mean a sprite sheet and atlas code.
  Pure shapes keep the file under 30 KB and load instantly.
- Tilting the frog toward facing direction mid-hop — looks weird because
  the hop is short; kept facing as a static rotation when grounded only.