import type { CharacterId, CombatEvent, FighterSnapshot, Snapshot } from '../../shared/types';
import type { VolumeChannel, Volumes, VoiceCue } from './types';
import * as sfx from './sfx';
import type { HissOptions, Synth, ToneOptions } from './sfx';
type Scene = 'menu' | 'battle' | 'result';
type AnnouncerCue = 'round1' | 'fight';
type ClipCue = VoiceCue | AnnouncerCue;
type VoiceClips = Partial<Record<CharacterId, Partial<Record<VoiceCue, string[]>>>>;
type SystemClips = Partial<Record<AnnouncerCue, string[]>>;
interface VoiceRequest { seq: number; priority: number; cue: ClipCue }
interface VoiceEntry { source: AudioBufferSourceNode; level: GainNode | null; priority: number; cue: ClipCue; file: string; request: VoiceRequest; endAt: number }
const CHANNELS: readonly VolumeChannel[] = ['music', 'sfx', 'voice'];
const root = window;
const clamp = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);
const IDS: readonly CharacterId[] = ['gale', 'iron', 'shadow', 'pyro', 'bastion'];
const DEFAULT_VOLUMES = Object.freeze({ music: 1, sfx: 1, voice: 1 });
const SFX_GAIN = 3.6;
const VOICE_PRIORITY = Object.freeze({ select: 1, ult: 2, ko: 3 });
const CUES: readonly VoiceCue[] = ['select', 'ult', 'ko'];
const ANNOUNCER_CUES: readonly AnnouncerCue[] = ['round1', 'fight'];
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function clipList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((clip): clip is string => typeof clip === 'string') : undefined;
}
// Event ids look like "shadow_s1" or "gale_ult_bolt": the character leads.
const characterOf = (id: string): CharacterId => {
  const head = id.split('_')[0];
  return (IDS as readonly string[]).includes(head) ? head as CharacterId : 'shadow';
};

export class GameAudio {
  declare static readonly defaultVolumes: Readonly<Volumes>;
  declare static readonly characterCues: readonly VoiceCue[];
  declare volumes: Volumes;
  declare context: AudioContext | null;
  declare scene: Scene;
  declare voiceAvailable: boolean;
  declare voiceStatus: string;
  declare voiceClips: VoiceClips;
  declare systemClips: SystemClips;
  declare voiceBuffers: Map<string, AudioBuffer>;
  declare voiceSources: Set<AudioBufferSourceNode>;
  declare activeVoices: Map<string, VoiceEntry>;
  declare pendingVoices: Map<string, VoiceRequest>;
  declare voiceBufferRequests: Map<string, Promise<AudioBuffer>>;
  declare voiceRequestSeq: number;
  declare random: () => number;
  declare lastVoice: Map<string, number>;
  declare lastEffect: number;
  declare lastUI: number;
  declare disposed: boolean;
  declare beat: number;
  declare nextBeat: number;
  declare timer: number | null;
  declare manifestRequest: Promise<boolean> | null;
  declare buses: Record<VolumeChannel, GainNode> | undefined;
  declare limiter: DynamicsCompressorNode | undefined;
  declare peakGuard: WaveShaperNode | undefined;
  declare musicDuck: GainNode | undefined;
  declare sfxDuck: GainNode | undefined;
  declare sfxLevel: GainNode | undefined;
  declare noise: AudioBuffer | undefined;
  declare musicPump: GainNode | undefined;
  /** What the recipes in sfx.ts schedule layers through: always the ducked SFX bus. */
  declare synth: Synth;
  declare gates: Map<string, number>;
  declare drives: Map<number, Float32Array<ArrayBuffer>>;
  declare chain: { actor: number | null; n: number; at: number };
  private listenerLeft = 0;
  private listenerWidth = 1280;

  setListenerView(left: number, width: number) { this.listenerLeft = left; this.listenerWidth = Math.max(1, width); }

