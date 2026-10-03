'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWorld } = require('../shared/combat.ts');
const { buildSync } = require('esbuild');
const source = buildSync({ entryPoints: [path.join(__dirname, '../src/game/audio.ts')], bundle: true, write: false, format: 'iife', globalName: 'AudioModule' }).outputFiles[0].text + '\nwindow.GameAudio = AudioModule.GameAudio;';
const ids = ['gale', 'iron', 'shadow', 'pyro', 'bastion'];
const cues = ['select', 'ult', 'ko'];

function makeClass(windowOverrides = {}) {
  const window = { setInterval: () => 1, clearInterval() {}, ...windowOverrides };
  vm.runInNewContext(source, { window }, { filename: 'audio.ts' });
  return { GameAudio: window.GameAudio, window };
}
function parameter(value = 1) {
  return { value, targets: [], setTargetAtTime(next, at, constant) { this.value = next; this.targets.push({ next, at, constant }); }, cancelScheduledValues() {} };
}
function prepared() {
  const { GameAudio, window } = makeClass();
  const audio = new GameAudio();
  const created = [], tones = [], hisses = [];
  const context = {
    currentTime: 1, state: 'running', throwStart: false,
    decodeAudioData: async () => ({ duration: 1 }),
    close() { this.state = 'closed'; return Promise.resolve(); },
    createGain() { return { gain: parameter(1), connect() {}, disconnect() {} }; },
    createBufferSource() {
      const node = {
        started: false, stopped: false, ended: false, disconnected: false,
        connect(bus) { this.bus = bus; },
        start() { if (context.throwStart) throw new Error('native source start failed'); this.started = true; },
        stop() { this.stopped = true; this.ended = true; this.onended?.(); },
        finish() { this.ended = true; this.onended?.(); },
        disconnect() { this.disconnected = true; }
      };
      created.push(node); return node;
    }
  };
  audio.context = context;
  audio.buses = { music: { gain: parameter(1) }, sfx: { gain: parameter(1) }, voice: { gain: parameter(1) } };
  audio.musicDuck = { gain: parameter(1) }; audio.sfxDuck = { gain: parameter(1) };
  audio.unlock = async () => true; audio.tone = (...args) => tones.push(args); audio.hiss = (...args) => hisses.push(args);
  audio.voiceAvailable = true;
  for (const id of ids) {
    audio.voiceClips[id] = {};
    for (const cue of cues) {
      const file = `assets/audio/${id}/${cue}.wav`;
      audio.voiceClips[id][cue] = [file]; audio.voiceBuffers.set(file, { duration: 1, file });
    }
  }
  for (const cue of ['round1', 'fight']) {
    const file = `assets/audio/system/${cue}-voicebosch.wav`;
    audio.systemClips[cue] = [file]; audio.voiceBuffers.set(file, { duration: 1, file });
  }
  window.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  return { audio, context, created, tones, hisses, window, GameAudio };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('all five characters speak only ultimate combat events', async () => {
  const { audio } = prepared(); const calls = [];
  audio.playVoice = async (id, cue) => { calls.push([id, cue]); return true; };
  for (const id of ids) {
    await audio.handleCombatVoices([
      ...['s0', 's1', 's2', 'ult'].map(slot => ({ kind: 'skill', actor: 0, slot, id: `${id}_${slot}` })),
      { kind: 'attack', actor: 0, slot: 'punch' }, { kind: 'hit', actor: 0, target: 1 }
    ], [{ id }, { id: 'iron' }]);
  }
  assert.deepEqual(calls, ids.map(id => [id, 'ult']));
});

test('real combat ordinary attack/hit/skill stay silent; a charged ultimate uses the attacker voice', async () => {
  const { audio } = prepared(); const calls = [];
  audio.playVoice = async (id, cue) => { calls.push([id, cue]); return true; };
  const world = createWorld({ left: 'shadow', right: 'pyro', mode: 'pvp', introFrames: 0 });
  world.fighters[0].x = 580; world.fighters[1].x = 635;
  world.step([{ punch: true }, {}]);
  for (let frame = 0; frame < 7; frame++) world.step([{}, {}]);
  const snapshot = world.snapshot(); assert.ok(snapshot.events.some(e => e.kind === 'hit'));
  await audio.handleCombatVoices(snapshot.events, snapshot.fighters); assert.deepEqual(calls, []);
  for (let frame = 0; frame < 30; frame++) world.step([{}, {}]);
  world.step([{ special: true }, {}]);
  for (let frame = 0; frame < 25; frame++) world.step([{}, {}]);
  assert.equal(world.fighters[0].mp, 200);
  world.step([{ ult: true }, {}]);
  const charged = world.snapshot();
  await audio.handleCombatVoices(charged.events.filter(e => e.kind === 'skill'), charged.fighters);
  assert.deepEqual(calls, [['shadow', 'ult']]);
});

test('all volume defaults are full and exactly three role cues are exposed', () => {
  const { audio, GameAudio } = prepared();
  assert.deepEqual({ ...audio.volumes }, { music: 1, sfx: 1, voice: 1 });
  assert.deepEqual(Array.from(GameAudio.characterCues), cues);
});

test('K.O. always uses the winning character, including the opponent; draws/timeouts are silent', async () => {
  const { audio } = prepared(); const calls = [];
  audio.playVoice = async (id, cue) => { calls.push([id, cue]); return true; };
  const fighters = [{ id: 'pyro' }, { id: 'gale' }];
  await audio.playResult({ fighters, result: { winner: 0, reason: 'ko' } });
  await audio.playResult({ fighters, result: { winner: 1, reason: 'ko' } });
  assert.equal(await audio.playResult({ fighters, result: { winner: null, reason: 'double-ko' } }), false);
  assert.equal(await audio.playResult({ fighters, result: { winner: 0, reason: 'timeout' } }), false);
  assert.deepEqual(calls, [['pyro', 'ko'], ['gale', 'ko']]);
});

test('rapid role selection cancels an older slow load from a different character', async () => {
  const { audio, created } = prepared(); const slow = deferred(), cached = audio.voiceBuffer.bind(audio);
  audio.voiceBuffer = file => file.includes('/pyro/') ? slow.promise : cached(file);
  const old = audio.playVoice('pyro', 'select'); await turn();
  assert.equal(await audio.playVoice('iron', 'select'), true);
  slow.resolve({ duration: 1 }); assert.equal(await old, false);
  assert.equal(created.length, 1); assert.equal(audio.activeVoices.get('iron').cue, 'select');
});

test('ultimates replace selection, K.O. replaces ultimate, and lower priorities cannot interrupt K.O.', async () => {
  const { audio, created } = prepared();
  assert.equal(await audio.playVoice('gale', 'select'), true);
  assert.equal(await audio.playVoice('gale', 'ult'), true); assert.equal(created[0].stopped, true);
  assert.equal(await audio.playVoice('gale', 'ko'), true); assert.equal(created[1].stopped, true);
  assert.equal(await audio.playVoice('gale', 'ult'), false);
  assert.equal(await audio.playVoice('gale', 'select'), false);
  assert.equal(await audio.playVoice('gale', 'hurt'), false);
  assert.equal(created[2].stopped, false);
});

test('simultaneous opposing ultimates keep independent sources', async () => {
  const { audio, created } = prepared();
  assert.equal(await audio.playVoice('gale', 'ult'), true);
  assert.equal(await audio.playVoice('iron', 'ult'), true);
  assert.equal(created[0].stopped, false); assert.equal(created[1].stopped, false);
  assert.equal(audio.voiceSources.size, 2);
});

test('a slow older ultimate cannot start after the winner line decoded first', async () => {
  const { audio, created } = prepared(); const slow = deferred(), cached = audio.voiceBuffer.bind(audio);
  audio.voiceBuffer = file => file.endsWith('/ult.wav') ? slow.promise : cached(file);
  const old = audio.playVoice('bastion', 'ult'); await turn();
  assert.equal(await audio.playVoice('bastion', 'ko'), true);
  slow.resolve({ duration: 1 }); assert.equal(await old, false);
  assert.equal(created.length, 1); assert.equal(audio.activeVoices.get('bastion').cue, 'ko');
});

test('Round 1 then Fight use distinct narrator clips and a scene change cancels a late intro', async () => {
  const { audio, created } = prepared();
  assert.equal(await audio.playAnnouncer('round1'), true);
  assert.equal(await audio.playAnnouncer('fight'), true); assert.equal(created[0].stopped, true);
  const slow = deferred(); audio.voiceBuffer = () => slow.promise;
  const stale = audio.playAnnouncer('round1'); await turn(); audio.setScene('result');
  slow.resolve({ duration: 1 }); assert.equal(await stale, false);
  assert.equal(audio.activeVoices.size, 0);
});

test('button clicks use only SFX and leave selection, ultimate and announcer voices running', async () => {
  const { audio, window, created, tones, hisses } = prepared(); let clock = 1000; window.performance = { now: () => clock };
  assert.equal(await audio.playVoice('pyro', 'select'), true);
  const before = audio.voiceRequestSeq;
  // Each click is a short stack of layers; measure only the layers that click added (the announcer stinger is separate).
  const clicks = [];
  const click = async cue => {
    await turn(); const t = tones.length, h = hisses.length;
    const ok = await audio.playUI(cue); clicks.push({ cue, ok, tones: tones.slice(t), hisses: hisses.slice(h) }); return ok;
  };
  assert.equal(await click('settings'), true);
  assert.equal(created[0].stopped, false); assert.equal(audio.voiceRequestSeq, before);
  assert.equal(audio.activeVoices.has('@ui'), false); assert.equal(audio.pendingVoices.has('@ui'), false);
  assert.equal(await audio.playUI('settings'), false, 'rapid repeats are throttled');
  assert.equal(await audio.playVoice('pyro', 'ult'), true);
  clock += 100; assert.equal(await click('punch'), true); assert.equal(created[1].stopped, false);
  assert.equal(await audio.playAnnouncer('round1'), true);
  clock += 100; assert.equal(await click('start'), true); assert.equal(created[2].stopped, false);
  assert.equal(clicks.length, 3);
  for (const { cue, tones: layers, hisses: noise } of clicks) {
    assert.ok(layers.length >= 1 && noise.length >= 1, `${cue}: a tick plus at least one tone`);
    assert.ok(layers.every(tone => tone[5] === audio.sfxDuck && tone[2] <= .06), `${cue}: tones stay short and on the SFX bus`);
    assert.ok(noise.every(hiss => hiss[1] <= .25), `${cue}: noise stays short`);
  }
  assert.ok(clicks[2].tones.length > clicks[1].tones.length, 'a confirm is fuller than a battle button press');
});

test('button feedback cannot cancel a pending role decode and voice mute does not mute clicks', async () => {
  const { audio, tones, created } = prepared(); const slow = deferred();
  audio.voiceBuffer = () => slow.promise;
  const pending = audio.playVoice('iron', 'select'); await turn();
  audio.setVolumes({ voice: 0 });
  assert.equal(await audio.playUI('confirm'), true); assert.equal(audio.pendingVoices.get('iron').cue, 'select');
  assert.equal(audio.buses.sfx.gain.value, 1); assert.equal(audio.buses.voice.gain.value, 0);
  assert.ok(tones.length >= 1, 'the click still sounds'); slow.resolve({ duration: 1 }); assert.equal(await pending, true);
  assert.equal(created.length, 1);
});

test('failed fetch/start cannot reject gameplay or leave a blocking voice', async () => {
  const { audio, context, created } = prepared();
  audio.voiceBuffer = async () => { throw new Error('offline'); };
  assert.equal(await audio.playVoice('gale', 'ult'), false); assert.equal(audio.pendingVoices.size, 0); assert.equal(audio.activeVoices.size, 0);
  audio.voiceBuffer = async () => ({ duration: 1 }); context.throwStart = true;
  assert.equal(await audio.playVoice('gale', 'ult'), false); assert.equal(audio.activeVoices.size, 0); assert.equal(audio.voiceSources.size, 0); assert.equal(created[0].disconnected, true);
  context.throwStart = false; assert.equal(await audio.playVoice('gale', 'ult'), true);
});

test('scene transitions cancel stale voices and allow winner/selection cues in new scenes', async () => {
  const { audio } = prepared(); const slow = deferred(), cached = audio.voiceBuffer.bind(audio);
  audio.voiceBuffer = file => file.endsWith('/ult.wav') ? slow.promise : cached(file);
  const stale = audio.playVoice('shadow', 'ult'); await turn(); audio.setScene('result');
  assert.equal(await audio.playVoice('shadow', 'ko'), true); slow.resolve({ duration: 1 }); assert.equal(await stale, false);
  audio.setScene('menu'); assert.equal(audio.activeVoices.size, 0); assert.equal(await audio.playVoice('shadow', 'select'), true);
});

test('restarted matches can speak again when fresh event sequences restart at 1', async () => {
  const { audio, created } = prepared(); const fighters = [{ id: 'iron' }, { id: 'gale' }];
  await audio.handleCombatVoices([{ seq: 1, kind: 'skill', actor: 0, slot: 'ult' }], fighters);
  audio.setScene('battle');
  await audio.handleCombatVoices([{ seq: 1, kind: 'skill', actor: 0, slot: 'ult' }], fighters);
  assert.equal(created.length, 2); assert.equal(audio.activeVoices.get('iron').cue, 'ult');
});

test('disposal prevents any pending load from creating a source after close', async () => {
  const { audio, context, created } = prepared(); const slow = deferred(); audio.voiceBuffer = () => slow.promise;
  const request = audio.playVoice('iron', 'ult'); await turn(); audio.dispose(); slow.resolve({ duration: 1 });
  assert.equal(await request, false); assert.equal(created.length, 0); assert.equal(context.state, 'closed'); assert.equal(audio.pendingVoices.size, 0);
});


/* ---------------- combat sound design (recipes in src/game/sfx.ts) ---------------- */

// sfx.ts is bundled separately so its recipes can be driven by a recording synth.
const sfx = (() => {
  const code = buildSync({ entryPoints: [path.join(__dirname, '../src/game/sfx.ts')], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports }); return module.exports;
})();
function recorder(random = () => 0.5) {
  const tones = [], hisses = [];
  return { tones, hisses, synth: {
    tone: (note, at, duration, level, type, endNote, options) => tones.push({ note, at, duration, level, type, endNote, options: options || {} }),
    hiss: (at, duration, level, frequency, options) => hisses.push({ at, duration, level, frequency, options: options || {} }),
    rand: random,
  } };
}
const hitEvent = (extra = {}) => ({ seq: 1, frame: 1, kind: 'hit', actor: 0, id: 'shadow_s1', x: 640, y: 400, damage: 12, ...extra });
// handle() reads context.currentTime; this moves it between events.
function listener() {
  const rig = prepared(); rig.context.currentTime = 10;
  const heard = () => ({ tones: rig.tones.splice(0), hisses: rig.hisses.splice(0) });
  return { ...rig, heard, at(time) { rig.context.currentTime = time; } };
}

test('every recipe produces finite, bounded layers for every character, slot, damage and cue', () => {
  const run = fn => { const r = recorder(); fn(r.synth); return r; };
  const runs = [];
  for (const damage of [0, 4, 12, 30, 45, 80]) for (const flags of [{}, { armored: true }, { ultimate: true }, { impact: true }]) runs.push(run(s => sfx.hit(s, 1, { damage, ...flags }, 0.4)));
  runs.push(run(s => sfx.hit(s, 1, { damage: 0, stolen: 40 }, 0)));
  for (const id of ids) {
    runs.push(run(s => sfx.swing(s, 1, id, -0.3)));
    for (const slot of ['s0', 's1', 's2']) runs.push(run(s => sfx.cast(s, 1, id, slot, 0.3)));
  }
  runs.push(run(s => sfx.ultCast(s, 1, 0)), run(s => sfx.ko(s, 1, 0)), run(s => sfx.matchEnd(s, 1)), run(s => sfx.stinger(s, 1, 'round1')), run(s => sfx.stinger(s, 1, 'fight')));
  for (let n = 2; n < 14; n++) runs.push(run(s => sfx.comboPing(s, 1, n, 0)));
  for (const cue of ['confirm', 'start', 'ready', 'rematch', 'join', 'create', 'back', 'pause', 'settings', 'help', 'punch', 'special', 'skill1', 'skill2', 'ult', 'count', 'ultReady', 'easy', 'pve']) runs.push(run(s => sfx.ui(s, 1, cue)));
  const signatures = ['bastion_s0_stomp', 'gale_s2_cut', 'gale_ult_bolt', 'iron_s1_smash', 'iron_ult_slam', 'shadow_s1_slash', 'shadow_ult_cut', 'pyro_s1_shot', 'pyro_s2_wave', 'pyro_ult_fall', 'pyro_ult_boom', 'bastion_s1_shot', 'bastion_s2_bash', 'bastion_ult_quake'];
  for (const id of signatures) { assert.equal(sfx.hasSignature(id), true, id); runs.push(run(s => sfx.signature(s, 1, id, 0))); }
  for (const bare of ['shadow_s1', 'gale_punch', 'bastion_s0', 'nope']) assert.equal(sfx.hasSignature(bare), false, `${bare} duplicates a hit and has no signature`);
  for (const { tones, hisses } of runs) {
    assert.ok(tones.length + hisses.length >= 2, 'every cue is a stack of layers, never a single beep');
    for (const t of tones) {
      assert.ok(Number.isFinite(t.note) && t.note > 10 && t.note < 130, `note ${t.note}`);
      assert.ok(Number.isFinite(t.endNote) && t.endNote > 10 && t.endNote < 130, `endNote ${t.endNote}`);
      assert.ok(t.duration > 0 && t.duration <= 1.1 && t.at >= 1 && t.level > 0 && t.level <= 0.4, JSON.stringify(t));
    }
    for (const h of hisses) assert.ok(h.duration > 0 && h.duration <= 1.1 && h.level > 0 && h.level <= 0.25 && h.frequency >= 100 && h.frequency <= 16000 && h.at >= 1, JSON.stringify(h));
  }
});

test('hits are layered and scale with damage: heavier means a lower body, a sub boom and a longer tail', () => {
  const light = recorder(), heavy = recorder();
  sfx.hit(light.synth, 1, { damage: 4 }, 0); sfx.hit(heavy.synth, 1, { damage: 40 }, 0);
  const body = r => r.tones.filter(t => t.type === 'sine').sort((a, b) => a.note - b.note)[0];
  assert.ok(heavy.tones.length + heavy.hisses.length > light.tones.length + light.hisses.length);
  assert.ok(body(heavy).note < body(light).note, 'heavier hit is lower');
  assert.ok(heavy.tones.some(t => t.duration >= 0.4 && t.note < 40), 'sub boom only on heavy hits');
  assert.ok(!light.tones.some(t => t.duration >= 0.4), 'a light hit has no long tail');
  assert.ok(heavy.hisses.some(h => h.options.type === 'lowpass'), 'heavy hits get a low-passed boom');
});

test('combat events route by kind: hits, swings, casts and named moments sound, bare move ids stay silent', () => {
  const { audio, heard, at } = listener();
  audio.handle([hitEvent()]); const hitLayers = heard();
  assert.ok(hitLayers.tones.length >= 3 && hitLayers.hisses.length >= 2, 'a hit is a transient, a body and air');
  at(11); audio.handle([{ seq: 2, frame: 2, kind: 'attack', actor: 0, id: 'shadow_punch', slot: 'punch', x: 640, y: 500 }]); assert.ok(heard().hisses.length >= 1, 'a swing whooshes');
  at(12); audio.handle([{ seq: 3, frame: 3, kind: 'skill', actor: 0, id: 'shadow_s0', slot: 's0', x: 640, y: 500 }]); assert.ok(heard().tones.length >= 2, 'a cast charges up');
  at(13); audio.handle([{ seq: 4, frame: 4, kind: 'skill', actor: 0, id: 'shadow_ult', slot: 'ult', x: 640, y: 500 }]);
  // the listener rig records raw argument lists: tone = [note, at, duration, level, type, bus, endNote, options], hiss = [at, duration, level, frequency, options]
  const ult = heard(); assert.ok(ult.tones.some(t => t[2] >= 0.4 && t[0] < 45), 'an ultimate drops a sub boom'); assert.ok(ult.hisses.some(h => h[4]?.attack >= 0.3), 'with a riser leading in');
  at(14); audio.handle([{ seq: 5, frame: 5, kind: 'sfx', actor: 0, id: 'shadow_s1', x: 640, y: 500 }]); assert.equal(heard().tones.length, 0, 'a bare move id duplicates the hit');
  at(15); audio.handle([{ seq: 6, frame: 6, kind: 'sfx', actor: 0, id: 'gale_ult_bolt', x: 640, y: 500 }]); assert.ok(heard().tones.length >= 2, 'a named moment plays its signature');
  at(16); audio.handle([{ seq: 7, frame: 7, kind: 'ko', actor: 1, id: 'iron', x: 640, y: 500 }]); const ko = heard(); assert.ok(ko.tones.some(t => t[2] >= 0.8), 'K.O. has a long boom'); assert.ok(ko.hisses.length >= 5, 'with glass');
  at(17); audio.handle([{ seq: 8, frame: 8, kind: 'bogus', actor: 0, id: 'x' }, null, 'junk']); assert.equal(heard().tones.length, 0);
});

test('different kinds in one frame all sound, while the same kind is rate-limited', () => {
  const { audio, heard } = listener();
  audio.handle([hitEvent(), { seq: 2, frame: 1, kind: 'attack', actor: 1, id: 'gale_punch', slot: 'punch', x: 700, y: 500 }, { seq: 3, frame: 1, kind: 'sfx', actor: 0, id: 'iron_s1_smash', x: 640, y: 500 }]);
  const together = heard(); assert.ok(together.tones.length >= 6, 'hit + swing + signature in the same frame');
  audio.handle([hitEvent({ seq: 4 })]); assert.equal(heard().tones.length, 0, 'the same fighter cannot machine-gun hits inside 20 ms');
  audio.handle([hitEvent({ seq: 5, actor: 1 })]); assert.ok(heard().tones.length >= 3, 'the opponent trading a hit in the same instant still sounds');
});

test('sound is placed left or right of center by where the action is', () => {
  const { audio, heard, at } = listener();
  audio.handle([hitEvent({ x: 80 })]); const left = heard();
  at(11); audio.handle([hitEvent({ x: 1200 })]); const right = heard();
  at(12); audio.handle([hitEvent({ x: 640 })]); const center = heard();
  const pan = layers => layers.tones.map(t => t[7]?.pan ?? 0);
  assert.ok(pan(left).length > 0 && pan(left).every(p => p < -0.3), 'left of center'); assert.ok(pan(right).every(p => p > 0.3), 'right of center'); assert.ok(pan(center).every(p => Math.abs(p) < 0.05), 'centered');
});

test('consecutive hits by one fighter climb a scale; a long gap or a different fighter starts over', () => {
  const { audio, heard, at } = listener();
  // a combo ping is the only 0.1 s sine at level 0.04; tones are raw argument lists [note, at, duration, level, ...]
  const record = (time, actor) => { at(time); audio.handle([hitEvent({ actor })]); return heard().tones.filter(t => t[2] === 0.1 && t[3] === 0.04).map(t => t[0]); };
  assert.deepEqual(record(10, 0), [], 'a single hit has no ping');
  const second = record(10.4, 0), third = record(10.8, 0);
  assert.equal(second.length, 1); assert.equal(third.length, 1); assert.ok(third[0] > second[0], 'the pitch rises');
  assert.deepEqual(record(10.9, 1), [], 'the other fighter starts at one');
  assert.deepEqual(record(13, 1), [], 'a long pause resets the chain');
});

test('heavy hits, ultimates and K.O. dip the score for a moment; light hits do not', () => {
  const { audio, at } = listener(); const ramps = [];
  audio.musicPump = { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime(value) { ramps.push(value); } } };
  audio.handle([hitEvent({ damage: 6 })]); assert.deepEqual(ramps, [], 'light hit');
  at(11); audio.handle([hitEvent({ damage: 30 })]); assert.ok(ramps.includes(0.5), 'heavy hit ducks the score');
  ramps.length = 0; at(12); audio.handle([{ seq: 9, frame: 9, kind: 'skill', actor: 0, id: 'iron_ult', slot: 'ult', x: 640, y: 500 }]); assert.ok(ramps.length >= 2);
  ramps.length = 0; at(13); audio.handle([hitEvent({ damage: 30, armored: true })]); assert.deepEqual(ramps, [], 'an armored hit does not');
});

test('the announcer gets a synthesized riser or impact, and countdown, charge and result cues exist', async () => {
  const { audio, tones, hisses, window } = prepared(); let clock = 1000; window.performance = { now: () => clock };
  await audio.playAnnouncer('round1'); await turn();
  assert.ok(hisses.some(h => h[4]?.attack >= 0.3), 'Round 1 rises'); tones.length = hisses.length = 0;
  await audio.playAnnouncer('fight'); await turn();
  assert.ok(tones.some(t => t[2] >= 0.4 && t[0] < 45), 'Fight lands a sub hit');
  for (const cue of ['count', 'ultReady']) { tones.length = hisses.length = 0; clock += 100; assert.equal(await audio.playUI(cue), true); assert.ok(tones.length >= 1, cue); }
});
