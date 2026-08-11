// pinball/js/audio.js - every sound in the game, synthesised at runtime. No files, no fetches, no
// service-worker entries beyond this one module.
//
// WHY SYNTHESIS RATHER THAN SAMPLES. A pinball table is almost nothing but percussion: a solenoid
// thud, a bell, a spinner's ticks, a metal clink. All of those are a short envelope over an
// oscillator or a noise burst, which is a few lines each, and doing it this way keeps the whole
// game inside the hub's "no build step, no dependencies, no assets" shape while making the two
// things that actually matter free: EVERY sound can react to how hard the ball hit (velocity is a
// parameter, not a fixed sample), and a spinner can tick sixty times without sixty HTTP requests.
//
// The context is created on the first real user gesture, never at import: an AudioContext built
// before a gesture starts suspended and every browser logs about it.

const MAX_VOICES = 24;      // hard cap: multiball plus a spinner rip can otherwise stack into mush

export class Sfx {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.voices = 0;
    this._noise = null;
  }

  /** Call from a real user gesture (pointerdown/keydown). Safe to call repeatedly. */
  resume() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (err) {
      console.warn('[pinball] audio unavailable', err);
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
    if (on) this.resume();
  }

  close() {
    try { if (this.ctx) this.ctx.close(); } catch { /* already gone */ }
    this.ctx = null; this.master = null; this._noise = null;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  /** One short white-noise buffer, reused by every percussive sound. */
  _noiseBuf() {
    if (this._noise) return this._noise;
    const n = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  _ready() {
    if (!this.enabled || !this.ctx || this.voices >= MAX_VOICES) return false;
    return true;
  }

  _track(node, stop) {
    this.voices++;
    node.onended = () => { this.voices--; };
    if (stop != null) node.stop(stop);
  }

  /** A pitched blip: `type` waveform, gliding from f0 to f1 over `dur`. */
  tone(f0, f1, dur, gain = 0.25, type = 'sine', delay = 0) {
    if (!this._ready()) return;
    const t = this.t + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    this._track(o, t + dur + 0.02);
  }

  /** A noise burst through a band-pass: every mechanical knock in the game. */
  noise(freq, q, dur, gain = 0.3, sweepTo = 0) {
    if (!this._ready()) return;
    const t = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    this._track(src, t + dur + 0.02);
  }

  // --- the table's voice ------------------------------------------------------------------------
  // Each of these is one line of intent. `v` is a 0..1 intensity taken from the real contact speed,
  // which is the entire reason a hard ricochet and a dribble do not sound identical.

  flip() { this.noise(1800, 1.6, 0.05, 0.22, 700); this.tone(150, 60, 0.06, 0.16, 'square'); }
  clink(v = 0.5) { this.noise(2600 + 1800 * v, 5, 0.05, 0.05 + 0.1 * v, 1500); }
  thock(v = 0.5) { this.noise(900, 2, 0.06, 0.08 + 0.12 * v, 320); }
  bumper(v = 0.5) {
    this.tone(660 + 200 * v, 1500, 0.11, 0.24, 'triangle');
    this.noise(2400, 3, 0.07, 0.16, 900);
  }
  sling() { this.noise(1400, 2.5, 0.07, 0.24, 420); this.tone(300, 120, 0.07, 0.12, 'square'); }
  target() { this.noise(700, 4, 0.09, 0.26, 240); this.tone(520, 300, 0.09, 0.14, 'square'); }
  bank() { for (let i = 0; i < 4; i++) this.tone(520 + i * 160, 520 + i * 160, 0.1, 0.16, 'square', i * 0.05); }
  spinner(n = 1) {
    // One click per rip, tightening in pitch as it slows: the sound IS the score here.
    const k = Math.min(10, n);
    for (let i = 0; i < k; i++) this.tone(1400 - i * 60, 1400 - i * 60, 0.03, 0.11, 'square', i * 0.045);
  }
  lane() { this.tone(900, 1400, 0.08, 0.16, 'triangle'); }
  laneSet() { [0, 4, 7, 12].forEach((s, i) => this.tone(440 * 2 ** (s / 12), 440 * 2 ** (s / 12), 0.16, 0.15, 'triangle', i * 0.06)); }
  ramp() { this.noise(400, 1.2, 0.34, 0.2, 2600); this.tone(320, 900, 0.3, 0.1, 'sine'); }
  rampReject() { this.noise(500, 2, 0.14, 0.16, 160); }
  orbit(combo = 1) { this.tone(300 * combo ** 0.25, 1200 * combo ** 0.25, 0.26, 0.18, 'sawtooth'); }
  scoop() { this.tone(220, 90, 0.16, 0.2, 'square'); this.noise(500, 2, 0.1, 0.14, 180); }
  kickout() { this.noise(1100, 1.5, 0.08, 0.3, 300); this.tone(180, 70, 0.09, 0.2, 'square'); }
  lock() { [0, 5, 9].forEach((s, i) => this.tone(330 * 2 ** (s / 12), 330 * 2 ** (s / 12), 0.2, 0.16, 'triangle', i * 0.08)); }
  launch(p = 1) { this.tone(120, 500 + 500 * p, 0.22, 0.2, 'sawtooth'); this.noise(600, 1, 0.2, 0.12, 2200); }
  jackpot(n = 1) {
    const base = 523.25 * 2 ** (Math.min(6, n - 1) / 12);
    [0, 4, 7, 12].forEach((s, i) => this.tone(base * 2 ** (s / 12), base * 2 ** (s / 12), 0.26, 0.18, 'square', i * 0.045));
  }
  superJackpot() {
    [0, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), 523.25 * 2 ** (s / 12), 0.5, 0.19, 'square', i * 0.06));
    this.noise(3000, 2, 0.6, 0.12, 400);
  }
  multiball() {
    [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) =>
      this.tone(392 * 2 ** (s / 12), 392 * 2 ** (s / 12), 0.22, 0.18, 'square', i * 0.09));
  }
  missionStart() { [0, 3, 7, 10].forEach((s, i) => this.tone(294 * 2 ** (s / 12), 294 * 2 ** (s / 12), 0.3, 0.16, 'sawtooth', i * 0.1)); }
  missionDone() { [0, 5, 12, 17, 24].forEach((s, i) => this.tone(349 * 2 ** (s / 12), 349 * 2 ** (s / 12), 0.34, 0.17, 'square', i * 0.08)); }
  missionFail() { this.tone(300, 90, 0.5, 0.16, 'sawtooth'); }
  drain() { this.tone(260, 70, 0.45, 0.18, 'sine'); this.noise(300, 1.5, 0.3, 0.1, 90); }
  ballSave() { [0, 7, 12].forEach((s, i) => this.tone(440 * 2 ** (s / 12), 440 * 2 ** (s / 12), 0.2, 0.16, 'triangle', i * 0.07)); }
  extraBall() { [0, 4, 7, 12, 19].forEach((s, i) => this.tone(523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.28, 0.17, 'triangle', i * 0.07)); }
  tilt() { this.tone(90, 60, 0.9, 0.24, 'sawtooth'); this.noise(200, 0.8, 0.9, 0.14, 80); }
  nudge() { this.noise(220, 1, 0.12, 0.2, 90); }
  bonusTick(i = 0) { this.tone(700 + (i % 12) * 45, 900 + (i % 12) * 45, 0.045, 0.1, 'square'); }
  gameOver() { [12, 7, 4, 0].forEach((s, i) => this.tone(392 * 2 ** (s / 12), 392 * 2 ** (s / 12), 0.4, 0.16, 'triangle', i * 0.16)); }
}

export default { Sfx };
