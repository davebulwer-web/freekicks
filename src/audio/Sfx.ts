import type { Manifest } from '../assets/manifest';

export type SfxName = 'kick' | 'whistle' | 'post' | 'net' | 'bounce' | 'cheer' | 'groan' | 'crowd';

/**
 * Placeholder sound effects synthesised with WebAudio. Any sound named in manifest.audio with a
 * file path is loaded and used instead of the synth version.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buffers = new Map<SfxName, AudioBuffer>();
  private crowdGain: GainNode | null = null;
  muted = false;

  constructor(private manifest: Manifest) {}

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    void this.loadFiles();
    this.startCrowd();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : 0.8;
  }

  private async loadFiles() {
    for (const [name, file] of Object.entries(this.manifest.audio)) {
      if (!file || !this.ctx) continue;
      try {
        const r = await fetch('./assets/' + file);
        if (!r.ok) continue;
        this.buffers.set(name as SfxName, await this.ctx.decodeAudioData(await r.arrayBuffer()));
        if (name === 'crowd') this.startCrowd();
      } catch {
        /* keep synth */
      }
    }
  }

  play(name: SfxName, intensity = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = Math.min(1.5, intensity);
      src.buffer = buf;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
    const t = ctx.currentTime;
    switch (name) {
      case 'kick':
        this.thump(t, 90, 0.18, 0.9 * intensity);
        this.noise(t, 0.05, 2500, 0.4 * intensity);
        break;
      case 'bounce':
        this.thump(t, 70, 0.12, 0.35 * Math.min(1, intensity));
        break;
      case 'post':
        for (const [f, a] of [[880, 0.35], [1320, 0.2], [2210, 0.12]] as const) this.tone(t, f, 0.9, a * intensity, 'sine');
        this.thump(t, 140, 0.1, 0.5);
        break;
      case 'net':
        this.noise(t, 0.35, 900, 0.35 * Math.min(1, intensity), 'lowpass');
        break;
      case 'whistle': {
        const o = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        const g = ctx.createGain();
        o.frequency.value = 2650;
        lfo.frequency.value = 38;
        lg.gain.value = 120;
        lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.02);
        g.gain.setValueAtTime(0.18, t + 0.45);
        g.gain.linearRampToValueAtTime(0, t + 0.5);
        o.connect(g).connect(this.master);
        o.start(t); lfo.start(t);
        o.stop(t + 0.55); lfo.stop(t + 0.55);
        break;
      }
      case 'cheer':
        this.swell(t, 2.8, 1200, 0.5);
        break;
      case 'groan':
        this.swell(t, 1.6, 380, 0.4);
        break;
    }
  }

  /** Crowd excitement 0..1 drives the ambience loop level. */
  setCrowd(level: number) {
    if (this.crowdGain && this.ctx) this.crowdGain.gain.setTargetAtTime(0.05 + level * 0.25, this.ctx.currentTime, 0.4);
  }

  private crowdSrc: AudioBufferSourceNode | null = null;

  private startCrowd() {
    const ctx = this.ctx!;
    this.crowdSrc?.stop();
    const file = this.buffers.get('crowd');
    const src = ctx.createBufferSource();
    src.buffer = file ?? this.noiseBuffer(4, true);
    src.loop = true;
    this.crowdSrc = src;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.6;
    this.crowdGain ??= ctx.createGain();
    this.crowdGain.gain.value = 0.06;
    if (file) src.connect(this.crowdGain);
    else src.connect(f).connect(this.crowdGain);
    this.crowdGain.connect(this.master);
    src.start();
  }

  private noiseBuffer(seconds: number, brown = false): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return b;
  }

  private noise(t: number, dur: number, freq: number, amp: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  private thump(t: number, freq: number, dur: number, amp: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private tone(t: number, freq: number, dur: number, amp: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private swell(t: number, dur: number, freq: number, amp: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur + 0.1, true);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
}
