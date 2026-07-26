// audio.js — tiny Web Audio API synth. All sounds synthesized, no asset files.
// Provides short retro-style SFX for: hop, reach-water, splash (death),
// car-hit (death), home-success, level-complete, game-over, countdown tick.

(function (global) {
  'use strict';

  const Sfx = {
    ctx: null,
    enabled: true,
    master: null,
    // Single AudioContext, lazily created on first user gesture so browsers
    // don't block playback.
    _ensure() {
      if (this.ctx) return;
      const Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    },
    // Browsers may suspend the context if it was created before any user
    // gesture. Call resume() from a click/keydown handler to unlock audio.
    resume() {
      this._ensure();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },
    setEnabled(on) {
      this.enabled = !!on;
      if (this.master) this.master.gain.value = this.enabled ? 0.35 : 0;
    },
    // Internal: schedule a short tone with envelope.
    _tone(opts) {
      if (!this.enabled) return;
      this._ensure();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = opts.type || 'square';
      osc.frequency.setValueAtTime(opts.freq || 440, now);
      if (opts.sweepTo) {
        osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, now + (opts.dur || 0.1));
      }
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(opts.vol || 0.3, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (opts.dur || 0.1));
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + (opts.dur || 0.1) + 0.02);
    },
    // Internal: schedule a noise burst (good for splashes/hits).
    _noise(opts) {
      if (!this.enabled) return;
      this._ensure();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const dur = opts.dur || 0.15;
      const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = opts.filter || 'lowpass';
      filter.frequency.value = opts.cutoff || 1000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(opts.vol || 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(now);
      src.stop(now + dur);
    },
    hop()        { this._tone({ type: 'square',   freq: 660, sweepTo: 880, dur: 0.06, vol: 0.18 }); },
    drown()      { this._noise({ dur: 0.35, cutoff: 1200, vol: 0.4 }); },
    hit()        { this._noise({ dur: 0.18, cutoff: 400,  vol: 0.5 });
                   this._tone({ type: 'sawtooth', freq: 220, sweepTo: 80, dur: 0.18, vol: 0.3 }); },
    home()       { // ascending three-note arpeggio
      this._tone({ type: 'square', freq: 660, dur: 0.08, vol: 0.25 });
      setTimeout(() => this._tone({ type: 'square', freq: 880, dur: 0.08, vol: 0.25 }), 70);
      setTimeout(() => this._tone({ type: 'square', freq: 1320, dur: 0.14, vol: 0.3 }), 140);
    },
    win()        { // longer victory fanfare
      this._tone({ type: 'square', freq: 523, dur: 0.12, vol: 0.25 });
      setTimeout(() => this._tone({ type: 'square', freq: 659, dur: 0.12, vol: 0.25 }), 110);
      setTimeout(() => this._tone({ type: 'square', freq: 784, dur: 0.12, vol: 0.25 }), 220);
      setTimeout(() => this._tone({ type: 'square', freq: 1046, dur: 0.24, vol: 0.3 }), 330);
    },
    gameOver()   { // descending sad trombone
      this._tone({ type: 'sawtooth', freq: 392, dur: 0.18, vol: 0.25 });
      setTimeout(() => this._tone({ type: 'sawtooth', freq: 311, dur: 0.18, vol: 0.25 }), 180);
      setTimeout(() => this._tone({ type: 'sawtooth', freq: 247, dur: 0.18, vol: 0.25 }), 360);
      setTimeout(() => this._tone({ type: 'sawtooth', freq: 196, dur: 0.36, vol: 0.3 }), 540);
    },
    tick()       { this._tone({ type: 'square', freq: 1200, dur: 0.04, vol: 0.12 }); },
    bonus()      { this._tone({ type: 'triangle', freq: 1400, dur: 0.05, vol: 0.2 }); },
  };

  global.Sfx = Sfx;
})(window);