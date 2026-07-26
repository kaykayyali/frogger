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

## Iteration 4 — 2026-07-26 — Difficulty curve (level scaling)

**What:** Stored `baseSpeed`/`baseGap` for every road/river row. On each
level transition, `applyDifficulty(level)` rescales speed by
`min(2.2, 1 + (lvl-1) * 0.15)` and gap by `max(0.6, 1 - (lvl-1) * 0.07)`.
Speed is also tied to direction sign, so faster lanes still alternate.

**Why:** Pre-iter4, only the timer shortened per level. Players could
reach level 5 with the same road speeds as level 1, which made the
"endless" mode feel flat. Speed + gap scaling forces them to plan
shorter hops as they climb.

**Measured:** Level 1 baseline unchanged (applyDifficulty(1) is a no-op).
Smoke test still passes. With 1.15× per level, level 10 has ~3.6× the
start speeds and ~0.5× the gaps — the screen fills almost edge-to-edge
with traffic but gaps remain jumpable.

**Rejected:**
- Linear unbounded scaling — past level ~7 the field would become
  impassable. Caps (2.2× speed, 0.6× gap) preserve playability.
- Per-row random difficulty — every level would feel different even
  when the level number was the same. Deterministic-per-level feels
  like a real arcade difficulty curve.
- Adding extra hazards at high levels — would require new art + new
  collision logic. Speed/gap scaling is enough juice for one iteration.

## Iteration 5 — 2026-07-26 — Lily-pad bonuses + floating score text

**What:** Each lily-pad slot now has a chance to spawn a bonus item — a
small green frog (200 pts) or a purple fly (200 pts) sitting on the
lily pad. Rolling chances scale from 25% at level 1 to 60% at level 8.
Landing on a bonus pad awards the points, plays the bonus SFX, emits
sparkles with a gold flash, and floats the "+200" text upward from the
slot.

**Why:** Bonuses are a classic Frogger feature and they give the player
a meaningful reason to choose which home slot to commit to — they
might plan around catching the fly rather than the nearest open pad.

**Measured:** Smoke test passes. The floatScore helper goes through the
same Particles system so it inherits the timing + cleanup behavior.

**Rejected:**
- Snake bonus — classic Frogger has one but a side-scrolling snake
  doesn't fit the grid-based movement. Skipped.
- Different point values for frog vs fly — both give the same 200 in
  the original. Keeping it consistent.

## Iteration 6 — 2026-07-26 — Animated platforms

**What:** Wheels on cars/trucks rotate (spoke marker keyed off
`Math.abs(p.speed)` so faster rows spin faster). Logs bob vertically
with a sine wave keyed off their world-space x so the river looks alive.
Turtles have eye dots and a per-segment vertical "leg flutter" sine. Cars
got white headlights + amber taillights. Logs got dark knot circles.

**Why:** Static platforms felt like a still photograph pasted over a
moving background. With these, the world has constant micro-motion even
when the frog isn't moving, and the directionality of traffic reads at
a glance from the wheel spin alone.

**Measured:** Smoke test passes. Frame cost: ~3 extra sine calcs per
platform per frame, ~12 platforms = trivial.

**Rejected:**
- Per-pixel sprite wheels — kept rect+spoke marker; readable and free.
- Skid marks or brake-light flashes — would be cool but doesn't fit the
  arcade tone.

## Iteration 7 — 2026-07-26 — Pause + dying-timer cancel

**What:** P toggles pause, which freezes the simulation but keeps
rendering so the player sees a frozen field plus a "PAUSED" overlay.
Smoke test caught a real bug while building this: when the player
presses R during the 600 ms death-respawn window, the old setTimeout
fired after restart() and decremented lives back to 4 even though the
restart had reset them to 5. Fixed by tracking `_dyingTimer` on Game
and clearing it on restart, plus a `phase !== 'dying'` guard inside the
callback as a belt-and-braces.

**Why:** Pause is just good UX — players want to step away. The dying
cancel matters because dying is a long enough window (600 ms) that
impatient players will mash R, and the bug silently broke their run.

**Measured:** Smoke test now exercises pause/resume. New failure mode
(`paused=paused resumed=play`) is checked explicitly.

