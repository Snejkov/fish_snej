import { clamp } from "./util.js";

export class SnejAudio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.seBus = null;
    this.bgmBus = null;
    this.muffle = null;
    this.ready = false;
  }

  init() {
    if (this.ready) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    this.ctx = new AudioCtor();
    this.seBus = this.ctx.createGain();
    this.bgmBus = this.ctx.createGain();
    this.master = this.ctx.createGain();
    this.muffle = this.ctx.createBiquadFilter();
    const comp = this.ctx.createDynamicsCompressor();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 20000;
    this.seBus.connect(this.master);
    this.bgmBus.connect(this.master);
    this.master.connect(this.muffle);
    this.muffle.connect(comp);
    comp.connect(this.ctx.destination);
    this.setVolume(this.settings.volume);
    this.setBgm(this.settings.bgm);
    this.startAmbient();
    this.ready = true;
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state !== "running") this.ctx.resume();
  }

  setVolume(value) {
    this.settings.volume = clamp(value, 0, 1);
    if (this.seBus) this.seBus.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.03);
  }

  setBgm(value) {
    this.settings.bgm = clamp(value, 0, 1);
    if (this.bgmBus) this.bgmBus.gain.setTargetAtTime(this.settings.bgm, this.ctx.currentTime, 0.03);
  }

  setUnderwater(on) {
    if (!this.muffle) return;
    this.muffle.frequency.setTargetAtTime(on ? 520 : 20000, this.ctx.currentTime, 0.35);
  }

  startAmbient() {
    this.ambientWater = this.makeLoopNoise("lowpass", 420, 0.8, 0.08);
    this.ambientWind = this.makeLoopNoise("bandpass", 620, 0.6, 0.025);
  }

  makeLoopNoise(type, freq, q, gain) {
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const bus = this.ctx.createGain();
    src.buffer = buffer;
    src.loop = true;
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    bus.gain.value = gain;
    src.connect(filter);
    filter.connect(bus);
    bus.connect(this.bgmBus);
    src.start();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = type === "lowpass" ? 0.13 : 0.05;
    lfoGain.gain.value = type === "lowpass" ? 230 : 300;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    return { src, filter, bus };
  }

  noiseBurst({ dur, type = "lowpass", f0 = 900, f1 = 200, q = 0.8, gain = 0.05, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    src.buffer = buffer;
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(1, f0), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    env.gain.setValueAtTime(0.0008, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.seBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone({ freq, dur, type = "sine", gain = 0.05, delay = 0, slideTo = null, attack = 0.01 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    env.gain.setValueAtTime(0.0008, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(env);
    env.connect(this.seBus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  step() {
    this.noiseBurst({ dur: 0.1, type: "lowpass", f0: 900 + Math.random() * 120, f1: 200, gain: 0.055 });
  }

  waterSplash(size = 0.5) {
    this.noiseBurst({ dur: 0.18 + 0.3 * size, type: "lowpass", f0: 3600, f1: 260, gain: 0.16 + 0.2 * size });
    this.tone({ freq: 760, slideTo: 180, dur: 0.18, gain: 0.04 });
  }

  deny() {
    this.tone({ freq: 220, slideTo: 140, dur: 0.16, type: "square", gain: 0.06 });
  }

  charge() {
    this.tone({ freq: 320, dur: 0.18, type: "triangle", gain: 0.04 });
  }

  cast(power) {
    this.tone({ freq: 380 + clamp(power, 0, 1) * 240, slideTo: 180, dur: 0.28, type: "sawtooth", gain: 0.05 });
  }

  splash(volume = 0.5) {
    this.tone({ freq: 600, slideTo: 220, dur: 0.22, type: "sine", gain: Math.min(0.08, 0.02 + volume * 0.06) });
  }

  click() {
    this.tone({ freq: 620, dur: 0.05, type: "square", gain: 0.05 });
  }
}
