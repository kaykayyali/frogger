# Frogger

A faithful clone of the 1981 Konami arcade classic, built in vanilla HTML5
Canvas + JavaScript with synthesized Web Audio SFX.

## How to play

Open `index.html` in any modern browser. No build step.

- **Goal** — guide the frog from the start row (bottom) across 5 lanes of
  traffic, then across a river of drifting logs and turtles, into one of 5
  lily-pad home slots at the top.
- **Lives** — you start with 5 frogs. Lose all and the game ends.
- **Timer** — each run gives you a 60-second countdown (shorter on higher
  levels). Reach a home slot to bank leftover time as bonus points.
- **Score** — 10 per forward hop, 50 per home slot + 10 per second left on
  the clock, 100 per round bonus when all 5 slots are filled.

## Controls

| Action | Keys |
| ------ | ---- |
| Move   | Arrow keys or WASD |
| Start / Restart round | Space or Enter |
| Restart from scratch | R |
| Mute toggle | M |

On touch devices an on-screen d-pad appears automatically.

## Architecture

Single-page HTML5 Canvas game, no framework, no build step. Three files:

- `index.html` — markup, viewport meta, touch-control buttons.
- `styles.css` — layout, responsive canvas sizing, touch-control styling.
- `audio.js` — tiny Web Audio API synth. Each SFX (`hop`, `drown`, `hit`,
  `home`, `win`, `gameOver`, `tick`) is a short oscillator/noise envelope.
  No audio asset files.
- `game.js` — the whole game: input, world generation, update loop, render.

### Game layout

The playing field is a 13-row × 10-column grid (40-px tiles). From top to
bottom:

| Row | Kind |
| --- | ---- |
| 1   | Home (water with 5 lily-pad slots) |
| 2-5 | River (logs and turtles) |
| 6   | Median grass (safe) |
| 7-11| Road (cars and trucks) |
| 12  | Start grass (safe) |

The home row uses 5 evenly-spaced slot columns at indices `[1,3,5,7,9]`,
separated by wall areas that kill the frog if it lands there.

### Update loop

`requestAnimationFrame` drives a single `loop(ts)` that:

1. Computes `dt = (now - last) / 1000`, clamped to 50 ms (so a tab returning
   from background can't fast-forward the world).
2. Calls `update(dt)` — moves platforms, drifts the frog if riding, runs
   collision checks, ticks the timer.
3. Calls `Render.frame()` — draws HUD, field, frog, and any overlay panel.

`update()` is pure with respect to DOM; it only mutates the `State` and
`Frog` records. `Render` reads them.

### Frog movement

Grid-based: one arrow press moves exactly one tile. While on a river row,
the frog is detected as "riding" the topmost overlapping platform and
its `x` becomes the platform's x plus a captured offset. While riding,
the frog drifts with the platform — slide off either edge of the canvas
and you drown.

### Restart safety

`Game.restart()` cancels the current `requestAnimationFrame` and resets
`lastTimestamp` before starting a fresh chain, so the next frame has a
small `dt` rather than a giant catch-up step. This avoids the
"double-speed loop after restart" bug class.

### Audio context unlock

`AudioContext` is created lazily on the first user gesture (keydown or
touchstart) to satisfy browser autoplay policies.