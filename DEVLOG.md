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