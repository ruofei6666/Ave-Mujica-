(function (root) {
  'use strict';
  const clamp = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
  const midi = note => 440 * Math.pow(2, (note - 69) / 12);
  const IDS = ['gale', 'iron', 'shadow', 'pyro', 'bastion'];
  const DEFAULT_VOLUMES = Object.freeze({ music: 1, sfx: 1, voice: 1 });
  const SFX_GAIN = 3.6;
  const VOICE_PRIORITY = Object.freeze({ select: 1, ult: 2, ko: 3 });

  class GameAudio {
    constructor(volumes = {}, options = {}) {
      this.volumes = Object.fromEntries(Object.entries(DEFAULT_VOLUMES).map(([key, value]) => [key, clamp(volumes[key], value)]));
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
    }

    async unlock() {
      if (this.disposed) return false;
      try {
        if (!this.context) {
          const AudioContext = root.AudioContext || root.webkitAudioContext;
          if (!AudioContext) return false;
          this.context = new AudioContext();
          this.buses = {};
          for (const key of ['music', 'sfx', 'voice']) {
            const gain = this.context.createGain();
            gain.gain.value = this.volumes[key];
            gain.connect(this.context.destination);
            this.buses[key] = gain;
          }
          // A short limiter catches overlapping impacts without changing the
          // three independent user volume controls.
          this.limiter = this.context.createDynamicsCompressor();
          this.limiter.threshold.value = -2; this.limiter.knee.value = 3;
          this.limiter.ratio.value = 12; this.limiter.attack.value = .001; this.limiter.release.value = .09;
          this.peakGuard = this.context.createWaveShaper();
          const curve = new Float32Array(4097);
          for (let i = 0; i < curve.length; i++) {
            const value = i * 2 / (curve.length - 1) - 1, magnitude = Math.abs(value);
            curve[i] = Math.sign(value) * (magnitude <= .92 ? magnitude : .92 + .065 * Math.tanh((magnitude - .92) / .065));
          }
          this.peakGuard.curve = curve;
          this.limiter.connect(this.peakGuard); this.peakGuard.connect(this.context.destination);
          for (const bus of Object.values(this.buses)) { bus.disconnect(); bus.connect(this.limiter); }
          this.musicDuck = this.context.createGain();
          this.musicDuck.gain.value = 1;
          this.musicDuck.connect(this.buses.music);
          this.sfxDuck = this.context.createGain();
          this.sfxDuck.gain.value = 1;
          this.sfxLevel = this.context.createGain();
          this.sfxLevel.gain.value = SFX_GAIN;
          this.sfxDuck.connect(this.sfxLevel);
          this.sfxLevel.connect(this.buses.sfx);
          const samples = this.context.sampleRate;
          this.noise = this.context.createBuffer(1, samples, samples);
          const channel = this.noise.getChannelData(0);
          for (let index = 0; index < channel.length; index++) channel[index] = Math.random() * 2 - 1;
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

    setVolumes(volumes = {}) {
      for (const key of ['music', 'sfx', 'voice']) {
        if (volumes[key] === undefined) continue;
        this.volumes[key] = clamp(volumes[key], this.volumes[key]);
        if (this.buses) this.buses[key].gain.setTargetAtTime(this.volumes[key], this.context.currentTime, .03);
      }
      return { ...this.volumes };
    }

    setScene(scene) {
      if (!['menu', 'battle', 'result'].includes(scene) || this.scene === scene) return;
      this.scene = scene;
      this.resetVoices();
      this.beat = 0;
      if (this.context) this.nextBeat = this.context.currentTime + .06;
    }

    tone(note, at, duration, level, type = 'sine', bus = this.musicDuck, endNote = note) {
      if (!this.context || this.disposed || !bus) return;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(midi(note), at);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, midi(endNote)), at + duration);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), at + Math.min(.015, duration / 3));
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(bus);
      oscillator.start(at);
      oscillator.stop(at + duration + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }

    hiss(at, duration, level, frequency = 3200) {
      if (!this.context || this.disposed) return;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.noise;
      filter.type = 'highpass';
      filter.frequency.value = frequency;
      gain.gain.setValueAtTime(Math.max(.0002, level), at);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxDuck);
      source.start(at);
      source.stop(at + duration);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
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

    handle(events) {
      if (!this.context || this.context.state !== 'running' || this.disposed || !Array.isArray(events)) return;
      for (const event of events) {
        const now = this.context.currentTime;
        if (!event || now - this.lastEffect < .025) continue;
        const id = String(event.id || '');
        if (event.kind === 'hit' || event.kind === 'impact') {
          const heavy = Number(event.damage) >= 30 || event.kind === 'impact';
          this.tone(heavy ? 38 : 49, now, heavy ? .22 : .12, heavy ? .23 : .14, 'sine', this.sfxDuck, 20);
          this.hiss(now, heavy ? .11 : .055, heavy ? .10 : .055, heavy ? 900 : 2400);
        } else if (event.kind === 'ko' || event.kind === 'match-end') {
          this.tone(45, now, .65, .16, 'triangle', this.sfxDuck, 25);
          this.tone(64, now + .12, .45, .065, 'sine', this.sfxDuck, 49);
        } else if (event.kind === 'skill' || event.kind === 'attack' || event.kind === 'sfx') {
          const ultimate = event.slot === 'ult' || id.includes('_ult');
          this.tone(ultimate ? 53 : 62, now, ultimate ? .37 : .09, ultimate ? .12 : .045, 'triangle', this.sfxDuck, ultimate ? 81 : 76);
          if (ultimate) this.hiss(now + .08, .25, .05, 1600);
        } else continue;
        this.lastEffect = now;
      }
    }

    async loadVoices() {
      try {
        const response = await root.fetch('assets/audio/manifest.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('Manifest unavailable');
        const manifest = await response.json();
        this.voiceStatus = manifest.status || this.voiceStatus;
        this.voiceClips = manifest.clips || {};
        this.systemClips = manifest.systemClips || {};
        const valid = Object.entries(this.voiceClips).filter(([id, clips]) => IDS.includes(id) && clips && typeof clips === 'object');
        this.voiceAvailable = manifest.available === true && valid.some(([, clips]) => Object.values(clips).some(list => Array.isArray(list) && list.length));
      } catch {
        this.voiceAvailable = false;
        this.voiceStatus = '日语原声尚未取得；当前播放原创配乐与战斗音效。';
      }
      return this.voiceAvailable;
    }

    // The client supplies only fresh combat events. Audio deliberately does not
    // deduplicate seq: a new match starts its event sequence from the beginning.
    async handleCombatVoices(events, fighters) {
      if (this.disposed || !Array.isArray(events) || !Array.isArray(fighters)) return [];
      const requests = [];
      for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        const actor = Number.isInteger(event.actor) ? fighters[event.actor] : null;
        const ultimate = event.slot === 'ult' || String(event.id || '').endsWith('_ult');
        if (event.kind === 'skill' && ultimate && actor && IDS.includes(actor.id)) requests.push(this.playVoice(actor.id, 'ult'));
      }
      return Promise.allSettled(requests);
    }

    async voiceBuffer(file) {
      if (this.voiceBuffers.has(file)) return this.voiceBuffers.get(file);
      if (this.voiceBufferRequests.has(file)) return this.voiceBufferRequests.get(file);
      const request = (async () => {
        const response = await root.fetch(file);
        if (!response.ok) throw new Error('Voice unavailable');
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
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
      for (const [bus, amount] of [[this.musicDuck, .25], [this.sfxDuck, .65]]) {
        if (!bus) continue;
        bus.gain.cancelScheduledValues(now);
        bus.gain.setTargetAtTime(this.activeVoices.size ? amount : 1, now, .025);
        if (end > now) bus.gain.setTargetAtTime(1, end, .13);
      }
    }

    stopVoice(id) {
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

    async playVoice(id, cue) {
      if (this.disposed || !IDS.includes(id) || !Object.hasOwn(VOICE_PRIORITY, cue)) return false;
      if (cue === 'select') {
        // Fast selection should speak only the latest chosen character.
        for (const [key, entry] of this.pendingVoices) if (entry.cue === 'select') this.pendingVoices.delete(key);
        for (const [key, entry] of this.activeVoices) if (entry.cue === 'select') this.stopVoice(key);
      }
      return this.playClip(id, cue, VOICE_PRIORITY[cue], () => this.voiceClips[id]?.[cue]);
    }

    playAnnouncer(cue) {
      if (!['round1', 'fight'].includes(cue)) return Promise.resolve(false);
      return this.playClip('@announcer', cue, 4, () => this.systemClips[cue]);
    }

    playResult(snapshot) {
      const result = snapshot?.result;
      if (!result || !['ko', 'double-ko'].includes(result.reason) || !Number.isInteger(result.winner)) return Promise.resolve(false);
      const winner = snapshot.fighters?.[result.winner]?.id;
      return this.playVoice(winner, 'ko');
    }

    async playUI(cue = 'confirm') {
      const now = (root.performance?.now?.() ?? Date.now()) / 1000;
      if (this.disposed || now - this.lastUI < .06) return false;
      this.lastUI = now;
      if (!(await this.unlock()) || this.disposed) return false;
      const at = this.context.currentTime;
      const back = cue === 'back' || cue === 'pause';
      const confirm = ['start', 'ready', 'rematch', 'join', 'create'].includes(cue);
      // A tactile snap and a very short electronic body, entirely on the SFX
      // bus. Button feedback never loads speech or interrupts a role voice.
      this.hiss(at, .018, .038, 2600);
      this.tone(back ? 78 : 85, at, .042, .055, 'triangle', this.sfxDuck, back ? 70 : 79);
      if (confirm) this.tone(89, at + .035, .055, .04, 'sine', this.sfxDuck, 94);
      return true;
    }

    async playClip(id, cue, priority, getClips, volume = 1) {
      if (this.disposed) return false;
      const active = this.activeVoices.get(id), pending = this.pendingVoices.get(id);
      if ((active && active.priority > priority) || (pending && pending.priority > priority)) return false;
      // Reserve before async unlock/fetch: an older slow decode must never start
      // after a newer skill has already replaced it.
      const request = { seq: ++this.voiceRequestSeq, priority, cue };
      this.pendingVoices.set(id, request);
      try {
        if (!(await this.unlock())) return false;
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
      root.clearInterval(this.timer);
      for (const source of this.voiceSources) { try { source.stop(); } catch {} }
      this.voiceSources.clear();
      this.voiceBuffers.clear();
      this.voiceBufferRequests.clear();
      if (this.context) void this.context.close().catch(() => {});
    }
  }
  Object.defineProperties(GameAudio, { defaultVolumes: { value: DEFAULT_VOLUMES, enumerable: true }, characterCues: { value: Object.freeze(Object.keys(VOICE_PRIORITY)), enumerable: true } });
  root.GameAudio = GameAudio;
})(window);
