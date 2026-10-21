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

  // near: 0 far from the sea .. 1 at it
  sea(near, time) {
    if (!this.seaGain) return;
    const swell = 0.55 + 0.45 * Math.sin(time * 0.6) * Math.sin(time * 0.23 + 1);
    this.seaGain.gain.setTargetAtTime(0.25 * near * swell, this.ctx.currentTime, 0.3);
  }
}
