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

  // Home slot columns — 5 evenly spaced, leaving wall columns on edges.
  const HOME_COLS = [1, 3, 5, 7, 9];
  const FROG_START = { row: 12, col: 5 };  // bottom-center-ish
  const MAX_LIVES = 5;
  const TIMER_START = 60;   // seconds per run
  const TIME_BONUS = 10;    // points per second remaining on success
  const LEVEL_BONUS = 100;  // bonus for completing all 5 home slots

  // ---------- Input ----------
  const Input = {
    pendingDir: null,   // queued direction (one-step queue so quick taps register)
    bind(canvas) {
      const unlock = () => Sfx.resume();
      const onKey = (e) => {
        const k = e.key;
        const map = {
          ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
          w: 'up', s: 'down', a: 'left', d: 'right',
          W: 'up', S: 'down', A: 'left', D: 'right',
        };
        if (k in map) { this.pendingDir = map[k]; unlock(); e.preventDefault(); }
        if (k === ' ' || k === 'Enter') { Game.tryStart(); unlock(); e.preventDefault(); }
        if (k === 'r' || k === 'R') { Game.restart(); unlock(); e.preventDefault(); }
        if (k === 'm' || k === 'M') { Sfx.setEnabled(!Sfx.enabled); }
      };
      global.addEventListener('keydown', onKey, { passive: false });
      // Touch buttons
      document.querySelectorAll('.tc-btn').forEach((btn) => {
        const dir = btn.getAttribute('data-dir');
        const fire = (ev) => { ev.preventDefault(); unlock(); this.pendingDir = dir; };
        btn.addEventListener('touchstart', fire, { passive: false });
        btn.addEventListener('mousedown',  fire);
      });
      // Tap-on-canvas as start/restart convenience.
      canvas.addEventListener('touchstart', (ev) => { unlock(); Game.tryStart(); }, { passive: true });
      canvas.addEventListener('mousedown',  () => { unlock(); Game.tryStart(); });
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
    lastTimestamp: 0,
    rafId: null,
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
      this.platforms = spawnPlatforms();
      Frog.reset();
      this.loop(performance.now());
    },

    restart() {
      // Cancel any in-flight animations to prevent double-speed loops.
      if (State.rafId) cancelAnimationFrame(State.rafId);
      State.rafId = null;
      this.platforms = spawnPlatforms();
      Frog.reset();
      State.score = 0;
      State.lives = MAX_LIVES;
      State.level = 1;
      State.timer = TIMER_START;
      State.timerMax = TIMER_START;
      State.homeFilled = [false, false, false, false, false];
      State.phase = 'title';
      // Reset lastTimestamp so the first frame after restart isn't a giant dt.
      State.lastTimestamp = performance.now();
      // Re-prime loop. start() is safe to call here — it kicks a new RAF
      // chain even if one was running.
      this.loop(State.lastTimestamp);
    },

    tryStart() {
      if (State.phase === 'title' || State.phase === 'gameover') {
        State.phase = 'play';
      } else if (State.phase === 'roundwin') {
        // Advance to next round (handled in loop after fanfare)
        State.level += 1;
        State.timerMax = Math.max(20, TIMER_START - (State.level - 1) * 3);
        State.timer = State.timerMax;
        State.homeFilled = [false, false, false, false, false];
        this.platforms = spawnPlatforms();
        Frog.reset();
        State.phase = 'play';
      }
    },

    moveFrog(dir) {
      if (State.phase !== 'play') return;
      // If mid-hop, ignore further input until arrival — prevents
      // chained-input speed exploit.
      if (Frog.hopT > 0) return;
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
      // Reaching a home slot
      if (nr === 1) {
        const idx = HOME_COLS.indexOf(nc);
        if (idx >= 0 && !State.homeFilled[idx]) {
          State.homeFilled[idx] = true;
          State.score += 50 + State.timer * TIME_BONUS;
          Sfx.home();
          // Frog is now safely parked in this slot.
          Frog.row = 1;
          Frog.col = nc;
          Frog.x = 0; Frog.y = 0;
          Frog.riding = null;
          // Check level completion
          if (State.homeFilled.every(Boolean)) {
            State.score += LEVEL_BONUS;
            State.phase = 'roundwin';
            Sfx.win();
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
      if (reason === 'drown' || reason === 'wrongslot' || reason === 'offscreen') {
        Sfx.drown();
      } else {
        Sfx.hit();
      }
      // Wait a beat then respawn or game over.
      setTimeout(() => {
        State.lives -= 1;
        if (State.lives <= 0) {
          State.phase = 'gameover';
          if (State.score > State.highScore) State.highScore = State.score;
          Sfx.gameOver();
        } else {
          Frog.reset();
          State.timer = State.timerMax;
          State.phase = 'play';
        }
      }, 600);
    },

    update(dt) {
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
          // Off-screen while on a log/turtle
          if (Frog.x < -TILE_W * 0.5 || Frog.x > W - TILE_W * 0.5) {
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
      if (Input.pendingDir) {
        const d = Input.pendingDir;
        Input.pendingDir = null;
        this.moveFrog(d);
      }
      this.update(dt);
      Render.frame();
      State.rafId = requestAnimationFrame((t) => this.loop(t));
    },
  };

  // ---------- Render ----------
  const Render = {
    ctx: null,
    titleGrad: 0,
    init(canvas) {
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
    },
    // Frame entry point.
    frame() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, W, H);
      this.drawHud();
      this.drawField();
      this.drawFrog();
      this.drawOverlays();
    },
    drawHud() {
      const ctx = this.ctx;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, HUD_H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('SCORE ' + String(State.score).padStart(5, '0'), 8, HUD_H / 2);
      ctx.textAlign = 'center';
      ctx.fillText('TIME ' + Math.ceil(State.timer), W / 2, HUD_H / 2);
      ctx.textAlign = 'right';
      ctx.fillText('LV ' + State.level, W - 100, HUD_H / 2);
      // Lives as small frog icons
      for (let i = 0; i < State.lives - 1; i++) {
        this.drawMiniFrog(W - 24 - i * 18, HUD_H / 2);
      }
      // High score
      ctx.textAlign = 'left';
      ctx.fillStyle = '#aaa';
      ctx.fillText('HI ' + String(State.highScore).padStart(5, '0'), 130, HUD_H / 2);
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
    },
    drawPlatform(p) {
      const ctx = this.ctx;
      const y = ROW(p.row);
      // Skip if outside
      if (p.x + p.len < -8 || p.x > W + 8) return;
      if (p.type === 'log') {
        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(p.x, y + 4, p.len, TILE - 8);
        ctx.fillStyle = '#a0703a';
        ctx.fillRect(p.x, y + 4, p.len, 4);
        ctx.fillStyle = '#5a3a1b';
        // Plank lines
        for (let i = 0; i < p.len; i += 12) ctx.fillRect(p.x + i, y + 4, 1, TILE - 8);
      } else if (p.type === 'turtle') {
        if (p.diving) {
          ctx.fillStyle = 'rgba(20,40,80,0.9)';
          ctx.fillRect(p.x, y + TILE - 6, p.len, 4);
          return;
        }
        ctx.fillStyle = '#2a8a55';
        const headR = TILE / 3;
        for (let i = 0; i < p.len; i += headR * 1.4) {
          ctx.beginPath();
          ctx.ellipse(p.x + i + headR, y + TILE / 2, headR, TILE / 2 - 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#000';
        for (let i = 0; i < p.len; i += headR * 1.4) {
          ctx.fillRect(p.x + i + headR - 2, y + TILE / 2 - 2, 4, 4);
        }
      } else if (p.type === 'car') {
        ctx.fillStyle = '#d23';
        ctx.fillRect(p.x + 4, y + 6, p.len - 8, TILE - 12);
        ctx.fillStyle = '#ff7';
        ctx.fillRect(p.x + 8, y + 10, p.len - 16, 8);
        // Wheels
        ctx.fillStyle = '#000';
        ctx.fillRect(p.x + 6, y + TILE - 8, 8, 6);
        ctx.fillRect(p.x + p.len - 14, y + TILE - 8, 8, 6);
        ctx.fillRect(p.x + 6, y + 2, 8, 6);
        ctx.fillRect(p.x + p.len - 14, y + 2, 8, 6);
      } else if (p.type === 'truck') {
        ctx.fillStyle = '#39d';
        ctx.fillRect(p.x + 4, y + 4, p.len - 8, TILE - 8);
        ctx.fillStyle = '#cef';
        ctx.fillRect(p.x + p.len - 28, y + 8, 18, TILE - 16);
        ctx.fillStyle = '#000';
        ctx.fillRect(p.x + 8, y + TILE - 8, 8, 6);
        ctx.fillRect(p.x + p.len - 14, y + TILE - 8, 8, 6);
        ctx.fillRect(p.x + 8, y + 2, 8, 6);
        ctx.fillRect(p.x + p.len - 14, y + 2, 8, 6);
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
      // Hop arc
      const hopLift = Frog.hopT > 0 ? -Math.sin(Frog.hopT * Math.PI) * 12 : 0;
      const cx = fx + TILE_W / 2;
      const cy = fy + TILE / 2 + hopLift;
      // Body
      ctx.fillStyle = '#39d353';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, TILE_W / 2 - 4, TILE / 2 - 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes (white)
      ctx.fillStyle = '#fff';
      const ex = Frog.facing === 'left' ? -2 : Frog.facing === 'right' ? 2 : 0;
      ctx.beginPath(); ctx.arc(cx - 5 + ex, cy - 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 5 + ex, cy - 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(cx - 5 + ex, cy - 4, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 5 + ex, cy - 4, 1.5, 0, Math.PI * 2); ctx.fill();
    },
    drawOverlays() {
      const ctx = this.ctx;
      if (State.phase === 'title') {
        this.drawPanel('FROGGER', 'Arrow keys / WASD to move. Space to start. R restarts. M mutes.');
      } else if (State.phase === 'gameover') {
        this.drawPanel('GAME OVER', 'Final score: ' + State.score + '\nClick or press Space to play again.');
      } else if (State.phase === 'roundwin') {
        this.drawPanel('LEVEL ' + State.level + ' COMPLETE', 'Bonus +' + LEVEL_BONUS + '\nClick or press Space for level ' + (State.level + 1));
      }
    },
    drawPanel(title, body) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      const px = 60, py = 220, pw = W - 120, ph = 200;
      ctx.fillStyle = '#111';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#39d353';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);
      ctx.fillStyle = '#39d353';
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(title, W / 2, py + 60);
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], W / 2, py + 110 + i * 22);
      }
      // Blink prompt
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        ctx.fillStyle = '#ffea00';
        ctx.fillText('— PRESS SPACE / TAP —', W / 2, py + ph - 22);
      }
    },
  };

  // ---------- Boot ----------
  function boot() {
    const canvas = document.getElementById('game');
    canvas.width = W;
    canvas.height = H;
    Render.init(canvas);
    Input.bind(canvas);
    // Load high score
    try {
      const hs = parseInt(localStorage.getItem('frogger.high') || '0', 10);
      if (!Number.isNaN(hs)) State.highScore = hs;
    } catch (e) { /* localStorage may be blocked */ }
    Game.start();
    // Persist high score on page hide
    global.addEventListener('beforeunload', () => {
      try { localStorage.setItem('frogger.high', String(State.highScore)); } catch (e) {}
    });
  }
  global.addEventListener('DOMContentLoaded', boot);

  // Expose for debugging
  global.Game = Game;
  global.State = State;
  global.Frog = Frog;
  global.Input = Input;
})(window);