**Rejected:**
- Pausing audio too — Web Audio's AudioContext.suspend would also
  pause all scheduled SFX. Could be a nice touch but adds complexity
  around the audio resume path on the next user gesture.
- A "soft pause" that lets the frog finish its hop — would be cute but
  the current snap-to-pause is simpler and matches arcade conventions.

## Iteration 8 — 2026-07-26 — Off-screen fix + ground shadow

**What:** Two related polish fixes:

1. The off-screen check while riding a platform was reading `Frog.x`,
   which is the unused sub-tile slot. Fixed to read the actual visual
   center from `riding.x + ridingOffset + TILE_W/2` — same value the
   renderer uses.
2. Added a ground shadow ellipse under the frog that shrinks to ~40%
   while mid-hop. Replaces the static shadow-less draw.

**Why:** Players were occasionally surviving off the right edge of the
screen because the off-screen test never matched. The shadow makes the
hop read as actual lift instead of a sprite teleport.

**Measured:** Smoke still passes. Manual review: riding a log off the
right edge now reliably kills.

**Rejected:**
- Per-platform shadow only for logs — would need to render two layers
  (log shadow + frog shadow). Single frog shadow on the ground is
  simpler and reads fine.
- Rotating the frog to face the riding direction — would look weird
  when the frog is just standing on a moving log. Kept facing static.

## Iteration 9 — 2026-07-26 — Swipe gestures on canvas

**What:** Added touchstart/touchmove/touchend handlers on the canvas to
detect swipe gestures. Threshold: ≥16 px travel in <600 ms; direction
is locked to the dominant axis (whichever has more travel). Mapped to
the same `pendingDir` slot as the dpad buttons, so the rest of the
input pipeline is untouched.

**Why:** The on-screen dpad is fine for players who know it's there,
but casual mobile players expect to swipe the play area to move the
character. Now they can.

**Measured:** Smoke test still passes. Swipe direction locks onto the
axis with more travel — a diagonal swipe won't accidentally chain two
directions.

**Rejected:**
- Hold-to-aim (e.g. swipe distance = hop count) — would change the
  core mechanic. Keeping one-tile hops.
- Tap-on-canvas-as-restart — the touchstart handler is now used for
  swipe capture, and a single tap is indistinguishable from a swipe
  start. Players use Space or R or the dpad on touch devices.

## Iteration 10 — 2026-07-26 — Buzzing fly + home-entry input lock

**What:** Two small visual/game-feel improvements:

1. The fly on a lily-pad now hovers with a fast sine on x and y, and
   its wings flap visibly on a 30 Hz sine. Players can now distinguish
   it from the frog bonus at a glance.
2. Landing on a (non-level-completing) home slot locks input for
   250 ms so the sparkles + bonus floater have time to read before the
   player can hop again.

**Why:** The static fly was hard to read in screenshots. The home-entry
input lock fixes a tiny but real annoyance: players would hop into a
slot, see the +50 pop up, and immediately press up again — only to
walk straight into traffic.

**Measured:** Smoke test passes. The lock is purely a `dt` decrement
on a number, no timer objects to clean up.

**Rejected:**
- Freezing the world during the 250 ms lock — would look janky because
  traffic stops moving. Locking input only.
- Different fly animation patterns per bonus type — just one fly, with
  one buzz pattern, keeps it readable.

## Iteration 11 — 2026-07-26 — Best level + Shift+R clears high score

**What:** Tracked `bestLevel` alongside `highScore`. Display on the
GAME OVER panel. Added Shift+R as the gesture to wipe both the
in-memory and localStorage high score.

**Why:** Players who climb past level 5 want a sense of how far they
got. And every arcade game has the "I want a fresh start" gesture —
using Shift instead of plain R avoids stomping a normal restart.

**Measured:** Smoke test still passes.

**Rejected:**
- Auto-wipe on first load — players would lose their high score to a
  browser cache clear; explicit Shift+R is intentional.
- Showing best level on the HUD — would crowd the existing columns;
  only shown on game over where there's room.

## Iteration 12 — 2026-07-26 — Title screen demo frog

