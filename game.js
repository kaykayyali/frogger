// game.js — Frogger clone (1981 Konami).
//
// Game layout (13 rows tall + HUD):
//   Row  0 : HUD (score, time, level, lives)
//   Row  1 : HOME row — water with 5 lily-pad slots; goal is to land on one
//   Rows 2-5 : river — 4 lanes of logs and turtles, moving left/right
//   Row  6 : median — safe grass strip
//   Rows 7-11: road — 5 lanes of cars/trucks, moving left/right
//   Row 12 : start — safe grass strip (frog spawn)
//
// Movement is grid-based: arrow keys move the frog exactly one tile.
// While the frog is on a log/turtle, it drifts with that platform.
// Touch buttons mirror arrow keys.

(function (global) {
  'use strict';

  // ---------- Constants ----------
  const W = 480, H = 640;
  const HUD_H = 40;
  const FIELD_H = H - HUD_H;            // 600
  const ROWS = 13;
  const TILE = FIELD_H / ROWS;          // ~46 px
  const COLS = Math.round(W / TILE);    // 10
  const TILE_W = W / COLS;              // exact width
  const COL = (c) => c * TILE_W;
  const ROW = (r) => HUD_H + r * TILE;

  // Per-row configuration for v1 (kept readable; iteration can tune).
  // kind: 'road' | 'river' | 'safe' | 'home'
  // speed: px/sec (positive = right, negative = left)
  // gap: average spacing between vehicles in tiles (multiplied by TILE)
  // type: 'car' | 'truck' | 'log' | 'turtle' | 'turtleDive'
  // length: vehicle length in tiles
  const ROW_CFG = [
    /* row 1  HOME   */ { kind: 'home' },
    /* row 2  river  */ { kind: 'river', speed:  60, gap: 3.0, type: 'log',     length: 3 },
    /* row 3  river  */ { kind: 'river', speed: -50, gap: 2.5, type: 'turtle',  length: 2 },
    /* row 4  river  */ { kind: 'river', speed:  80, gap: 3.5, type: 'log',     length: 4 },
    /* row 5  river  */ { kind: 'river', speed: -70, gap: 2.0, type: 'log',     length: 2 },
    /* row 6  median */ { kind: 'safe' },
    /* row 7  road   */ { kind: 'road',  speed:  90, gap: 2.5, type: 'car',     length: 1 },
    /* row 8  road   */ { kind: 'road',  speed: -110, gap: 3.0, type: 'truck',  length: 2 },
    /* row 9  road   */ { kind: 'road',  speed: 130, gap: 2.0, type: 'car',     length: 1 },
    /* row 10 road   */ { kind: 'road',  speed: -100, gap: 4.0, type: 'truck',  length: 2 },
    /* row 11 road   */ { kind: 'road',  speed: 150, gap: 1.5, type: 'car',     length: 1 },
    /* row 12 start  */ { kind: 'safe' },
  ];

  // Difficulty curve — applied to ROW_CFG values on level transitions.
  // Each level bumps platform speed and tightens gaps. Caps so the world
  // stays readable past level 10.
  function applyDifficulty(level) {
    const lvl = Math.max(1, level);
    // Speeds scale ~15% per level up to +120%; gaps shrink ~7% per level
    // down to 60%. Caps keep late-game playable.
    const speedScale = Math.min(2.2, 1 + (lvl - 1) * 0.15);
    const gapScale    = Math.max(0.6, 1 - (lvl - 1) * 0.07);
    for (const cfg of ROW_CFG) {
      if (cfg.kind === 'road' || cfg.kind === 'river') {
        cfg.speed = cfg.baseSpeed * speedScale;
        cfg.gap   = cfg.baseGap   * gapScale;
      }
    }
  }
  // Capture the base values for the difficulty curve.
  for (const cfg of ROW_CFG) {
    if (cfg.kind === 'road' || cfg.kind === 'river') {
      cfg.baseSpeed = cfg.speed;
      cfg.baseGap   = cfg.gap;
    }
  }

  // Home slot columns — 5 evenly spaced, leaving wall columns on edges.
  const HOME_COLS = [1, 3, 5, 7, 9];

  // Bonus items: appear randomly on a lily-pad. Frog = 200 points,
  // Fly = 200 points (classic Frogger). We model them per-slot.
  const BONUS_TYPES = { frog: 200, fly: 200, none: 0 };
  function rollBonus(level) {
    // 25% chance per slot to carry a bonus; scales with level.
    const chance = Math.min(0.6, 0.25 + level * 0.05);
    if (Math.random() < chance) {
      return Math.random() < 0.5 ? 'frog' : 'fly';
    }
    return null;
  }
  const FROG_START = { row: 12, col: 5 };  // bottom-center-ish
  const MAX_LIVES = 5;
  const TIMER_START = 60;   // seconds per run
  const TIME_BONUS = 10;    // points per second remaining on success
  const LEVEL_BONUS = 100;  // bonus for completing all 5 home slots

  // ---------- Input ----------
  const Input = {
    pendingDir: null,   // queued direction (one-step queue so quick taps register)
    lastKey: '',        // last key string seen by the handler — used to
                        // suppress OS key-repeat (ArrowUp held = 1 hop, not 30).
    lastKeyTime: 0,
    bind(canvas) {
      const unlock = () => Sfx.resume();
      const onKey = (e) => {
        const k = e.key;
        // OS key-repeat sends repeated keydown events at the OS repeat
        // rate. We only want the *first* press to queue a move. Treat
        // any repeat within 80 ms of the same key as a hold (ignored).
        const now = performance.now();
        if (e.repeat && (k === this.lastKey) && (now - this.lastKeyTime < 80)) {
          e.preventDefault();
          return;
        }
        this.lastKey = k;
        this.lastKeyTime = now;
        const map = {
          ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
          w: 'up', s: 'down', a: 'left', d: 'right',
          W: 'up', S: 'down', A: 'left', D: 'right',
        };
        if (k in map) { this.pendingDir = map[k]; unlock(); e.preventDefault(); }
        if (k === ' ' || k === 'Enter') { Game.tryStart(); unlock(); e.preventDefault(); }
        if (k === 'r' || k === 'R') { Game.restart(); unlock(); e.preventDefault(); }
        if (k === 'm' || k === 'M') { Sfx.setEnabled(!Sfx.enabled); }
        if (k === 'p' || k === 'P') { Game.togglePause(); unlock(); e.preventDefault(); }
        if ((k === 'r' || k === 'R') && e.shiftKey) {
          State.highScore = 0;
          State.bestLevel = 1;
          try {
            localStorage.removeItem('frogger.high');
            localStorage.removeItem('frogger.bestLevel');
          } catch (e) {}
          e.preventDefault();
        }
      };
      global.addEventListener('keydown', onKey, { passive: false });
      // Reset lastKey on keyup so a release-and-press registers again.
      global.addEventListener('keyup', () => { this.lastKey = ''; });
      // Touch buttons
      document.querySelectorAll('.tc-btn').forEach((btn) => {
        const dir = btn.getAttribute('data-dir');
        const fire = (ev) => { ev.preventDefault(); unlock(); this.pendingDir = dir; };
        btn.addEventListener('touchstart', fire, { passive: false });
        btn.addEventListener('mousedown',  fire);
      });
      // Swipe gestures on the canvas: detect horizontal/vertical swipes
      // and map to direction keys. Threshold tuned for phones — a quick
      // flick beats a slow drag.
      let sx = 0, sy = 0, stime = 0;
      canvas.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; stime = performance.now();
        unlock();
      }, { passive: true });
      canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
      canvas.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        const dt = performance.now() - stime;
        const dist = Math.hypot(dx, dy);
        if (dist < 16 || dt > 600) return;
        // Lock to whichever axis has more travel.
        if (Math.abs(dx) > Math.abs(dy)) {
          this.pendingDir = dx > 0 ? 'right' : 'left';
        } else {
          this.pendingDir = dy > 0 ? 'down' : 'up';
        }
      });
      // Tap-on-canvas as start/restart convenience. Click is converted from
      // CSS px to game coordinates via Layout.clientToGame so it works
      // regardless of how the canvas was scaled by CSS.
      canvas.addEventListener('click', (ev) => {
        unlock();
        const p = Layout.clientToGame(ev.clientX, ev.clientY);
        if (!p) return;
        // Check the in-canvas RESTART button when in gameover.
        const btn = State._restartBtn;
        if (btn && State.phase === 'gameover'
            && p.x >= btn.x && p.x <= btn.x + btn.w
            && p.y >= btn.y && p.y <= btn.y + btn.h) {
          Game.restart();
          return;
        }
        Game.tryStart();
      });
      // Don't fire tap-start from touch — it's used for swipe gestures.
      // The dpad buttons already handle their own touchstart.
    },
  };

  // ---------- Game state ----------
  const State = {
    phase: 'title',     // 'title' | 'play' | 'dying' | 'roundwin' | 'gameover' | 'paused'
    score: 0,
    highScore: 0,
    lives: MAX_LIVES,
    level: 1,
    timer: TIMER_START,
    timerMax: TIMER_START,
    homeFilled: [false, false, false, false, false],  // 5 slots
    homeBonus:  [null, null, null, null, null],     // 'frog'|'fly'|null per slot
    deathsThisRound: 0,  // number of frog deaths during this round
    countdownT: 0,       // ready-countdown remaining (sec); blocks input
    floaters:  [],       // floating score texts
    bestLevel: 1,        // highest level reached this session
    levelCardT: 0,       // level-title card remaining time (sec)
    fly: null,           // moving fly bonus across the playfield
    flyNext: 0,          // seconds until next fly spawn
    justBeatBest: false, // true if last run beat the persisted high score
    lastTimestamp: 0,
    rafId: null,
    particles: [],      // active particle effects
    flashes: [],        // short screen-tint flashes (e.g. on level complete)
  };

  // ---------- Particles ----------
  // Tiny particle system for juice: death splashes, home success sparkles,
  // bonus pickup confetti. Each particle has position, velocity, life,
  // color, and size. Heavy on readability, light on math.
  const Particles = {
    emitSplash(cx, cy, color) {
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 140;
        State.particles.push({
          x: cx, y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 80,    // bias upward
          g: 280,                       // gravity
          life: 0.5 + Math.random() * 0.4,
          age: 0,
          color: color || '#7ad7ff',
          size: 2 + Math.random() * 3,
        });
      }
    },
    emitSparkles(cx, cy) {
      const palette = ['#ffea00', '#39d353', '#7ad7ff', '#ffffff'];
      const N = 22;
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 80 + Math.random() * 180;
        State.particles.push({
          x: cx, y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 60,
          g: 200,
          life: 0.6 + Math.random() * 0.6,
          age: 0,
          color: palette[i % palette.length],
          size: 3 + Math.random() * 3,
        });
      }
    },
    // Concentric ring particles — used on successful landing in a slot
    // and on the new-round start. Spawns a few colored rings that
    // expand and fade.
    emitRipples(cx, cy, color) {
      for (let i = 0; i < 3; i++) {
        State.particles.push({
          kind: 'ripple',
          x: cx, y: cy,
          r: 4,
          r0: 4,
          r1: 26 + i * 6,
          age: 0,
          life: 0.5 + i * 0.1,
          color: color || '#39d353',
          width: 2,
        });
      }
    },
    emitConfetti(cx, cy) {
      const palette = ['#ff3a3a', '#39d353', '#ffea00', '#7ad7ff', '#ffffff', '#ff7ad9'];
      const N = 50;
      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const sp = 180 + Math.random() * 240;
        State.particles.push({
          x: cx + (Math.random() - 0.5) * 60,
          y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          g: 240,
          life: 1.2 + Math.random() * 0.8,
          age: 0,
          color: palette[i % palette.length],
          size: 3 + Math.random() * 3,
        });
      }
    },
    flash(color, alpha) {
      State.flashes.push({ color: color || '#fff', alpha: alpha || 0.5, age: 0, life: 0.25 });
    },
    floatScore(x, y, text, color) {
      State.floaters.push({ x, y, text, color: color || '#fff', age: 0, life: 1.2 });
    },
    update(dt) {
      // Update particles
      for (let i = State.particles.length - 1; i >= 0; i--) {
        const p = State.particles[i];
        p.age += dt;
        if (p.age >= p.life) { State.particles.splice(i, 1); continue; }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      // Update flashes
      for (let i = State.flashes.length - 1; i >= 0; i--) {
        const f = State.flashes[i];
        f.age += dt;
        if (f.age >= f.life) State.flashes.splice(i, 1);
      }
      // Update floaters
      for (let i = State.floaters.length - 1; i >= 0; i--) {
        const f = State.floaters[i];
        f.age += dt;
        if (f.age >= f.life) State.floaters.splice(i, 1);
        else f.y -= 24 * dt;
      }
    },
    draw(ctx) {
      // Particles — draw rect particles and ring particles together.
      for (const p of State.particles) {
        if (p.kind === 'ripple') {
          const t = 1 - p.age / p.life;
          const r = p.r0 + (p.r1 - p.r0) * (1 - t);
          ctx.globalAlpha = Math.max(0, t);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const t = 1 - p.age / p.life;
          ctx.globalAlpha = Math.max(0, t);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
      ctx.globalAlpha = 1;
      // Floaters
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 14px monospace';
      for (const f of State.floaters) {
        const t = 1 - f.age / f.life;
        ctx.globalAlpha = t;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
      // Flashes
      for (const fl of State.flashes) {
        const t = 1 - fl.age / fl.life;
        ctx.fillStyle = fl.color;
        ctx.globalAlpha = t * fl.alpha;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    },
    clear() {
      State.particles.length = 0;
      State.flashes.length = 0;
      State.floaters.length = 0;
    },
  };

  // ---------- Helpers ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(min, max) { return min + Math.random() * (max - min); }

  // ---------- World objects ----------
  // Each platform is a vehicle (road) or floating (river).
  // We generate them per-row on level start with deterministic-but-varied
  // starting offsets so they spread across the row.
  function spawnPlatforms() {
    const out = [];
    for (let r = 0; r < ROW_CFG.length; r++) {
      const cfg = ROW_CFG[r];
      if (cfg.kind !== 'road' && cfg.kind !== 'river') continue;
      const lenPx = cfg.length * TILE_W;
      const gapPx = cfg.gap * TILE_W;
      const stride = lenPx + gapPx;
      // Start the first platform off-screen so the row scrolls in.
      const count = Math.ceil((W + stride) / stride) + 2;
      const offset = -((Math.random() * stride) | 0);
      for (let i = 0; i < count; i++) {
        out.push({
          row: r,
          x: offset + i * stride,
          len: lenPx,
          speed: cfg.speed,
          type: cfg.type,
          // Turtle diving state: every group cycles so one turtle dives
          // then surfaces. Implementation: a phase offset per turtle row.
          phase: cfg.type === 'turtle' ? Math.random() * 4 : 0,
        });
      }
    }
    return out;
  }

  // ---------- Frog ----------
  const Frog = {
    row: FROG_START.row,
    col: FROG_START.col,
    x: 0, y: 0,           // sub-tile position while riding a platform
    riding: null,         // current platform or null
    ridingOffset: 0,      // distance from platform's left edge
    facing: 'up',
    hopT: 0,              // hop animation 0..1
    reset() {
      this.row = FROG_START.row;
      this.col = FROG_START.col;
      this.x = 0; this.y = 0;
      this.riding = null;
      this.ridingOffset = 0;
      this.facing = 'up';
      this.hopT = 0;
    },
    setCell(row, col) {
      this.row = row;
      this.col = col;
      this.x = 0; this.y = 0;
      this.riding = null;
      this.ridingOffset = 0;
      this.hopT = 0;
    },
  };

  // ---------- Game logic ----------
  const Game = {
    platforms: [],

    start() {
      // Reset state for a brand-new run
      State.phase = 'title';
      State.score = 0;
      State.lives = MAX_LIVES;
      State.level = 1;
      State.timer = TIMER_START;
      State.timerMax = TIMER_START;
      State.homeFilled = [false, false, false, false, false];
      State.homeBonus = [null, null, null, null, null];
      State.deathsThisRound = 0;
      applyDifficulty(1);
      this.platforms = spawnPlatforms();
      Frog.reset();
      this.loop(performance.now());
    },

    restart() {
      // Cancel any in-flight animations to prevent double-speed loops.
      if (State.rafId) cancelAnimationFrame(State.rafId);
      State.rafId = null;
      // Cancel any pending death-respawn timeout so it can't decrement
      // lives after restart has reset them.
      if (this._dyingTimer) { clearTimeout(this._dyingTimer); this._dyingTimer = null; }
      this._homeLock = 0;
      this.platforms = spawnPlatforms();
      Frog.reset();
      State.score = 0;
      State.lives = MAX_LIVES;
      State.level = 1;
      State.timer = TIMER_START;
      State.timerMax = TIMER_START;
      State.homeFilled = [false, false, false, false, false];
      State.homeBonus = [null, null, null, null, null];
      State.deathsThisRound = 0;
      State.phase = 'title';
      Particles.clear();
      State.levelCardT = 0;
      State.fly = null;
      State.flyNext = 0;
      State.justBeatBest = false;
      State.countdownT = 0;
      applyDifficulty(1);
      // Reset lastTimestamp so the first frame after restart isn't a giant dt.
      State.lastTimestamp = performance.now();
      // Re-prime loop. start() is safe to call here — it kicks a new RAF
      // chain even if one was running.
      this.loop(State.lastTimestamp);
    },

    rollHomeBonuses() {
      for (let i = 0; i < State.homeBonus.length; i++) {
        State.homeBonus[i] = rollBonus(State.level);
      }
    },

    tryStart() {
      if (State.phase === 'title' || State.phase === 'gameover') {
        State.phase = 'play';
        State.countdownT = 1.5;       // brief "ready?" before input unlocks
      } else if (State.phase === 'roundwin') {
        // Advance to next round (handled in loop after fanfare)
        State.level += 1;
        if (State.level > State.bestLevel) State.bestLevel = State.level;
        State.timerMax = Math.max(20, TIMER_START - (State.level - 1) * 3);
        State.timer = State.timerMax;
        State.homeFilled = [false, false, false, false, false];
        State.homeBonus = [null, null, null, null, null];
        State.deathsThisRound = 0;
        applyDifficulty(State.level);
        this.rollHomeBonuses();
        this.platforms = spawnPlatforms();
        Frog.reset();
        State.levelCardT = 1.4;       // show level card for 1.4s
        State.phase = 'play';
      }
    },

    togglePause() {
      if (State.phase === 'play') State.phase = 'paused';
      else if (State.phase === 'paused') State.phase = 'play';
    },

    moveFrog(dir) {
      if (State.phase !== 'play') return;
      if (State.countdownT > 0) return;       // input gated during ready
      // If mid-hop, ignore further input until arrival — prevents
      // chained-input speed exploit.
      if (Frog.hopT > 0) return;
      // Ignore input briefly after landing on a home slot — gives the
      // celebration particles time to read before the next move.
      if (this._homeLock > 0) return;
      let nr = Frog.row, nc = Frog.col;
      if (dir === 'up')    { nr -= 1; Frog.facing = 'up'; }
      if (dir === 'down')  { nr += 1; Frog.facing = 'down'; }
      if (dir === 'left')  { nc -= 1; Frog.facing = 'left'; }
      if (dir === 'right') { nc += 1; Frog.facing = 'right'; }
      // Clamp horizontally to canvas; vertical movement past the top is
      // allowed only if reaching a home slot.
      if (nc < 0 || nc >= COLS) return;
      if (nr < 0) return;
      if (nr > 12) return;
      // Award 10 points for forward progress.
      if (dir === 'up') State.score += 10;
      Frog.setCell(nr, nc);
      Frog.hopT = 1;        // hop animation duration timer
      Sfx.hop();
      // Floating "+10" above the frog for forward progress.
      if (dir === 'up') {
        Particles.floatScore(COL(nc) + TILE_W / 2, ROW(nr) + TILE / 2 - 14, '+10', '#39d353');
      }
      // Reaching a home slot
      if (nr === 1) {
        const idx = HOME_COLS.indexOf(nc);
        if (idx >= 0 && !State.homeFilled[idx]) {
          State.homeFilled[idx] = true;
          let bonus = 0;
          if (State.homeBonus[idx]) {
            bonus = BONUS_TYPES[State.homeBonus[idx]] || 0;
            State.homeBonus[idx] = null;
            Sfx.bonus();
          }
          State.score += 50 + bonus + Math.floor(State.timer) * TIME_BONUS;
          Sfx.home();
          // Frog is now safely parked in this slot.
          Frog.row = 1;
          Frog.col = nc;
          Frog.x = 0; Frog.y = 0;
          Frog.riding = null;
          // Sparkle + ripple at the slot position.
          Particles.emitSparkles(COL(nc) + TILE_W / 2, ROW(1) + TILE / 2);
          Particles.emitRipples(COL(nc) + TILE_W / 2, ROW(1) + TILE / 2,
                                bonus > 0 ? '#ffea00' : '#39d353');
          Particles.flash(bonus > 0 ? '#ffea00' : '#39d353', bonus > 0 ? 0.3 : 0.18);
          // Show the bonus points briefly above the slot.
          if (bonus > 0) {
            Particles.floatScore(COL(nc) + TILE_W / 2, ROW(1) - 6, '+' + bonus, '#ffea00');
          }
          // Check level completion
          if (State.homeFilled.every(Boolean)) {
            State.score += LEVEL_BONUS;
            // Perfect round bonus — 500 extra if no deaths this round.
            if (State.deathsThisRound === 0) {
              State.score += 500;
              Particles.floatScore(W / 2, ROW(2), '+500 PERFECT', '#ffea00');
            }
            State.phase = 'roundwin';
            Particles.emitConfetti(W / 2, ROW(1) + TILE / 2);
            Particles.flash('#ffffff', 0.35);
            Sfx.win();
          } else {
            // Brief celebration lock so the player can't immediately
            // jump again — let the sparkles read.
            this._homeLock = 0.25;
          }
        } else {
          // Slotted into a home column that's already filled or off a slot
          // in the wall area -> death.
          this.killFrog('wrongslot');
        }
      }
    },

    killFrog(reason) {
      if (State.phase !== 'play') return;
      State.phase = 'dying';
      // Death FX at the frog's position.
      const fx = COL(Frog.col) + Frog.x + TILE_W / 2;
      const fy = ROW(Frog.row) + Frog.y + TILE / 2;
      if (reason === 'drown' || reason === 'wrongslot' || reason === 'offscreen') {
        Particles.emitSplash(fx, fy, '#7ad7ff');
        Particles.flash('#0c2a55', 0.35);
        Sfx.drown();
      } else if (reason === 'timeout') {
        Particles.emitSplash(fx, fy, '#ffea00');
        Sfx.drown();
      } else {
        Particles.emitSplash(fx, fy, '#ff3a3a');
        Particles.flash('#ff3a3a', 0.25);
        Sfx.hit();
      }
      // Wait a beat then respawn or game over. Track the timer id so
      // a restart() during the dying window can cancel it.
      if (this._dyingTimer) clearTimeout(this._dyingTimer);
      this._dyingTimer = setTimeout(() => {
        this._dyingTimer = null;
        if (State.phase !== 'dying') return;       // restart happened
        State.lives -= 1;
        State.deathsThisRound += 1;
        if (State.lives <= 0) {
          State.phase = 'gameover';
          const isNewBest = State.score > State.highScore;
          if (isNewBest) State.highScore = State.score;
          State.justBeatBest = isNewBest;
          Sfx.gameOver();
        } else {
          Frog.reset();
          State.timer = State.timerMax;
          State.phase = 'play';
        }
      }, 600);
    },

    update(dt) {
      // Tick the brief home-celebration input lock.
      if (this._homeLock > 0) {
        this._homeLock -= dt;
        if (this._homeLock < 0) this._homeLock = 0;
      }
      // Tick level-title card.
      if (State.levelCardT > 0) {
        State.levelCardT -= dt;
        if (State.levelCardT < 0) State.levelCardT = 0;
      }
      // Tick ready-countdown. Input is gated until it reaches 0.
      if (State.countdownT > 0) {
        State.countdownT -= dt;
        if (State.countdownT < 0) State.countdownT = 0;
      }
      // Moving fly bonus. Spawns after a random delay on level 1+; flies
      // across a fixed row for ~6 s then despawns. If the frog is on the
      // same tile as the fly when it despawns, the frog gets 200 pts.
      State.flyNext -= dt;
      if (!State.fly && State.flyNext <= 0 && State.level >= 1) {
        // Pick a random safe row (start or median) so the fly is
        // collectible. Start is row 12, median is row 6.
        State.fly = {
          row: Math.random() < 0.5 ? 6 : 12,
          col: -1,                  // off-screen left
          speed: 90,
          t: 0,
          life: 7,
        };
        State.flyNext = 12 + Math.random() * 12;   // 12-24s until next
      }
      if (State.fly) {
        State.fly.t += dt;
        // Move across the canvas at a steady clip.
        State.fly.col += State.fly.speed * dt / TILE_W;
        if (State.fly.t > State.fly.life) State.fly = null;
        // Collision with frog: same cell and the fly is alive.
        else if (State.fly.col >= 0 && State.fly.col < COLS
                 && Math.round(State.fly.col) === Frog.col
                 && State.fly.row === Frog.row) {
          State.score += 200;
          Particles.emitSparkles(COL(Frog.col) + TILE_W / 2, ROW(Frog.row) + TILE / 2);
          Particles.floatScore(COL(Frog.col) + TILE_W / 2, ROW(Frog.row) - 4, '+200', '#ffea00');
          Sfx.bonus();
          State.fly = null;
        }
      }
      // Move platforms
      for (const p of this.platforms) {
        p.x += p.speed * dt;
        // Wrap horizontally. When a platform exits the canvas, respawn it
        // on the appropriate side.
        if (p.speed > 0 && p.x > W + 16) {
          p.x = -p.len - (Math.random() * (p.len * 0.5));
        } else if (p.speed < 0 && p.x + p.len < -16) {
          p.x = W + 16 + (Math.random() * (p.len * 0.5));
        }
        // Turtle dive phase: turtles briefly submerge. Implemented as
        // 'visible' boolean derived from a sin wave so it cycles.
        if (p.type === 'turtle') {
          p.phase += dt;
          // Period 4s; dive covers 0.6s of that.
          const t = (p.phase % 4);
          p.diving = (t > 2.6 && t < 3.2);
        }
      }

      // Handle frog riding a platform while on a non-safe row
      if (State.phase === 'play') {
        if (Frog.riding && Frog.row !== 1) {
          // frog drifts with platform
          Frog.riding.x += Frog.riding.speed * dt;
          // Wrap riding platform with the rest
          if (Frog.riding.speed > 0 && Frog.riding.x > W + 16) {
            Frog.riding.x = -Frog.riding.len - (Math.random() * Frog.riding.len * 0.5);
          } else if (Frog.riding.speed < 0 && Frog.riding.x + Frog.riding.len < -16) {
            Frog.riding.x = W + 16 + Math.random() * Frog.riding.len * 0.5;
          }
          // Off-screen while on a log/turtle. Frog's visual center is
          // riding.x + ridingOffset + TILE_W/2 — check that, not Frog.x
          // (which is the unused sub-tile offset slot).
          const visualX = Frog.riding.x + Frog.ridingOffset + TILE_W / 2;
          if (visualX < -TILE_W * 0.4 || visualX > W + TILE_W * 0.4) {
            this.killFrog('offscreen');
            return;
          }
        }
        // Hop animation timer
        if (Frog.hopT > 0) {
          Frog.hopT -= dt / 0.15;       // 150ms hop
          if (Frog.hopT < 0) Frog.hopT = 0;
        }
        // Detect riding — when frog is on a river row, it must overlap a log/turtle
        const cfg = ROW_CFG[Frog.row];
        if (cfg && cfg.kind === 'river' && Frog.row !== 1) {
          // Find a platform under the frog
          const fx = Frog.col * TILE_W + TILE_W / 2 + Frog.x;
          let bestPlatform = null;
          let bestDist = Infinity;
          for (const p of this.platforms) {
            if (p.row !== Frog.row) continue;
            if (p.diving) continue;
            if (fx >= p.x + 4 && fx <= p.x + p.len - 4) {
              const pc = p.x + p.len / 2;
              const d = Math.abs(pc - fx);
              if (d < bestDist) { bestDist = d; bestPlatform = p; }
            }
          }
          if (!bestPlatform) {
            this.killFrog('drown');
            return;
          }
          // First mount: capture the offset so the frog sticks to the
          // platform's relative position as it drifts.
          if (Frog.riding !== bestPlatform) {
            Frog.ridingOffset = fx - bestPlatform.x - TILE_W / 2;
          }
          Frog.riding = bestPlatform;
        } else {
          Frog.riding = null;
        }
        // Collision on road
        if (cfg && cfg.kind === 'road') {
          const fx = Frog.col * TILE_W + TILE_W / 2 + Frog.x;
          for (const p of this.platforms) {
            if (p.row !== Frog.row) continue;
            if (fx >= p.x + 4 && fx <= p.x + p.len - 4) {
              this.killFrog('hit');
              return;
            }
          }
        }
        // Timer countdown
        if (State.phase === 'play') {
          State.timer -= dt;
          // Tick sound on whole seconds
          if (State.timer <= 10 && State.timer > 0 && Math.floor(State.timer + dt) !== Math.floor(State.timer)) {
            Sfx.tick();
          }
          if (State.timer <= 0) {
            State.timer = 0;
            this.killFrog('timeout');
            return;
          }
        }
      }
    },

    loop(ts) {
      const dt = Math.min(0.05, (ts - State.lastTimestamp) / 1000 || 0);
      State.lastTimestamp = ts;
      // Drain any queued input direction at the start of a frame.
      // moveFrog() is a no-op when phase !== 'play' or mid-hop, so it's
      // safe to call every frame.
      if (Input.pendingDir && State.phase !== 'paused') {
        const d = Input.pendingDir;
        Input.pendingDir = null;
        this.moveFrog(d);
      }
      // Skip simulation while paused but keep rendering so the overlay
      // shows a frozen field.
      if (State.phase !== 'paused') {
        this.update(dt);
        Particles.update(dt);
      }
      Render.frame();
      State.rafId = requestAnimationFrame((t) => this.loop(t));
    },
  };

  // ---------- Layout / HiDPI sizing ----------
  // The game draws to a logical 480×640 surface (W × H). The Layout
  // module picks a CSS display size that fits the viewport while
  // preserving the 3:4 aspect ratio, and a backing-store size scaled by
  // devicePixelRatio so the result stays crisp on HiDPI screens. Touch
  // input is converted from CSS pixels to game coordinates via the
  // current scale factor.
  const Layout = {
    canvas: null,
    cssW: 480,       // current CSS display size
    cssH: 640,
    scale: 1,        // backing-store pixels per CSS pixel (= dpr)
    fit() {
      if (!this.canvas) return;
      // Available space: viewport minus padding the CSS already reserves
      // for the touch dpad. window.innerWidth/Height are in CSS pixels.
      const wrap = this.canvas.parentElement;
      const wrapStyle = wrap ? getComputedStyle(wrap) : null;
      // Reserve room for the dpad when it's displayed.
      const dpad = document.getElementById('touch-controls');
      const dpadVisible = dpad && getComputedStyle(dpad).display !== 'none';
      const dpadH = dpadVisible ? (dpad.offsetHeight + 12) : 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight - dpadH;
      // Reserve a tiny margin so the canvas doesn't kiss the edge.
      const maxW = Math.max(160, vw - 16);
      const maxH = Math.max(160, vh - 16);
      // Fit 3:4 inside the available rect.
      const aspect = W / H;
      let cssW = maxW, cssH = maxW / aspect;
      if (cssH > maxH) { cssH = maxH; cssW = maxH * aspect; }
      cssW = Math.max(160, Math.floor(cssW));
      cssH = Math.max(160, Math.floor(cssH));
      // Round to whole CSS pixels to keep the layout subpixel-clean.
      this.cssW = cssW;
      this.cssH = cssH;
      // HiDPI: scale backing store by devicePixelRatio, capped so
      // 4K monitors don't allocate a 50MB canvas.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.scale = dpr;
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
    },
    // Map a clientX/clientY (CSS pixels, relative to viewport) into
    // game logical coordinates (0..W, 0..H). Returns null if outside.
    clientToGame(clientX, clientY) {
      if (!this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * (W / rect.width);
      const y = (clientY - rect.top) * (H / rect.height);
      if (x < 0 || y < 0 || x > W || y > H) return null;
      return { x, y };
    },
  };

  // ---------- Render ----------
  const Render = {
    ctx: null,
    titleGrad: 0,
    init(canvas) {
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      Layout.canvas = canvas;
      Layout.fit();
    },
    // Frame entry point.
    frame() {
      const ctx = this.ctx;
      // First: clear the entire backing store (in raw backing-store
      // pixels, no transform). Without this, when the CSS display size
      // doesn't divide evenly into W/H, leftover pixels from a prior
      // resize would show through.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, Layout.canvas.width, Layout.canvas.height);
      // Switch to game-logical coords for the rest of the frame.
      ctx.setTransform(Layout.scale, 0, 0, Layout.scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Clear stale restart-button rect when not in gameover so a late
      // click doesn't hit-test against an old rect.
      if (State.phase !== 'gameover') State._restartBtn = null;
      this.drawHud();
      this.drawField();
      this.drawFrog();
      Particles.draw(ctx);
      // Level-title card slides up from the top of the field.
      if (State.levelCardT > 0) {
        const t = 1 - State.levelCardT / 1.4;
        const y = HUD_H + (1 - t) * TILE;
        ctx.fillStyle = '#0a1a0a';
        ctx.fillRect(0, y, W, TILE);
        ctx.strokeStyle = '#39d353';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, y, W, TILE);
        ctx.fillStyle = '#39d353';
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('LEVEL ' + State.level, W / 2, y + TILE / 2);
      }
      // Ready-countdown overlay: big number on the field so the player
      // has a beat to find the frog.
      if (State.countdownT > 0 && State.phase === 'play') {
        const n = Math.ceil(State.countdownT);
        const cy = ROW(Frog.row) + TILE / 2;
        const cx = COL(Frog.col) + TILE_W / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(cx - 32, cy - 32, 64, 64);
        ctx.strokeStyle = '#ffea00';
        ctx.lineWidth = 3;
        ctx.strokeRect(cx - 32, cy - 32, 64, 64);
        ctx.fillStyle = '#ffea00';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), cx, cy);
      }
      this.drawOverlays();
    },
    drawHud() {
      const ctx = this.ctx;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, HUD_H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      // 1UP column
      ctx.fillText('1UP', 8, HUD_H / 2 - 7);
      ctx.font = 'bold 14px monospace';
      ctx.fillText(String(State.score).padStart(6, '0'), 8, HUD_H / 2 + 6);
      // Level in middle-left
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#39d353';
      ctx.fillText('LV ' + State.level, 80, HUD_H / 2 - 7);
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#ffea00';
      ctx.fillText(String(Math.max(0, Math.ceil(State.timer))).padStart(3, '0'),
                   W / 2 + 12, HUD_H / 2 + 6);
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('TIME', W / 2 + 12, HUD_H / 2 - 7);
      // High score column
      ctx.textAlign = 'right';
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#aaa';
      ctx.fillText('HI', W - 8, HUD_H / 2 - 7);
      ctx.font = 'bold 14px monospace';
      ctx.fillText(String(State.highScore).padStart(6, '0'), W - 8, HUD_H / 2 + 6);
      // Lives as small frog icons in the upper-right corner.
      for (let i = 0; i < State.lives - 1; i++) {
        this.drawMiniFrog(W - 12 - i * 14, 10);
      }
      // Sound indicator: small speaker glyph + slash when muted.
      const sx = 130, sy = HUD_H / 2;
      ctx.fillStyle = Sfx.enabled ? '#fff' : '#888';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 3);
      ctx.lineTo(sx + 4, sy - 3);
      ctx.lineTo(sx + 8, sy - 7);
      ctx.lineTo(sx + 8, sy + 7);
      ctx.lineTo(sx + 4, sy + 3);
      ctx.lineTo(sx, sy + 3);
      ctx.closePath();
      ctx.fill();
      if (Sfx.enabled) {
        ctx.beginPath();
        ctx.arc(sx + 11, sy, 3, -0.6, 0.6);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#ff3a3a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 2, sy - 6);
        ctx.lineTo(sx + 12, sy + 6);
        ctx.stroke();
      }
    },
    drawMiniFrog(cx, cy) {
      const ctx = this.ctx;
      ctx.fillStyle = '#39d353';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 4, cy - 3, 2, 2);
      ctx.fillRect(cx + 2, cy - 3, 2, 2);
    },
    drawField() {
      const ctx = this.ctx;
      // Background bands per row kind
      for (let r = 0; r < ROW_CFG.length; r++) {
        const y = ROW(r);
        const cfg = ROW_CFG[r];
        let color = '#000';
        if (cfg.kind === 'road') color = '#222';
        if (cfg.kind === 'safe') color = '#1c4d1c';
        if (cfg.kind === 'river') color = '#0c2a55';
        if (cfg.kind === 'home') color = '#0c2a55';
        ctx.fillStyle = color;
        ctx.fillRect(0, y, W, TILE);
        // Animated water shimmer on river and home rows.
        if (cfg.kind === 'river' || cfg.kind === 'home') {
          const t = performance.now() / 1000;
          ctx.fillStyle = 'rgba(122, 215, 255, 0.18)';
          // Two layers of sine wave "ripples" — gives water a sense of life
          // without distracting from gameplay.
          for (let x = 0; x < W; x += 14) {
            const yo = Math.sin((x + t * 30) * 0.07) * 3;
            ctx.fillRect(x, y + TILE / 2 - 2 + yo, 8, 2);
          }
          for (let x = 7; x < W; x += 18) {
            const yo = Math.cos((x - t * 22) * 0.05) * 2;
            ctx.fillRect(x, y + TILE - 8 + yo, 5, 1);
          }
        }
        // Lane stripes
        if (cfg.kind === 'road') {
          ctx.fillStyle = '#fff';
          for (let x = 0; x < W; x += 32) {
            ctx.fillRect(x, y + TILE - 4, 16, 2);
          }
        }
        // Median decoration
        if (cfg.kind === 'safe' && r === 6) {
          ctx.fillStyle = '#39d353';
          for (let x = 0; x < W; x += 18) ctx.fillRect(x + 4, y + 8, 10, TILE - 16);
        }
      }
      // Home slots
      for (let i = 0; i < HOME_COLS.length; i++) {
        const col = HOME_COLS[i];
        const x = COL(col);
        const y = ROW(1);
        // Wall pattern (gap between slots)
        ctx.fillStyle = '#07204a';
        ctx.fillRect(0, y, W, TILE);
        // Slot pad
        if (State.homeFilled[i]) {
          ctx.fillStyle = '#39d353';
        } else {
          ctx.fillStyle = '#0a8';
          ctx.beginPath();
          ctx.ellipse(x + TILE_W / 2, y + TILE / 2, TILE_W / 3, TILE / 3, 0, 0, Math.PI * 2);
          ctx.fill();
          // Bonus item on top of the lily pad: frog or fly.
          if (State.homeBonus[i] === 'frog') {
            ctx.fillStyle = '#39d353';
            ctx.beginPath();
            ctx.ellipse(x + TILE_W / 2, y + TILE / 2, TILE_W / 4, TILE / 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(x + TILE_W / 2 - 2.5, y + TILE / 2 - 2, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x + TILE_W / 2 + 2.5, y + TILE / 2 - 2, 1.5, 0, Math.PI * 2); ctx.fill();
          } else if (State.homeBonus[i] === 'fly') {
            // Tiny purple fly with buzz animation — body hovers, wings flap.
            const t = performance.now() / 1000;
            const flyX = x + TILE_W / 2 + Math.sin(t * 8 + i) * 2;
            const flyY = y + TILE / 2 + Math.sin(t * 11 + i * 1.3) * 1.5;
            // Body
            ctx.fillStyle = '#cc66ff';
            ctx.fillRect(flyX - 4, flyY - 1, 8, 3);
            // Wings (flap on a fast sine)
            const flap = Math.abs(Math.sin(t * 30));
            ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + 0.5 * flap) + ')';
            ctx.beginPath();
            ctx.ellipse(flyX - 3, flyY - 3 - flap * 2, 3, 2 + flap * 1.5, -0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(flyX + 3, flyY - 3 - flap * 2, 3, 2 + flap * 1.5, 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillRect(x, y, TILE_W, TILE);
        // Outline
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, TILE_W - 4, TILE - 4);
      }
      // Draw platforms
      for (const p of Game.platforms) {
        this.drawPlatform(p);
      }
      // Moving fly bonus (drawn over platforms so it's always visible).
      if (State.fly) {
        const fx = State.fly.col * TILE_W + TILE_W / 2;
        const fy = ROW(State.fly.row) + TILE / 2;
        const t = performance.now() / 1000;
        const wob = Math.sin(t * 12) * 2;
        ctx.fillStyle = '#cc66ff';
        ctx.fillRect(fx - 4 + wob, fy - 1, 8, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        const flap = Math.abs(Math.sin(t * 30));
        ctx.beginPath();
        ctx.ellipse(fx - 3 + wob, fy - 3 - flap * 2, 3, 2 + flap * 1.5, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(fx + 3 + wob, fy - 3 - flap * 2, 3, 2 + flap * 1.5, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    drawPlatform(p) {
      const ctx = this.ctx;
      const y = ROW(p.row);
      // Skip if outside
      if (p.x + p.len < -8 || p.x > W + 8) return;
      const t = performance.now() / 1000;
      if (p.type === 'log') {
        // Slight vertical bob from the river current.
        const bob = Math.sin(t * 2 + p.x * 0.02) * 1;
        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(p.x, y + 4 + bob, p.len, TILE - 8);
        ctx.fillStyle = '#a0703a';
        ctx.fillRect(p.x, y + 4 + bob, p.len, 4);
        ctx.fillStyle = '#5a3a1b';
        // Plank lines
        for (let i = 0; i < p.len; i += 12) ctx.fillRect(p.x + i, y + 4 + bob, 1, TILE - 8);
        // Knots
        ctx.fillStyle = '#3b2310';
        for (let i = 8; i < p.len; i += 28) {
          ctx.beginPath(); ctx.arc(p.x + i, y + TILE / 2 + bob, 2, 0, Math.PI * 2); ctx.fill();
        }
      } else if (p.type === 'turtle') {
        if (p.diving) {
          ctx.fillStyle = 'rgba(20,40,80,0.9)';
          ctx.fillRect(p.x, y + TILE - 6, p.len, 4);
          return;
        }
        ctx.fillStyle = '#2a8a55';
        const headR = TILE / 3;
        // Slow leg-flutter animation: lift each head alternately.
        for (let i = 0; i < p.len; i += headR * 1.4) {
          const phase = Math.sin(t * 3 + i * 0.3) * 1.5;
          ctx.beginPath();
          ctx.ellipse(p.x + i + headR, y + TILE / 2 + phase, headR, TILE / 2 - 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Eyes
        ctx.fillStyle = '#fff';
        for (let i = 0; i < p.len; i += headR * 1.4) {
          ctx.beginPath(); ctx.arc(p.x + i + headR - 2.5, y + TILE / 2 - 2, 1.4, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(p.x + i + headR + 2.5, y + TILE / 2 - 2, 1.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#000';
        for (let i = 0; i < p.len; i += headR * 1.4) {
          ctx.fillRect(p.x + i + headR - 3, y + TILE / 2 - 2.5, 1, 1);
          ctx.fillRect(p.x + i + headR + 2, y + TILE / 2 - 2.5, 1, 1);
        }
      } else if (p.type === 'car') {
        ctx.fillStyle = '#d23';
        ctx.fillRect(p.x + 4, y + 6, p.len - 8, TILE - 12);
        ctx.fillStyle = '#ff7';
        ctx.fillRect(p.x + 8, y + 10, p.len - 16, 8);
        // Headlights / taillights
        ctx.fillStyle = '#fff';
        ctx.fillRect(p.x + p.len - 6, y + 10, 2, 4);
        ctx.fillStyle = '#f80';
        ctx.fillRect(p.x + 4, y + 10, 2, 4);
        // Wheels — spin offset based on time and speed so cars appear to roll.
        const wheelSpin = (t * Math.abs(p.speed) * 0.04) % 1;
        ctx.fillStyle = '#000';
        const wheelPositions = [p.x + 6, p.x + p.len - 14];
        for (const wx of wheelPositions) {
          ctx.fillRect(wx, y + TILE - 8, 8, 6);
          ctx.fillRect(wx, y + 2, 8, 6);
          // Spoke marker to make rotation visible.
          ctx.fillStyle = '#777';
          ctx.fillRect(wx + 4 - 1, y + TILE - 5, 2, 1 + Math.abs(Math.sin(wheelSpin * Math.PI * 2)));
          ctx.fillRect(wx + 4 - 1, y + 5, 2, 1 + Math.abs(Math.cos(wheelSpin * Math.PI * 2)));
          ctx.fillStyle = '#000';
        }
      } else if (p.type === 'truck') {
        ctx.fillStyle = '#39d';
        ctx.fillRect(p.x + 4, y + 4, p.len - 8, TILE - 8);
        ctx.fillStyle = '#cef';
        ctx.fillRect(p.x + p.len - 28, y + 8, 18, TILE - 16);
        // Tail-light
        ctx.fillStyle = '#f80';
        ctx.fillRect(p.x + 4, y + 10, 2, 4);
        ctx.fillStyle = '#000';
        const wheelSpin = (t * Math.abs(p.speed) * 0.04) % 1;
        const wheelPositions = [p.x + 8, p.x + p.len - 14];
        for (const wx of wheelPositions) {
          ctx.fillRect(wx, y + TILE - 8, 8, 6);
          ctx.fillRect(wx, y + 2, 8, 6);
          ctx.fillStyle = '#777';
          ctx.fillRect(wx + 4 - 1, y + TILE - 5, 2, 1 + Math.abs(Math.sin(wheelSpin * Math.PI * 2)));
          ctx.fillRect(wx + 4 - 1, y + 5, 2, 1 + Math.abs(Math.cos(wheelSpin * Math.PI * 2)));
          ctx.fillStyle = '#000';
        }
      }
    },
    drawFrog() {
      const ctx = this.ctx;
      // Compute pixel position. Frog rides platform if currently riding.
      let fx = COL(Frog.col) + Frog.x;
      let fy = ROW(Frog.row) + Frog.y;
      if (Frog.riding) {
        fx = Frog.riding.x + Frog.ridingOffset + TILE_W / 2;
        fy = ROW(Frog.row) + TILE / 2;
      }
      // Hop arc — sine pop with rotation toward facing direction.
      const hopLift = Frog.hopT > 0 ? -Math.sin(Frog.hopT * Math.PI) * 14 : 0;
      const cx = fx + TILE_W / 2;
      const cy = fy + TILE / 2 + hopLift;
      const facingRot =
        Frog.facing === 'left' ? -Math.PI / 2 :
        Frog.facing === 'right' ? Math.PI / 2 :
        Frog.facing === 'down' ? Math.PI : 0;
      // Shadow under the frog. Shrinks while mid-hop so the frog feels
      // like it's lifting off. When riding, draw a shadow on the
      // platform under the frog so the frog still has a visible
      // attachment point.
      if (Frog.riding) {
        // No shadow under the frog when riding (the platform itself
        // is its anchor). But draw a small wisp beneath the platform
        // hinting at the water below.
        const cfg = ROW_CFG[Frog.row];
        if (cfg && cfg.kind === 'river') {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.beginPath();
          ctx.ellipse(cx, ROW(Frog.row) + TILE - 2, TILE_W / 3, 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const shadowScale = Frog.hopT > 0 ? 0.4 + Frog.hopT * 0.6 : 1;
        const groundY = ROW(Frog.row) + TILE - 6;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(cx, groundY, (TILE_W / 3) * shadowScale, 3 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(cx, cy);
      if (Frog.hopT <= 0) ctx.rotate(facingRot);
      // Legs — two ovals behind the body
      ctx.fillStyle = '#1f8a36';
      ctx.beginPath();
      ctx.ellipse(-TILE_W / 3, TILE / 4 - 2, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse( TILE_W / 3, TILE / 4 - 2, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.fillStyle = '#39d353';
      ctx.beginPath();
      ctx.ellipse(0, 2, TILE_W / 2 - 5, TILE / 2 - 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Belly highlight
      ctx.fillStyle = '#7ad47a';
      ctx.beginPath();
      ctx.ellipse(0, 5, TILE_W / 2 - 8, TILE / 2 - 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes — two big white domes on top of head
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-5, -7, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 5, -7, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-5, -7, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 5, -7, 1.6, 0, Math.PI * 2); ctx.fill();
      // Mouth line (only when facing forward / down)
      if (Frog.facing !== 'up') {
        ctx.strokeStyle = '#1a4a1a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 2, 6, 0.15, Math.PI - 0.15);
        ctx.stroke();
      }
      ctx.restore();
    },
    drawOverlays() {
      const ctx = this.ctx;
      if (State.phase === 'title') {
        // Animated demo frog hops back and forth above the panel —
        // pure eye candy so the title screen feels alive.
        this.drawTitleDemoFrog();
        this.drawPanel('FROGGER', [
          'ARROWS / WASD TO MOVE',
          'SPACE TO START',
          'R RESTARTS  •  M MUTES',
          'P PAUSES  •  SHIFT+R CLEARS',
          '',
          'REACH THE LILY-PADS',
        ], 240);
      } else if (State.phase === 'gameover') {
        const lines = [];
        if (State.justBeatBest) lines.push('NEW BEST!');
        lines.push('SCORE ' + State.score);
        if (State.highScore > 0) lines.push('BEST ' + State.highScore);
        lines.push('REACHED LV ' + State.bestLevel);
        if (State.bestLevel > 1) lines.push('BEST LV ' + State.bestLevel);
        lines.push('');
        lines.push('PRESS SPACE OR TAP BUTTON');
        lines.push('SHIFT+R CLEARS BEST');
        this.drawPanel(State.justBeatBest ? 'NEW BEST!' : 'GAME OVER', lines);
        // Draw the actual RESTART button below the panel and remember
        // its rect so the canvas click handler can hit-test it.
        this.drawRestartButton();
      } else if (State.phase === 'roundwin') {
        this.drawPanel('LEVEL ' + State.level + ' CLEAR', [
          'BONUS +' + LEVEL_BONUS,
          '',
          'SPACE FOR LV ' + (State.level + 1),
        ]);
      } else if (State.phase === 'paused') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffea00';
        ctx.font = 'bold 36px monospace';
        ctx.fillText('PAUSED', W / 2, H / 2 - 16);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px monospace';
        ctx.fillText('PRESS P TO RESUME', W / 2, H / 2 + 20);
      }
    },
    drawPanel(title, lines, ph) {
      ph = ph || 220;
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      const px = 50, py = 200, pw = W - 100;
      ctx.fillStyle = '#0a1a0a';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#39d353';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);
      // Title
      ctx.fillStyle = '#39d353';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, W / 2, py + 50);
      // Body lines
      ctx.font = 'bold 14px monospace';
      let y = py + 100;
      for (const ln of lines) {
        if (!ln) { y += 12; continue; }
        ctx.fillStyle = '#fff';
        ctx.fillText(ln, W / 2, y);
        y += 22;
      }
      // Blink prompt
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        ctx.fillStyle = '#ffea00';
        ctx.fillText('— PRESS SPACE —', W / 2, py + ph - 22);
      }
    },
    drawRestartButton() {
      const ctx = this.ctx;
      const bw = 200, bh = 44;
      const bx = Math.floor((W - bw) / 2);
      const by = 200 + 220 + 16;       // panel bottom + gap
      // Button rect
      ctx.fillStyle = '#39d353';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#0a1a0a';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
      ctx.fillStyle = '#0a1a0a';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RESTART', bx + bw / 2, by + bh / 2);
      State._restartBtn = { x: bx, y: by, w: bw, h: bh };
    },
    drawTitleDemoFrog() {
      const ctx = this.ctx;
      const t = performance.now() / 1000;
      // Back-and-forth sine: position oscillates within the title band
      // above the panel.
      const x = 80 + (Math.sin(t * 1.6) * 0.5 + 0.5) * (W - 160);
      const y = 130 + Math.abs(Math.sin(t * 3.2)) * -14;
      const facing = (Math.cos(t * 1.6) > 0) ? 'right' : 'left';
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x, y + TILE / 2 - 6, 12, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.save();
      ctx.translate(x, y);
      const rot = facing === 'left' ? Math.PI : 0;
      ctx.rotate(rot);
      ctx.fillStyle = '#1f8a36';
      ctx.beginPath();
      ctx.ellipse(-TILE_W / 3, TILE / 4 - 2, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse( TILE_W / 3, TILE / 4 - 2, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#39d353';
      ctx.beginPath();
      ctx.ellipse(0, 2, TILE_W / 2 - 5, TILE / 2 - 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7ad47a';
      ctx.beginPath();
      ctx.ellipse(0, 5, TILE_W / 2 - 8, TILE / 2 - 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-5, -7, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 5, -7, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-5, -7, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 5, -7, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  };

// ---------- Boot ----------
  function boot() {
    const canvas = document.getElementById('game');
    Render.init(canvas);
    Input.bind(canvas);
    // Resize handler: re-fit the canvas whenever the viewport changes.
    // Listen for resize and orientationchange (some browsers fire one
    // and not the other).
    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        Layout.fit();
      });
    };
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);
    // visualViewport also fires when the URL bar appears/disappears on
    // mobile — keep the canvas matched to the visible area.
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', onResize);
    }
    // Load high score + best level
    try {
      const hs = parseInt(localStorage.getItem('frogger.high') || '0', 10);
      if (!Number.isNaN(hs)) State.highScore = hs;
      const bl = parseInt(localStorage.getItem('frogger.bestLevel') || '1', 10);
      if (!Number.isNaN(bl) && bl > 1) State.bestLevel = bl;
    } catch (e) { /* localStorage may be blocked */ }
    Game.start();
    // Persist high score + best level on page hide
    global.addEventListener('beforeunload', () => {
      try {
        localStorage.setItem('frogger.high', String(State.highScore));
        localStorage.setItem('frogger.bestLevel', String(State.bestLevel));
      } catch (e) {}
    });
  }
  global.addEventListener('DOMContentLoaded', boot);

  // Expose for debugging
  global.Game = Game;
  global.State = State;
  global.Frog = Frog;
  global.Input = Input;
  global.Layout = Layout;
  global.W = W;
  global.H = H;
})(window);