  constructor(volumes: Partial<Volumes> = {}, options: { random?: () => number } = {}) {
    this.volumes = { music: clamp(volumes.music, DEFAULT_VOLUMES.music), sfx: clamp(volumes.sfx, DEFAULT_VOLUMES.sfx), voice: clamp(volumes.voice, DEFAULT_VOLUMES.voice) };
    this.context = null;
    this.scene = 'menu';
    this.voiceAvailable = false;
    this.voiceStatus = '日语原声尚未取得；当前播放原创配乐与战斗音效。';
    this.voiceClips = {};
    this.systemClips = {};
    this.voiceBuffers = new Map();
    this.voiceSources = new Set();
    this.activeVoices = new Map();
    this.pendingVoices = new Map();
    this.voiceBufferRequests = new Map();
    this.voiceRequestSeq = 0;
    this.random = typeof options.random === 'function' ? options.random : Math.random;
    this.lastVoice = new Map();
    this.lastEffect = 0;
    this.lastUI = -100;
    this.disposed = false;
    this.beat = 0;
    this.nextBeat = 0;
    this.timer = null;
    this.manifestRequest = null;
    this.gates = new Map();
    this.drives = new Map();
    this.chain = { actor: null, n: 0, at: -10 };
    // Arrow functions resolve this.tone / this.hiss at call time, so tests can replace them.
    this.synth = {
      tone: (note, at, duration, level, type, endNote, options) => this.tone(note, at, duration, level, type, this.sfxDuck, endNote, options),
      hiss: (at, duration, level, frequency, options) => this.hiss(at, duration, level, frequency, options),
      rand: () => this.random(),
    };
  }

  async unlock() {
    if (this.disposed) return false;
    try {
      if (!this.context) {
        const AudioContext = root.AudioContext || root.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext();
        this.buildGraph(this.context);
        this.nextBeat = this.context.currentTime + .05;
        this.timer = root.setInterval(() => this.scheduleMusic(), 100);
      }
      await this.context.resume();
      if (!this.manifestRequest) this.manifestRequest = this.loadVoices();
      this.scheduleMusic();
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }

  /** Builds the bus graph on any context, so the same mix can also be rendered offline for auditioning. */
  buildGraph(context: BaseAudioContext) {
    const createBus = (key: VolumeChannel) => {
      const gain = context.createGain();
      gain.gain.value = this.volumes[key];
      gain.connect(context.destination);
      return gain;
    };
    this.buses = { music: createBus('music'), sfx: createBus('sfx'), voice: createBus('voice') };
    // A short limiter catches overlapping impacts without changing the
    // three independent user volume controls.
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 3;
    this.limiter.ratio.value = 12; this.limiter.attack.value = .001; this.limiter.release.value = .09;
    this.peakGuard = context.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const value = i * 2 / (curve.length - 1) - 1, magnitude = Math.abs(value);
      curve[i] = Math.sign(value) * (magnitude <= .92 ? magnitude : .92 + .065 * Math.tanh((magnitude - .92) / .065));
    }
    this.peakGuard.curve = curve;
    this.limiter.connect(this.peakGuard); this.peakGuard.connect(context.destination);
    for (const bus of Object.values(this.buses)) { bus.disconnect(); bus.connect(this.limiter); }
    // score -> voice duck -> pump -> music bus. The pump dips the score under heavy hits (see pump()).
    this.musicDuck = context.createGain();
    this.musicDuck.gain.value = 1;
    this.musicPump = context.createGain();
    this.musicPump.gain.value = 1;
    this.musicDuck.connect(this.musicPump);
    this.musicPump.connect(this.buses.music);
    this.sfxDuck = context.createGain();
    this.sfxDuck.gain.value = 1;
    this.sfxLevel = context.createGain();
    this.sfxLevel.gain.value = SFX_GAIN;
    this.sfxDuck.connect(this.sfxLevel);
    this.sfxLevel.connect(this.buses.sfx);
    const samples = context.sampleRate;
    this.noise = context.createBuffer(1, samples, samples);
    const channel = this.noise.getChannelData(0);
    for (let index = 0; index < channel.length; index++) channel[index] = Math.random() * 2 - 1;
  }

  setVolumes(volumes: Partial<Volumes> = {}) {
    for (const key of CHANNELS) {
      if (volumes[key] === undefined) continue;
      this.volumes[key] = clamp(volumes[key], this.volumes[key]);
      if (this.buses && this.context) this.buses[key].gain.setTargetAtTime(this.volumes[key], this.context.currentTime, .03);
    }
    return { ...this.volumes };
  }

  setScene(scene: Scene) {
    if (!['menu', 'battle', 'result'].includes(scene) || this.scene === scene) return;
    this.scene = scene;
    this.resetVoices();
    this.beat = 0;
    if (this.context) this.nextBeat = this.context.currentTime + .06;
  }

