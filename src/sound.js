// Every sound is made in code with WebAudio: a thud for digging, a knock for building, a chime for a crystal, and
// the sea's hush, louder near the water.

export class Sound {
  constructor() {
    this.ctx = null;
  }

  // browsers only allow sound after a tap or click, so this is called from one
  start() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // the sea: looping noise through a low filter, its loudness swelling like waves
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    this.seaGain = c.createGain();
    this.seaGain.gain.value = 0;
    src.connect(lp).connect(this.seaGain).connect(this.master);
    src.start();
  }

  burst(freq, dur, gain, q = 1) {
    if (!this.ctx) return;
    const c = this.ctx,
      t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random(), dur + 0.05);
  }

  dig() {
    this.burst(260 + Math.random() * 120, 0.18, 0.9, 0.8);
  }

  build() {
    this.burst(900 + Math.random() * 200, 0.07, 0.7, 3);
  }

  chime() {
    if (!this.ctx) return;
    const c = this.ctx,
      t = c.currentTime;
    [0, 4, 7, 12].forEach((step, i) => {
      const o = c.createOscillator(),
        g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = 660 * Math.pow(2, step / 12);
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.8);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.9);
    });
  }

  // a tone sliding from one pitch to another
  tone(type, f0, f1, dur, gain, filter = 0) {
    if (!this.ctx) return;
    const c = this.ctx,
      t = c.currentTime;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o.connect(g);
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      out = g.connect(f);
    }
    out.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // the axe biting into wood: a hollow knock and a short crack
  chop() {
    this.tone('sine', 230 + Math.random() * 40, 120, 0.16, 0.7);
    this.burst(1400 + Math.random() * 400, 0.06, 0.6, 4);
  }

  // the trunk giving way: a low groan that sinks
  creak() {
    this.tone('sawtooth', 95, 55, 1.4, 0.18, 400);
    this.burst(600, 0.4, 0.3, 6);
  }

  // the tree landing: a deep thump and a long rush of leaves and branches
  crash() {
    this.tone('sine', 90, 35, 0.6, 0.9);
    this.burst(300, 0.9, 0.9, 0.6);
    this.burst(2500, 1.2, 0.35, 0.5);
  }

  rustle() {
    this.burst(3000, 0.4, 0.4, 0.5);
  }

  pickup() {
    this.tone('triangle', 520, 880, 0.14, 0.3);
  }

  // near: 0 far from the sea .. 1 at it
  sea(near, time) {
    if (!this.seaGain) return;
    const swell = 0.55 + 0.45 * Math.sin(time * 0.6) * Math.sin(time * 0.23 + 1);
    this.seaGain.gain.setTargetAtTime(0.25 * near * swell, this.ctx.currentTime, 0.3);
  }
}