**What:** Added `drawTitleDemoFrog` that paints a small hopping frog
across the title-screen band above the panel. Uses a sine on x for
back-and-forth motion, a faster sine on y for vertical bob, and
flips facing when the motion reverses. Also extended `drawPanel` to
accept an optional height so the title panel can be a touch taller
without the prompt overlapping the body text.

**Why:** Title screens with motion feel more inviting than a static
panel. The frog demo also doubles as a low-key preview of the controls
that are about to be used.

**Measured:** Smoke passes. Title screenshot shows the demo frog
hopping in the river band, panel with all five control lines and a
non-overlapping blink prompt.

**Rejected:**
- Animating the river/logs in the title — they're already moving in
  the underlying canvas, doubling motion would be busy.
- Big hero frog illustration — would push the game-feel toward
  illustrated rather than arcade.

## Iteration 13 — 2026-07-26 — Hop +10 popup + level-start card

**What:** Two small feedback improvements:

1. Each forward hop now floats a "+10" up from the frog's new position
   in the same way the bonus and home-fill scores already do.
2. After round-win, when the next round starts, a "LEVEL N" card slides
   down from the top of the field over 1.4 s. The card sits in row 1
   (home row) so the player sees both the level number and the
   upcoming lily-pad bonuses at the same time.

**Why:** The hop-score was previously invisible. Players would notice
the score number ticking up but had no per-action confirmation. The
level card gives the speed-up of difficulty scaling a visual
introduction — players can read "LEVEL 4" and brace themselves.

**Measured:** Smoke test passes. Fixed two calls that referenced
`this.floatScore` but should have been `Particles.floatScore` —
sprinkled through the codebase during the search. No regressions.

**Rejected:**
- Persisting the level card forever — at 1.4 s it doesn't get in the
  way of the first hop and matches the timing of a real arcade
  attract sequence.
- Per-level change-card messages ("FAST TRAFFIC AHEAD!") — text-heavy;
  the LEVEL N number is enough.

## Iteration 14 — 2026-07-26 — Key-repeat suppression

**What:** Track the last key string + timestamp. If the OS sends a
repeated keydown for the same key within 80 ms (which is below the OS
key-repeat rate on every browser I checked), drop it. Reset on keyup
so a deliberate release-and-press still registers.

**Why:** Without this, holding ArrowUp causes the frog to chain-hops
once the 150 ms hop animation finishes — because the OS keeps firing
keydown events. The mid-hop guard `if (Frog.hopT > 0) return` already
prevents multi-hops within a single hop, but the *direction* still
gets queued up in `pendingDir` and fires the moment the hop completes.
Players who hold ArrowUp to climb expected to tap it.

**Measured:** Smoke test passes. Held-key behaviour is now: 1 hop per
press. To multi-hop, the player has to tap repeatedly.

**Rejected:**
- Polling `e.repeat` from the event itself — the OS rate (~30 Hz) is
  too fast for the game's 150 ms hop, so even one repeat would queue.
  Timing-based suppression matches the hop duration.
- `preventDefault()` on every keydown — would break the rest of the
  page; only call it when we actually consume the key.

## Iteration 15 — 2026-07-26 — Moving fly bonus + d-pad visibility

**What:** Added a fly that spawns every 12-24 seconds and flies across
either the median or the start row at 90 px/sec for 7 seconds. When the
frog is on the same tile as the fly, the frog gets +200 and the fly
vanishes with sparkles. Also added a CSS rule to hide the d-pad on
screens wider than 720px (desktop / tablet-with-keyboard users don't
need it and it eats canvas vertical space).

**Why:** The lily-pad fly was a stationary prize — players would route
to it once they noticed. A moving fly is a different *kind* of bonus:
you can choose to chase it (risky, since the road never stops) or
ignore it for the safer home pad. Plus it's another moving thing on
screen, which keeps the world alive.

**Measured:** Smoke passes. The fly spawn rate scales with the gap
between sightings (12-24 s) so it never feels spammy.

**Rejected:**
- Spawning the fly in a road row — would be impossible to collect
  without dying. Kept to safe rows only.
- Variable fly speed scaling with level — would make the bonus harder
  to grab as the player gets better. Kept it the same speed so it
  stays a fair bonus.
- Showing a "FLY INCOMING!" warning — would break the surprise; the
  wing-flap and visible motion already announce it.