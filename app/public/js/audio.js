// public/js/audio.js — a procedural sound engine. Every sound is synthesized
// at runtime with oscillators, noise buffers, and envelopes — there are no
// audio files anywhere in this project, so there's no licensing question and
// no asset to fetch. Volume/mute persist in localStorage; nothing plays
// before a user gesture unlocks the AudioContext (browsers block autoplay).
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem('wgc_muted') === '1';
    this.volume = Number(localStorage.getItem('wgc_volume') ?? 0.7);
    this._noiseBuffer = null;
    this._ambientNodes = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('wgc_muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('wgc_volume', String(this.volume));
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  get t() { return this.ctx.currentTime; }

  noiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const n = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
    return buf;
  }

  // --- primitives -----------------------------------------------------
  tone(freq, { at = 0, dur = 0.15, type = 'sine', gain = 0.3, glideTo = null, filterHz = null } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + at;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (filterHz) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = filterHz;
      osc.connect(f); node = f;
    }
    node.connect(g).connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  noiseHit({ at = 0, dur = 0.08, gain = 0.5, filterHz = 1200, type = 'lowpass' } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterHz;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // A short metallic "clink" — two detuned square/triangle partials with a
  // fast decay, used for coins and credit landings.
  coinClink({ at = 0, pitch = 1 } = {}) {
    this.tone(1400 * pitch, { at, dur: 0.12, type: 'square', gain: 0.06, filterHz: 6000 });
    this.tone(2100 * pitch, { at: at + 0.01, dur: 0.09, type: 'triangle', gain: 0.05, filterHz: 8000 });
  }

  // --- named events used by play.js -----------------------------------
  click() { this.noiseHit({ dur: 0.03, gain: 0.25, filterHz: 3000 }); }

  spinStart() {
    for (let i = 0; i < 5; i++) this.noiseHit({ at: i * 0.09, dur: 0.05, gain: 0.22, filterHz: 900 + i * 60 });
  }

  reelStop(index) {
    const base = 90 + index * 6;
    this.noiseHit({ dur: 0.09, gain: 0.4, filterHz: base * 6 });
    this.tone(base, { dur: 0.12, type: 'triangle', gain: 0.18, filterHz: 400 });
  }

  anticipationTick() {
    this.tone(660, { dur: 0.06, type: 'square', gain: 0.06, filterHz: 3000 });
  }

  lineWin(tier = 0) {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C — a plain major arpeggio, not borrowed from any game
    const n = Math.min(notes.length, 2 + tier);
    for (let i = 0; i < n; i++) this.tone(notes[i], { at: i * 0.06, dur: 0.22, type: 'triangle', gain: 0.14 });
  }

  coinCollect() { this.coinClink({ pitch: 0.9 + Math.random() * 0.3 }); }

  chargeHit() {
    this.tone(220, { dur: 0.5, type: 'sawtooth', gain: 0.12, glideTo: 440, filterHz: 2000 });
    for (let i = 0; i < 6; i++) this.coinClink({ at: 0.05 + i * 0.045, pitch: 1 + i * 0.08 });
  }

  silverReveal() {
    this.tone(880, { dur: 0.3, type: 'sine', gain: 0.1, glideTo: 1320 });
    this.tone(1320, { at: 0.05, dur: 0.25, type: 'sine', gain: 0.08 });
  }

  // An inharmonic two-oscillator hit approximates a struck bell/cowbell —
  // used to mark feature triggers, distinct from the melodic win chimes.
  cowbell({ at = 0, gain = 0.18 } = {}) {
    this.tone(587, { at, dur: 0.25, type: 'square', gain: gain * 0.6, filterHz: 4000 });
    this.tone(845, { at, dur: 0.2, type: 'square', gain: gain * 0.5, filterHz: 5000 });
  }

  featureTrigger() {
    this.tone(200, { dur: 0.6, type: 'sawtooth', gain: 0.1, glideTo: 900, filterHz: 3000 });
    this.cowbell({ at: 0.3, gain: 0.22 });
    this.cowbell({ at: 0.45, gain: 0.18 });
  }

  respinReset() { this.cowbell({ gain: 0.14 }); }

  grand() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.tone(f, { at: i * 0.11, dur: 0.7, type: 'sawtooth', gain: 0.12, filterHz: 2600 }));
    for (let i = 0; i < 14; i++) this.coinClink({ at: 0.3 + i * 0.07, pitch: 0.8 + Math.random() * 0.7 });
  }

  // A sustained "glowing" pad: a slow vibrato (frequency LFO) under a long
  // note gives a shimmering, held-light quality distinct from the short
  // plucky tones used everywhere else — reserved for the biggest wins.
  shimmer({ at = 0, freq = 880, dur = 1.6, gain = 0.09 } = {}) {
    if (!this.ctx) return;
    const t0 = this.t + at;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t0);
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 5.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = freq * 0.01;
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0); lfo.start(t0);
    osc.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
  }

  // A proper short musical phrase per win tier — an ascending run resolving
  // into a chord, not just a block chord — so bigger wins feel like an actual
  // musical moment rather than a louder version of the same beep.
  winBanner(tier) {
    // tier: 'nice' | 'big' | 'mega' | 'jackpot'
    if (tier === 'nice') {
      [659.25, 783.99].forEach((f, i) => this.tone(f, { at: i * 0.07, dur: 0.35, type: 'triangle', gain: 0.13 }));
      this.coinClink({ at: 0.12 });
      return;
    }
    if (tier === 'big') {
      const run = [523.25, 659.25, 783.99];
      run.forEach((f, i) => this.tone(f, { at: i * 0.08, dur: 0.3, type: 'triangle', gain: 0.13 }));
      [659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, { at: 0.3, dur: 0.55, type: 'sawtooth', gain: 0.09, filterHz: 2600 }));
      for (let i = 0; i < 5; i++) this.coinClink({ at: 0.32 + i * 0.06, pitch: 0.9 + Math.random() * 0.4 });
      return;
    }
    if (tier === 'mega') {
      const run = [392, 493.88, 587.33, 659.25, 783.99];
      run.forEach((f, i) => this.tone(f, { at: i * 0.07, dur: 0.28, type: 'triangle', gain: 0.14 }));
      [523.25, 659.25, 783.99, 987.77].forEach((f) => this.tone(f, { at: 0.42, dur: 0.9, type: 'sawtooth', gain: 0.09, filterHz: 2800 }));
      this.shimmer({ at: 0.42, freq: 1567.98, dur: 1.3, gain: 0.07 });
      for (let i = 0; i < 12; i++) this.coinClink({ at: 0.5 + i * 0.055, pitch: 0.8 + Math.random() * 0.6 });
      return;
    }
    // jackpot: full ascending fanfare -> brass-stab chord -> descending
    // flourish -> sustained shimmer, with a long coin shower under it all.
    const run = [329.63, 392, 493.88, 587.33, 659.25, 783.99];
    run.forEach((f, i) => this.tone(f, { at: i * 0.065, dur: 0.26, type: 'triangle', gain: 0.15 }));
    [392, 493.88, 587.33, 783.99, 987.77].forEach((f) => {
      this.tone(f, { at: 0.42, dur: 1.0, type: 'sawtooth', gain: 0.1, filterHz: 3000 });
      this.tone(f, { at: 0.42, dur: 1.0, type: 'square', gain: 0.045, filterHz: 2200 });
    });
    const flourish = [987.77, 880, 783.99, 659.25, 587.33];
    flourish.forEach((f, i) => this.tone(f, { at: 0.95 + i * 0.09, dur: 0.35, type: 'triangle', gain: 0.12 }));
    this.shimmer({ at: 0.42, freq: 1975.5, dur: 1.8, gain: 0.08 });
    for (let i = 0; i < 20; i++) this.coinClink({ at: 0.5 + i * 0.05, pitch: 0.75 + Math.random() * 0.7 });
  }

  balanceCountTick() { this.tone(1800, { dur: 0.03, type: 'square', gain: 0.03, filterHz: 5000 }); }

  error() { this.tone(180, { dur: 0.22, type: 'square', gain: 0.12, glideTo: 90 }); }
}

export const sound = new SoundEngine();

export function wireAudioControls(root = document) {
  const muteBtn = root.querySelector('#audioMuteBtn');
  const volSlider = root.querySelector('#audioVolume');
  if (volSlider) volSlider.value = sound.volume;
  const paint = () => { if (muteBtn) muteBtn.textContent = sound.muted ? '🔇' : '🔊'; };
  paint();
  const unlockOnce = () => { sound.unlock(); document.removeEventListener('pointerdown', unlockOnce); };
  document.addEventListener('pointerdown', unlockOnce, { once: true });
  muteBtn?.addEventListener('click', () => { sound.unlock(); sound.setMuted(!sound.muted); paint(); });
  volSlider?.addEventListener('input', () => { sound.unlock(); sound.setVolume(Number(volSlider.value)); });
}