  /**
   * One enveloped oscillator. Plain calls behave exactly as before; options add what combat sounds need:
   * a filter that glides over the note (lp / hp = [from, to?, q?]), waveshaper drive, FM, detune, stereo pan,
   * and a long attack for risers.
   */
  tone(note: number, at: number, duration: number, level: number, type: OscillatorType = 'sine', bus: GainNode | undefined = this.musicDuck, endNote: number = note, options: ToneOptions = {}) {
    const context = this.context;
    if (!context || this.disposed || !bus) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const nodes: AudioNode[] = [oscillator];
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(midi(note), at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, midi(endNote)), at + duration);
    if (options.detune) oscillator.detune.value = options.detune;
    if (options.fm) {
      // a modulator whose depth is a fraction of the carrier frequency gives bells and zaps
      const modulator = context.createOscillator(), depth = context.createGain();
      modulator.frequency.setValueAtTime(midi(note) * options.fm[0], at);
      modulator.frequency.exponentialRampToValueAtTime(Math.max(20, midi(endNote) * options.fm[0]), at + duration);
      depth.gain.value = midi(note) * options.fm[1];
      modulator.connect(depth); depth.connect(oscillator.frequency);
      modulator.start(at); modulator.stop(at + duration + .02);
      nodes.push(modulator, depth);
    }
    const attack = Math.max(.002, Math.min(options.attack ?? .015, options.attack ? duration * .9 : duration / 3));
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), at + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    // oscillator -> [drive] -> [high-pass] -> [low-pass] -> envelope -> [pan] -> bus
    let head: AudioNode = oscillator;
    const chain = (node: AudioNode) => { head.connect(node); head = node; nodes.push(node); };
    if (options.drive) {
      const shaper = context.createWaveShaper();
      shaper.curve = this.driveCurve(options.drive);
      shaper.oversample = '2x';
      chain(shaper);
    }
    for (const [kind, spec] of [['highpass', options.hp], ['lowpass', options.lp]] as const) {
      if (!spec) continue;
      const filter = context.createBiquadFilter();
      filter.type = kind;
      filter.Q.value = spec[2] ?? .7;
      filter.frequency.setValueAtTime(spec[0], at);
      if (spec[1] && spec[1] !== spec[0]) filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec[1]), at + duration);
      chain(filter);
    }
    chain(gain);
    if (options.pan && typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      chain(panner);
    }
    head.connect(bus);
    oscillator.start(at);
    oscillator.stop(at + duration + .02);
    oscillator.onended = () => { for (const node of nodes) node.disconnect(); };
  }

  driveCurve(amount: number) {
    const key = Math.round(amount * 10);
    let curve = this.drives.get(key);
    if (!curve) {
      curve = new Float32Array(1025);
      const k = 1 + key * .9;
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1) * 2 - 1) * k) / Math.tanh(k);
      this.drives.set(key, curve);
    }
    return curve;
  }

  /** Dips the score for a moment so a big hit lands on a clear mix (a cheap side-chain). */
  pump(depth = .55, hold = .05, release = .24) {
    const context = this.context, gain = this.musicPump?.gain;
    if (!context || !gain || this.disposed) return;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(depth, now + .006);
    gain.setValueAtTime(depth, now + hold);
    gain.linearRampToValueAtTime(1, now + hold + release);
  }

  /** Rate limit per key, so a hit and a skill in the same frame can both sound without machine-gunning. */
  gate(key: string, now: number, gap: number) {
    if (now - (this.gates.get(key) ?? -1) < gap) return false;
    this.gates.set(key, now);
    return true;
  }

  /** Filtered noise. Without options: a high-passed burst, as before. Options: filter type, glide target, Q, attack, pan. */
  hiss(at: number, duration: number, level: number, frequency: number = 3200, options: HissOptions = {}) {
    const context = this.context;
    if (!context || !this.sfxDuck || this.disposed) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noise || null;
    source.loop = duration > .9;
    filter.type = options.type ?? 'highpass';
    filter.Q.value = options.q ?? .7;
    filter.frequency.setValueAtTime(frequency, at);
    if (options.to && options.to !== frequency) filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), at + duration);
    if (options.attack) {
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), at + Math.max(.003, Math.min(options.attack, duration * .9)));
    } else gain.gain.setValueAtTime(Math.max(.0002, level), at);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    const nodes: AudioNode[] = [source, filter, gain];
    if (options.pan && typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      gain.connect(panner); panner.connect(this.sfxDuck);
      nodes.push(panner);
    } else gain.connect(this.sfxDuck);
    // a different slice of the noise each time, so repeated hits are not identical
    const offset = this.noise ? this.random() * Math.max(0, this.noise.duration - duration - .02) : 0;
    source.start(at, offset);
    source.stop(at + duration);
    source.onended = () => { for (const node of nodes) node.disconnect(); };
  }

  scheduleMusic() {
    if (!this.context || this.context.state !== 'running' || this.disposed) return;
    if (this.nextBeat < this.context.currentTime - .2) this.nextBeat = this.context.currentTime + .03;
    const battle = this.scene === 'battle';
    const step = 60 / (battle ? 116 : this.scene === 'result' ? 84 : 72) / 2;
    const roots = this.scene === 'result' ? [49, 52, 56, 49] : [49, 45, 52, 47];
    while (this.nextBeat < this.context.currentTime + .24) {
      const beat = this.beat++;
      const chord = roots[Math.floor(beat / 8) % roots.length];
      const arp = [0, 7, 12, 15, 19, 15, 12, 7][beat % 8];
      this.tone(chord + 12 + arp, this.nextBeat, step * 1.7, battle ? .047 : .034, 'triangle');
      if (beat % 4 === 0) {
        this.tone(chord - 12, this.nextBeat, step * 3.6, .09, 'sine');
        this.tone(chord + 7, this.nextBeat, step * 3.8, .028, 'sine');
      }
      if (battle && beat % 2 === 0) this.tone(34, this.nextBeat, .13, .08, 'sine', this.musicDuck, 19);
      if (!battle && beat % 16 === 12) this.tone(chord + 27, this.nextBeat, step * 3.5, .018, 'sine');
      this.nextBeat += step;
    }
  }

  /**
   * Fresh combat events -> layered cues (recipes live in sfx.ts). The combat core emits several events per
   * action: `attack`/`skill` at the start, `hit` on contact, and `sfx` for named moments such as
   * "gale_ult_bolt". Bare move ids on `sfx` duplicate the hit and are ignored; the named ones play their own
   * signature. Each kind is rate-limited separately, so a hit and a cast in the same frame both sound.
   */
  handle(events: readonly CombatEvent[]) {
    if (!this.context || this.context.state !== 'running' || this.disposed || !Array.isArray(events)) return;
    const s = this.synth;
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const now = this.context.currentTime, at = now + .004;
      const id = String(event.id || ''), side = String(event.actor), character = characterOf(id);
      // Stereo follows the visible stage as the camera pans through the wider arena.
      const pan = Number.isFinite(event.x) ? Math.max(-.6, Math.min(.6, ((event.x - this.listenerLeft) / (this.listenerWidth / 2) - 1) * .55)) : 0;
      switch (event.kind) {
        case 'hit':
        case 'impact': {
          if (!this.gate(`hit:${side}`, now, .02)) break;
          const impact = event.kind === 'impact', damage = impact ? 45 : Number(event.damage) || 0, armored = !!event.armored;
          sfx.hit(s, at, { damage, armored, ultimate: !!event.ultimate, stolen: event.stolen, impact }, pan);
          if (!armored && damage >= 21) this.pump(.5, .06, .26);
          if (!impact && damage > 0 && !armored) this.combo(event.actor, now, at, pan);
          break;
        }
        case 'attack':
          if (this.gate(`swing:${side}`, now, .05)) sfx.swing(s, at, character, pan);
          break;
        case 'skill':
          if (!this.gate(`cast:${side}`, now, .12)) break;
          if (event.slot === 'ult') { sfx.ultCast(s, at, pan); this.pump(.45, .3, .4); }
          else sfx.cast(s, at, character, event.slot || 's0', pan);
          break;
        case 'sfx':
          if (sfx.hasSignature(id) && this.gate(`sig:${id}`, now, .05)) sfx.signature(s, at, id, pan);
          break;
        case 'ko':
          if (this.gate('ko', now, .2)) { sfx.ko(s, at, pan); this.pump(.3, .15, .6); }
          break;
        case 'match-end':
          if (this.gate('end', now, .5)) sfx.matchEnd(s, at);
          break;
        default: break;
      }
    }
  }

  /** Consecutive landed hits by one fighter climb a scale, so a combo is audible. */
  combo(actor: number | null, now: number, at: number, pan: number) {
    const same = actor === this.chain.actor && now - this.chain.at < 1.2;
    this.chain = { actor, n: same ? this.chain.n + 1 : 1, at: now };
    if (this.chain.n >= 2) sfx.comboPing(this.synth, at + .012, this.chain.n, pan);
  }

  async loadVoices() {
    try {
      const response = await root.fetch('assets/audio/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Manifest unavailable');
      const manifest = record(await response.json() as unknown);
      if (typeof manifest.status === 'string' && manifest.status) this.voiceStatus = manifest.status;
      this.voiceClips = {};
      const clips = record(manifest.clips);
      for (const id of IDS) {
        const row = record(clips[id]);
        const cues: Partial<Record<VoiceCue, string[]>> = {};
        for (const cue of CUES) { const list = clipList(row[cue]); if (list) cues[cue] = list; }
        this.voiceClips[id] = cues;
      }
      this.systemClips = {};
      const system = record(manifest.systemClips);
      for (const cue of ANNOUNCER_CUES) { const list = clipList(system[cue]); if (list) this.systemClips[cue] = list; }
      this.voiceAvailable = manifest.available === true && Object.values(this.voiceClips).some(clips => Object.values(clips).some(list => Array.isArray(list) && list.length));
    } catch {
      this.voiceAvailable = false;
      this.voiceStatus = '日语原声尚未取得；当前播放原创配乐与战斗音效。';
    }
    return this.voiceAvailable;
  }

  // The client supplies only fresh combat events. Audio deliberately does not
  // deduplicate seq: a new match starts its event sequence from the beginning.
  async handleCombatVoices(events: readonly CombatEvent[], fighters: readonly FighterSnapshot[]) {
    if (this.disposed || !Array.isArray(events) || !Array.isArray(fighters)) return [];
    const requests: Promise<boolean>[] = [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const actor = event.actor !== null && Number.isInteger(event.actor) ? fighters[event.actor] : null;
      const ultimate = event.slot === 'ult' || String(event.id || '').endsWith('_ult');
      if (event.kind === 'skill' && ultimate && actor && IDS.includes(actor.id)) requests.push(this.playVoice(actor.id, 'ult'));
    }
    return Promise.allSettled(requests);
  }

  async voiceBuffer(file: string): Promise<AudioBuffer> {
    const cached = this.voiceBuffers.get(file), pending = this.voiceBufferRequests.get(file);
    if (cached) return cached;
    if (pending) return pending;
    const context = this.context;
    if (!context) throw new Error('Audio context is unavailable');
    const request = (async () => {
      const response = await root.fetch(file);
      if (!response.ok) throw new Error('Voice unavailable');
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed) this.voiceBuffers.set(file, buffer);
      return buffer;
    })();
    this.voiceBufferRequests.set(file, request);
    try { return await request; }
    finally { if (this.voiceBufferRequests.get(file) === request) this.voiceBufferRequests.delete(file); }
  }

  refreshVoiceDuck() {
    if (!this.context || !this.musicDuck || this.disposed) return;
    const now = this.context.currentTime;
    const end = Math.max(now, ...Array.from(this.activeVoices.values(), entry => entry.endAt));
    for (const [bus, amount] of [[this.musicDuck, .25], [this.sfxDuck, .65]] as const) {
      if (!bus) continue;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(this.activeVoices.size ? amount : 1, now, .025);
      if (end > now) bus.gain.setTargetAtTime(1, end, .13);
    }
  }

  stopVoice(id: string) {
    const entry = this.activeVoices.get(id);
    if (!entry) return;
    this.activeVoices.delete(id);
    this.voiceSources.delete(entry.source);
    try { entry.source.stop(); } catch { /* already ended */ }
    try { entry.source.disconnect(); } catch { /* already disconnected */ }
    entry.level?.disconnect();
    this.refreshVoiceDuck();
  }

  resetVoices() {
    this.pendingVoices.clear();
    for (const id of Array.from(this.activeVoices.keys())) this.stopVoice(id);
    this.lastVoice.clear();
  }

  async playVoice(id: CharacterId, cue: VoiceCue) {
    if (this.disposed || !IDS.includes(id) || !Object.hasOwn(VOICE_PRIORITY, cue)) return false;
    if (cue === 'select') {
      // Fast selection should speak only the latest chosen character.
      for (const [key, entry] of this.pendingVoices) if (entry.cue === 'select') this.pendingVoices.delete(key);
      for (const [key, entry] of this.activeVoices) if (entry.cue === 'select') this.stopVoice(key);
    }
    return this.playClip(id, cue, VOICE_PRIORITY[cue], () => this.voiceClips[id]?.[cue]);
  }

  playAnnouncer(cue: AnnouncerCue) {
    if (!['round1', 'fight'].includes(cue)) return Promise.resolve(false);
    this.stinger(cue);
    return this.playClip('@announcer', cue, 4, () => this.systemClips[cue]);
  }

  /** A synthesized riser (Round 1) or impact (Fight) under the announcer's voice. */
  stinger(cue: AnnouncerCue) {
    void this.unlock().then((ok) => {
      if (ok && this.context && !this.disposed) sfx.stinger(this.synth, this.context.currentTime + .004, cue);
    });
  }

  playResult(snapshot: Snapshot | null) {
    const result = snapshot?.result;
    if (!snapshot || !result || !['ko', 'double-ko'].includes(result.reason) || result.winner === null || !Number.isInteger(result.winner)) return Promise.resolve(false);
    const winner = snapshot.fighters?.[result.winner]?.id;
    return winner ? this.playVoice(winner, 'ko') : Promise.resolve(false);
  }

  async playUI(cue: string = 'confirm') {
    const now = (root.performance?.now?.() ?? Date.now()) / 1000;
    if (this.disposed || now - this.lastUI < .06) return false;
    this.lastUI = now;
    if (!(await this.unlock()) || !this.context || this.disposed) return false;
    // Short, dry electronic ticks and blips (recipes in sfx.ts), entirely on the SFX bus.
    // Button feedback never loads speech or interrupts a role voice.
    sfx.ui(this.synth, this.context.currentTime + .002, cue);
    return true;
  }

  async playClip(id: string, cue: ClipCue, priority: number, getClips: () => readonly string[] | undefined, volume: number = 1) {
    if (this.disposed) return false;
    const active = this.activeVoices.get(id), pending = this.pendingVoices.get(id);
    if ((active && active.priority > priority) || (pending && pending.priority > priority)) return false;
    // Reserve before async unlock/fetch: an older slow decode must never start
    // after a newer skill has already replaced it.
    const request: VoiceRequest = { seq: ++this.voiceRequestSeq, priority, cue };
    this.pendingVoices.set(id, request);
    try {
      if (!(await this.unlock()) || !this.context || !this.buses) return false;
      if (this.manifestRequest) await this.manifestRequest;
      if (this.disposed || this.pendingVoices.get(id) !== request) return false;
      const clips = getClips();
      if (!Array.isArray(clips) || !clips.length) return false;
      const choice = clips.length === 1 ? 0 : Math.max(0, Math.min(clips.length - 1, Math.floor(this.random() * clips.length)));
      const file = clips[choice];
      if (typeof file !== 'string' || !/^assets\/audio\/[a-z0-9_/-]+\.(mp3|m4a|wav|ogg)$/i.test(file) || file.includes('..')) return false;
      const buffer = await this.voiceBuffer(file);
      if (this.disposed || this.pendingVoices.get(id) !== request) return false;
      const current = this.activeVoices.get(id);
      if (current && current.priority > priority) return false;
      this.stopVoice(id);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      const level = volume === 1 ? null : this.context.createGain();
      if (level) { level.gain.value = volume; level.connect(this.buses.voice); }
      source.connect(level || this.buses.voice);
      const entry = { source, level, priority, cue, file, request, endAt: this.context.currentTime + buffer.duration };
      source.onended = () => {
        this.voiceSources.delete(source);
        if (this.activeVoices.get(id) === entry) this.activeVoices.delete(id);
        try { source.disconnect(); } catch { /* already disconnected */ }
        level?.disconnect();
        this.refreshVoiceDuck();
      };
      this.voiceSources.add(source);
      this.activeVoices.set(id, entry);
      source.start();
      this.lastVoice.set(id, this.context.currentTime);
      this.refreshVoiceDuck();
      return true;
    } catch {
      if (this.activeVoices.get(id)?.request === request) this.stopVoice(id);
      return false;
    } finally {
      if (this.pendingVoices.get(id) === request) this.pendingVoices.delete(id);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resetVoices();
    if (this.timer !== null) root.clearInterval(this.timer);
    for (const source of this.voiceSources) { try { source.stop(); } catch { /* optional browser capability */ } }
    this.voiceSources.clear();
    this.voiceBuffers.clear();
    this.voiceBufferRequests.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
Object.defineProperties(GameAudio, { defaultVolumes: { value: DEFAULT_VOLUMES, enumerable: true }, characterCues: { value: Object.freeze(Object.keys(VOICE_PRIORITY)), enumerable: true } });
