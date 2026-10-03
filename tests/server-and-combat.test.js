'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createGameServer, sanitizeInput } = require('../server.js');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runningServer(t, options = {}) {
  const app = createGameServer({ host: '127.0.0.1', port: 0, introFrames: 0, ...options });
  const address = await app.listen();
  t.after(() => app.close());
  return { app, address, httpUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/ws` };
}

function request(address, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function connect(t, url, options) {
  const ws = new WebSocket(url, options);
  const messages = [];
  const waiters = [];
  ws.on('message', data => {
    const message = JSON.parse(data.toString());
    const waiterIndex = waiters.findIndex(waiter => waiter.predicate(message));
    if (waiterIndex === -1) messages.push(message);
    else {
      const waiter = waiters.splice(waiterIndex, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  await once(ws, 'open');
  t.after(() => { if (ws.readyState !== WebSocket.CLOSED) ws.terminate(); });
  return {
    ws,
    send: message => ws.send(JSON.stringify(message)),
    waitFor(predicate, timeout = 2500) {
      const match = typeof predicate === 'string' ? message => message.type === predicate : predicate;
      const existingIndex = messages.findIndex(match);
      if (existingIndex !== -1) return Promise.resolve(messages.splice(existingIndex, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate: match, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for WebSocket message; received ${messages.map(message => message.type).join(', ')}`));
        }, timeout);
        waiters.push(waiter);
      });
    },
  };
}

async function createPair(t, service, leftCharacter = 'gale', rightCharacter = 'iron') {
  const left = await connect(t, service.wsUrl);
  const right = await connect(t, service.wsUrl);
  left.send({ type: 'create', character: leftCharacter });
  const created = await left.waitFor('room');
  assert.match(created.code, /^\d{6}$/);
  assert.equal(created.seat, 0);
  assert.equal(created.players[1], null);
  right.send({ type: 'join', code: created.code, character: rightCharacter });
  const joined = await right.waitFor('room');
  assert.equal(joined.seat, 1);
  assert.equal(joined.players[0].character, leftCharacter);
  await left.waitFor(message => message.type === 'room' && message.players[1]);
  return { left, right, code: created.code };
}

async function beginBattle(pair) {
  pair.left.send({ type: 'ready', ready: true });
  pair.right.send({ type: 'ready', ready: true });
  const leftState = await pair.left.waitFor(message => message.type === 'room' && message.phase === 'battle');
  const rightState = await pair.right.waitFor(message => message.type === 'room' && message.phase === 'battle');
  assert.deepEqual(leftState.players, rightState.players);
  const first = await pair.left.waitFor('snapshot');
  assert.equal(first.snapshot.fighters.length, 2);
  return first.snapshot;
}

test('input sanitization accepts booleans and ignores client guard state', () => {
  const clean = sanitizeInput({ left: true, right: 1, up: 'true', punch: true, down: true, hp: 99999 });
  assert.equal(clean.left, true);
  assert.equal(clean.punch, true);
  assert.equal(clean.right, false);
  assert.equal(clean.up, false);
  assert.equal(clean.down, false);
  assert.equal(clean.hp, undefined);
});

test('HTTP serves public assets and health without exposing server files or traversal', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'stick-fighter-static-'));
  t.after(async () => {
    const resolved = path.resolve(fixture);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('stick-fighter-static-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  for (const directory of ['assets', 'js', 'css', 'lib', 'tests', '.git']) {
    await fs.mkdir(path.join(fixture, directory));
  }
  for (const [filename, content] of Object.entries({
    'index.html': '<!doctype html><title>Fighter</title>',
    'assets/gale.png': 'public-image',
    'assets/tone.wav': 'public-audio',
    'assets/game.js': 'console.log("public-game")',
    'assets/game.css': 'body { color: blue; }',
    'CREDITS.md': 'Music and artwork credits',
    'lib/combat.ts': 'SECRET-SOURCE',
    'server.js': 'SECRET-SERVER',
    'package.json': 'SECRET-PACKAGE',
    'tests/private.js': 'SECRET-TEST',
    '.git/config': 'SECRET-GIT',
  })) await fs.writeFile(path.join(fixture, filename), content);
  const service = await runningServer(t, { staticRoot: fixture });
  const home = await request(service.address, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Fighter/);
  assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
  const health = await request(service.address, '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true, pid: process.pid });
  for (const url of ['/assets/gale.png', '/assets/tone.wav', '/assets/game.js', '/assets/game.css', '/CREDITS.md']) {
    assert.equal((await request(service.address, url)).status, 200, url);
  }
  assert.equal((await request(service.address, '/assets/game.css')).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await request(service.address, '/CREDITS.md')).headers['content-type'], 'text/plain; charset=utf-8');
  const head = await request(service.address, '/assets/gale.png', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(Number(head.headers['content-length']), 'public-image'.length);
  for (const url of ['/server.js', '/server/index.ts', '/shared/combat.ts', '/src/main.ts', '/package.json', '/tests/private.js', '/node_modules/ws/index.js', '/.git/config', '/lib/combat.ts', '/lib/private.js', '/faces/gale.png', '/assets/../server.js', '/assets/%2e%2e/server.js', '/assets/%2e%2e%2fserver.js', '/assets/%5c..%5cserver.js', '/assets/%00.png']) {
    const response = await request(service.address, url);
    assert.equal(response.status, 404, url);
    assert.doesNotMatch(response.body, /SECRET/, url);
  }
  assert.equal((await request(service.address, '/%zz')).status, 400);
  assert.equal((await request(service.address, '/', 'POST')).status, 405);
});

test('two real clients select, ready, receive common authority snapshots, and leave cleanly', async t => {
  const service = await runningServer(t);
  const pair = await createPair(t, service);
  pair.left.send({ type: 'select', character: 'shadow' });
  const selected = await pair.right.waitFor(message => message.type === 'room' && message.players[0].character === 'shadow');
  assert.equal(selected.players[0].ready, false);
  const initial = await beginBattle(pair);
  assert.equal(initial.intro, 0);
  const advancing = await pair.right.waitFor(message => message.type === 'snapshot' && message.snapshot.frame > initial.frame);
  assert.ok(advancing.snapshot.timeLeft <= initial.timeLeft);
  pair.left.send({ type: 'ping', at: 123456 });
  assert.deepEqual(await pair.left.waitFor('pong'), { type: 'pong', at: 123456 });
  pair.left.send({ type: 'leave' });
  assert.match((await pair.right.waitFor('left')).message, /离开/);
  await pair.left.waitFor('left');
  assert.equal(service.app.rooms.size, 0);
  pair.right.send({ type: 'create', character: 'bastion' });
  assert.equal((await pair.right.waitFor(message => message.type === 'room' && message.code !== pair.code)).phase, 'lobby');
});

test('out-of-order inputs cannot overwrite movement or repeat actions; idle input is cleared', async t => {
  const service = await runningServer(t, { inputTimeoutMs: 120 });
  const pair = await createPair(t, service);
  await beginBattle(pair);
  const room = service.app.rooms.get(pair.code);
  const recorded = [];
  const originalStep = room.world.step.bind(room.world);
  room.world.step = inputs => {
    recorded.push(inputs.map(input => ({ ...input })));
    return originalStep(inputs);
  };
  pair.left.send({ type: 'input', seq: 10, input: { right: true, punch: true, down: true, skill1: 1 } });
  pair.left.send({ type: 'input', seq: 10, input: { left: true, punch: true } });
  pair.left.send({ type: 'input', seq: 9, input: { left: true, punch: true } });
  await delay(85);
  const activeFrames = recorded.filter(inputs => inputs[0].right);
  assert.ok(activeFrames.length >= 2, 'held movement reaches more than one authoritative frame');
  assert.equal(recorded.filter(inputs => inputs[0].punch).length, 1);
  assert.ok(recorded.every(inputs => !inputs[0].left && !inputs[0].down && !inputs[0].skill1));
  await delay(130);
  assert.equal(recorded.at(-1)[0].right, false, 'idle input cannot keep moving');
  pair.left.send({ type: 'input', seq: 11, input: { left: true, punch: true } });
  await delay(50);
  assert.ok(recorded.some(inputs => inputs[0].left));
  assert.equal(recorded.filter(inputs => inputs[0].punch).length, 2);
});

test('missing and full rooms and invalid characters return errors without corrupting the room', async t => {
  const service = await runningServer(t, { maxRooms: 1 });
  const pair = await createPair(t, service);
  const third = await connect(t, service.wsUrl);
  third.send({ type: 'join', code: pair.code, character: 'pyro' });
  assert.match((await third.waitFor('error')).message, /已满/);
  third.send({ type: 'join', code: '11111', character: 'pyro' });
  assert.match((await third.waitFor('error')).message, /六位/);
  third.send({ type: 'create', character: 'invalid-character' });
  assert.match((await third.waitFor('error')).message, /有效角色/);
  third.send({ type: 'create', character: 'pyro' });
  assert.match((await third.waitFor('error')).message, /房间已满/);
  pair.left.send({ type: 'select', character: 'missing' });
  assert.match((await pair.left.waitFor('error')).message, /有效角色/);
  assert.equal(service.app.rooms.get(pair.code).players[0].character, 'gale');
  pair.left.ws.send('{malformed-json');
  assert.match((await pair.left.waitFor('error')).message, /格式/);
  pair.left.send({ type: 'ping', at: 88 });
  assert.equal((await pair.left.waitFor('pong')).at, 88);
  pair.left.send({ type: 'leave' });
  await pair.right.waitFor('left');
  third.send({ type: 'join', code: pair.code, character: 'pyro' });
  assert.match((await third.waitFor('error')).message, /不存在/);
});

test('timeout results require both clients to request a rematch', async t => {
  const service = await runningServer(t, { duration: 1 });
  const pair = await createPair(t, service);
  await beginBattle(pair);
  const result = await pair.left.waitFor(message => message.type === 'snapshot' && message.snapshot.result, 3000);
  assert.equal(result.snapshot.result.reason, 'timeout');
  await pair.right.waitFor(message => message.type === 'snapshot' && message.snapshot.result);
  pair.left.send({ type: 'rematch' });
  const waiting = await pair.right.waitFor(message => message.type === 'room' && message.phase === 'result' && message.players[0].ready);
  assert.equal(waiting.players[1].ready, false);
  assert.equal(service.app.rooms.get(pair.code).phase, 'result');
  pair.right.send({ type: 'rematch' });
  await pair.left.waitFor(message => message.type === 'room' && message.phase === 'battle');
  const restart = await pair.left.waitFor(message => message.type === 'snapshot' && !message.snapshot.result);
  assert.ok(restart.snapshot.frame < result.snapshot.frame);
  assert.ok(restart.snapshot.timeLeft > result.snapshot.timeLeft);
});

test('final result reaches a client even when replaceable motion frames are buffered', async t => {
  const service = await runningServer(t);
  const pair = await createPair(t, service);
  await beginBattle(pair);
  const room = service.app.rooms.get(pair.code);
  // Model a small outgoing backlog, below the connection's safety limit.
  Object.defineProperty(room.players[0].ws, 'bufferedAmount', { configurable: true, get: () => 1 });
  room.world._debug.setTimeLeft(.05);
  const result = await pair.left.waitFor(message => message.type === 'snapshot' && message.snapshot.result);
  assert.equal(result.snapshot.result.reason, 'timeout');
  assert.equal(room.phase, 'result');
});

test('disconnect destroys the room and lets the other client return to the lobby', async t => {
  const service = await runningServer(t);
  const pair = await createPair(t, service);
  await beginBattle(pair);
  pair.left.ws.terminate();
  assert.match((await pair.right.waitFor('left')).message, /连接已中断/);
  assert.equal(service.app.rooms.size, 0);
  pair.right.send({ type: 'create', character: 'iron' });
  assert.equal((await pair.right.waitFor(message => message.type === 'room' && message.code !== pair.code)).seat, 0);
});

test('message, payload, and connection limits reject abuse without stopping the server', async t => {
  const service = await runningServer(t, { maxMessagesPerSecond: 3, maxPayload: 256, maxConnections: 2 });
  const noisy = await connect(t, service.wsUrl);
  const closed = once(noisy.ws, 'close');
  for (let at = 0; at < 4; at++) noisy.send({ type: 'ping', at });
  const rateError = await noisy.waitFor('error');
  assert.match(rateError.message, /频繁/);
  assert.equal((await closed)[0], 1008);
  const oversized = await connect(t, service.wsUrl);
  const oversizedClosed = once(oversized.ws, 'close');
  oversized.ws.send('x'.repeat(257));
  assert.equal((await oversizedClosed)[0], 1009);
  const first = await connect(t, service.wsUrl);
  const second = await connect(t, service.wsUrl);
  const rejected = new WebSocket(service.wsUrl);
  t.after(() => rejected.terminate());
  const [error] = await once(rejected, 'error');
  assert.match(error.message, /503/);
  first.send({ type: 'ping', at: 7 });
  assert.equal((await first.waitFor('pong')).at, 7);
  second.send({ type: 'ping', at: 8 });
  assert.equal((await second.waitFor('pong')).at, 8);
  assert.equal((await request(service.address, '/health')).status, 200);
});

test('WebSocket heartbeats remove a peer that stops answering pings', async t => {
  const service = await runningServer(t, { heartbeatIntervalMs: 60 });
  const stopped = await connect(t, service.wsUrl, { autoPong: false });
  const closed = once(stopped.ws, 'close');
  assert.equal((await closed)[0], 1006);
  assert.equal((await request(service.address, '/health')).status, 200);
});

const combat = require('../shared/combat.ts');
const emptyInputs = [{}, {}];

function localWorld(options = {}) {
  return combat.createWorld({ left: 'gale', right: 'gale', mode: 'pvp', introFrames: 0, seed: 41, ...options });
}

function advance(world, frames, inputs = emptyInputs) {
  for (let i = 0; i < frames; i++) world.step(inputs);
}

test('ground movement stops on release, idle stays fixed, and jumping retains momentum', () => {
  for (const character of combat.characters) {
    const world = localWorld({ left: character.id });
    const fighter = world.fighters[0];
    advance(world, 12, [{ right: true }, {}]);
    assert.equal(fighter.state, 'walk');
    assert.ok(fighter.vx > 0 && fighter.walkPhase > 0);
    const stoppedX = fighter.x, stoppedPhase = fighter.walkPhase;
    advance(world, 30);
    assert.equal(fighter.state, 'idle');
    assert.equal(fighter.vx, 0);
    assert.equal(fighter.x, stoppedX, character.id + ' does not coast while idle');
    assert.equal(fighter.walkPhase, stoppedPhase);
    advance(world, 8, [{ right: true }, {}]);
    world.step([{ right: true, up: true }, {}]);
    const airborneX = fighter.x;
    world.step(emptyInputs);
    assert.equal(fighter.state, 'jump');
    assert.ok(fighter.x > airborneX && fighter.vx > 0, character.id + ' retains airborne momentum');
  }
});

test('walking cadence follows resolved distance and stops against walls and opponents', () => {
  const { WALK_CYCLE_DISTANCE, cyclePhase } = require('../shared/locomotion.ts');
  for (const character of combat.characters) {
    const world = localWorld({ left: character.id });
    const fighter = world.fighters[0];
    for (let i = 0; i < 20; i++) {
      const x = fighter.x, phase = fighter.walkPhase;
      world.step([{ right: true }, {}]);
      const expected = cyclePhase(phase + Math.abs(fighter.x - x) / WALK_CYCLE_DISTANCE);
      assert.ok(Math.abs(fighter.walkPhase - expected) < 1e-9, character.id + ' distance controls cadence');
    }
    fighter.x = 70;
    fighter.vx = -5.15;
    const wallPhase = fighter.walkPhase;
    advance(world, 30, [{ left: true }, {}]);
    assert.equal(fighter.x, 70);
    assert.equal(fighter.walkPhase, wallPhase, character.id + ' does not walk through a wall');
    assert.equal(fighter.state, 'idle');
    assert.equal(fighter.vx, 0);
    fighter.x = 500;
    world.fighters[1].x = 578;
    const x = fighter.x, phase = fighter.walkPhase;
    world.step([{ right: true }, {}]);
    assert.ok(Math.abs(fighter.walkPhase - cyclePhase(phase + Math.abs(fighter.x - x) / WALK_CYCLE_DISTANCE)) < 1e-9);
    assert.ok(fighter.x - x < fighter.vx, 'opponent collision reduces the animated travel distance');
  }
});

test('foot contacts are detected when a step skips a phase window', () => {
  const { crossedFootPlant, WALK_CYCLE_DISTANCE } = require('../shared/locomotion.ts');
  assert.equal(crossedFootPlant(.49, WALK_CYCLE_DISTANCE * .08), true);
  assert.equal(crossedFootPlant(.98, WALK_CYCLE_DISTANCE * .08), true);
  assert.equal(crossedFootPlant(.1, WALK_CYCLE_DISTANCE * .08), false);
  assert.equal(crossedFootPlant(.5, 0), false);
});

function simultaneousPunches(hp = 600) {
  const world = localWorld();
  const [left, right] = world.fighters;
  left.x = 500; right.x = 578;
  left.hp = right.hp = hp;
  left.state = right.state = 'punch';
  left.stateT = right.stateT = 4;
  world.step(emptyInputs);
  return world;
}

test('the shared ES combat module bundles for browsers without DOM dependencies', async () => {
  const vm = require('node:vm');
  const { buildSync } = require('esbuild');
  const source = buildSync({ entryPoints: [path.join(__dirname, '../shared/combat.ts')], bundle: true, write: false, format: 'iife', globalName: 'AveCombat' }).outputFiles[0].text;
  const browser = {};
  vm.runInNewContext(source, browser, { filename: 'combat.ts', timeout: 1000 });
  assert.equal(typeof browser.AveCombat.createWorld, 'function');
  const world = browser.AveCombat.createWorld({ mode: 'pvp', introFrames: 0 });
  const startX = world.snapshot().fighters[0].x;
  world.step([{ right: true }, {}]);
  assert.ok(world.snapshot().fighters[0].x > startX);
  assert.equal(browser.document, undefined);
});

test('simultaneous melee attacks trade fairly, including lethal double KO', () => {
  const trade = simultaneousPunches().snapshot();
  assert.deepEqual(trade.fighters.map(fighter => fighter.hp), [588.8, 588.8]);
  assert.deepEqual(trade.fighters.map(fighter => fighter.state), ['stun', 'stun']);
  assert.equal(trade.events.filter(event => event.kind === 'hit').length, 2);
  const lethal = simultaneousPunches(10).snapshot();
  assert.deepEqual(lethal.fighters.map(fighter => fighter.hp), [0, 0]);
  assert.deepEqual(lethal.result, { winner: null, reason: 'double-ko' });
  assert.equal(lethal.events.filter(event => event.kind === 'ko').length, 2);
});

test('same-frame grabs are queued before either fighter is interrupted', () => {
  const world = localWorld({ left: 'iron', right: 'iron' });
  const [left, right] = world.fighters;
  left.x = 500; right.x = 578;
  for (const fighter of world.fighters) {
    fighter.state = 'skill'; fighter.skillMove = 'iron_s0'; fighter.stateT = 9;
  }
  world.step(emptyInputs);
  assert.ok(Math.abs(left.hp - right.hp) < 1e-10);
  assert.ok(left.hp < 600 && right.hp < 600);
  assert.equal(world.snapshot().events.filter(event => event.kind === 'hit').length, 2);
});

test('shadow ultimate switches sides on all five teleports', () => {
  const world = localWorld({ left: 'shadow' });
  const [shadow, target] = world.fighters;
  target.invuln = 1000;
  shadow.mp = 200;
  world.step([{ ult: true }, {}]);
  const directions = [];
  for (let i = 0; i < 38; i++) {
    world.step(emptyInputs);
    if ([6, 14, 22, 30, 38].includes(shadow.stateT)) {
      directions.push(Math.sign(shadow.x - target.x));
    }
  }
  assert.deepEqual(directions, [-1, 1, -1, 1, -1]);
});

test('both pyro curtains reach opponents near either wall from either player seat', () => {
  for (const seat of [0, 1]) for (const targetX of [combat.constants.LEFT_WALL + 50, combat.constants.RIGHT_WALL - 50]) {
    const world = localWorld({ left: seat === 0 ? 'pyro' : 'gale', right: seat === 1 ? 'pyro' : 'gale' });
    const target = world.fighters[1 - seat];
    target.x = targetX;
    const input = [{}, {}]; input[seat] = { special: true };
    world.step(input);
    const hits = new Map();
    for (let frame = 0; frame < 240; frame++) {
      world.step(emptyInputs);
      for (const event of world.snapshot().events) {
        if (event.kind === 'hit' && event.id === 'pyro_s0') hits.set(event.seq, event);
      }
    }
    assert.equal(hits.size, 2, `seat ${seat}, target x=${targetX}: both curtains must arrive`);
    assert.ok([...hits.values()].every(hit => hit.actor === seat && hit.target === 1 - seat));
    assert.ok(Math.abs(target.hp - (target.maxHp - 2 * 15.8 * 2.1)) < 1e-8);
    assert.equal(world.snapshot().projectiles.length, 0, 'each curtain is consumed by its hit');
  }
});

test('missed pyro curtains pass the arena center and only expire outside the arena', () => {
  const world = localWorld({ left: 'pyro' });
  const target = world.fighters[1];
  world.step([{ special: true }, {}]);
  advance(world, 9);
  assert.equal(world.snapshot().projectiles.length, 2);
  for (let frame = 0; frame < 90; frame++) {
    target.y = 100; target.vy = 0;
    world.step(emptyInputs);
  }
  const curtains = world.snapshot().projectiles;
  assert.equal(curtains.length, 2, 'curtains must survive the old 80-frame limit');
  assert.ok(curtains.find(p => p.vx > 0).x > combat.constants.CANVAS_W / 2);
  assert.ok(curtains.find(p => p.vx < 0).x < combat.constants.CANVAS_W / 2);
  for (let frame = 0; frame < 100; frame++) {
    target.y = 100; target.vy = 0;
    world.step(emptyInputs);
  }
  assert.equal(target.hp, target.maxHp, 'dodging still avoids damage');
  assert.equal(world.snapshot().projectiles.length, 0, 'missed curtains do not accumulate beyond the arena');
});

test('pyro meteor reaches the ground, explodes, and expires instead of vanishing in the air', () => {
  const world = localWorld({ left: 'pyro' });
  const [pyro, target] = world.fighters;
  pyro.mp = 200;
  world.step([{ ult: true }, {}]);
  target.x = 800;
  let exploded = false;
  let peakY = 0;
  for (let i = 0; i < 70; i++) {
    world.step(emptyInputs);
    for (const hazard of world.snapshot().hazards) {
      peakY = Math.max(peakY, hazard.y);
      if (hazard.type === 'boom') {
        exploded = true;
        assert.equal(hazard.y, combat.constants.GROUND);
        assert.ok(hazard.life > 0);
      }
    }
  }
  assert.ok(exploded);
  assert.equal(peakY, combat.constants.GROUND);
  assert.equal(world.snapshot().hazards.length, 0);
});

test('timer excludes intro and ends with distinct timeout and KO reasons', () => {
  const world = localWorld({ duration: 1, introFrames: 2 });
  world.fighters[0].hp = 450;
  world.fighters[1].hp = 300;
  advance(world, 2);
  assert.equal(world.snapshot().intro, 0);
  assert.equal(world.snapshot().timeLeft, 1);
  advance(world, 60);
  assert.deepEqual(world.getResult(), { winner: 0, reason: 'timeout' });
  assert.equal(world.snapshot().timeLeft, 0);
  const frozenFrame = world.snapshot().frame;
  world.step([{ ult: true }, { ult: true }]);
  assert.equal(world.snapshot().frame, frozenFrame);
  const equal = localWorld({ duration: 1 });
  advance(equal, 60);
  assert.deepEqual(equal.getResult(), { winner: null, reason: 'timeout' });
  const ko = localWorld();
  const [left, right] = ko.fighters;
  left.x = 500; right.x = 578; right.hp = 1;
  left.state = 'punch'; left.stateT = 4;
  ko.step(emptyInputs);
  assert.deepEqual(ko.getResult(), { winner: 0, reason: 'ko' });
});

test('short input buffer accepts an action near recovery and discards an old press', () => {
  const readySoon = localWorld();
  const fighter = readySoon.fighters[0];
  fighter.state = 'punch'; fighter.stateT = 18;
  readySoon.step([{ skill1: true }, {}]);
  advance(readySoon, 5);
  assert.equal(fighter.skillMove, 'gale_s1');
  const tooEarly = localWorld();
  const slow = tooEarly.fighters[0];
  slow.state = 'punch'; slow.stateT = 0;
  tooEarly.step([{ skill1: true }, {}]);
  advance(tooEarly, 30);
  assert.equal(slow.skillMove, null);
  assert.equal(slow.cd1, 0);
  const cooldown = localWorld();
  cooldown.fighters[0].cd1 = 3;
  cooldown.step([{ skill1: true }, {}]);
  advance(cooldown, 2);
  assert.equal(cooldown.fighters[0].skillMove, 'gale_s1');
});

test('no guard input changes damage; armor and invulnerability keep original semantics', () => {
  const world = localWorld({ left: 'iron' });
  const [left, right] = world.fighters;
  left.armor = 120;
  left.state = 'skill'; left.skillMove = 'iron_s1';
  assert.equal(left.takeHit({ dmg: 40, kb: 10, stun: 15, kind: 'skill' }, right), true);
  assert.equal(left.hp, 571.2);
  assert.equal(left.state, 'skill');
  left.invuln = 10;
  assert.equal(left.takeHit({ dmg: 40, kb: 10, stun: 15, kind: 'skill' }, right), false);
  assert.equal(left.hp, 571.2);
  const guardAttempt = localWorld();
  const ordinary = localWorld();
  for (const candidate of [guardAttempt, ordinary]) {
    candidate.fighters[0].x = 500; candidate.fighters[1].x = 578;
  }
  guardAttempt.step([{ punch: true }, { down: true }]);
  ordinary.step([{ punch: true }, {}]);
  advance(guardAttempt, 5); advance(ordinary, 5);
  assert.deepEqual(guardAttempt.snapshot(), ordinary.snapshot());
});

test('all twenty original skills start, respect resources, complete, and keep finite state', () => {
  const actions = { s0: 'special', s1: 'skill1', s2: 'skill2', ult: 'ult' };
  for (const character of combat.characters) {
    for (const [slot, action] of Object.entries(actions)) {
      const world = localWorld({ left: character.id });
      const [fighter, target] = world.fighters;
      fighter.x = 500; target.x = 650; target.invuln = 1000;
      fighter.mp = 200;
      world.step([{ [action]: true }, {}]);
      assert.equal(fighter.skillMove, `${character.id}_${slot}`);
      if (slot === 'ult') assert.equal(fighter.mp, 0);
      else assert.ok(fighter['cd' + slot.slice(1)] > 0);
      advance(world, 180);
      assert.notEqual(fighter.state, 'skill', `${character.id}_${slot} finishes`);
      for (const key of ['x', 'y', 'vx', 'vy', 'hp', 'mp', 'cd0', 'cd1', 'cd2']) {
        assert.ok(Number.isFinite(fighter[key]), `${character.id}_${slot}: ${key}`);
      }
    }
  }
});

test('world RNG and state are isolated, deterministic, and snapshots contain no fighter references', () => {
  const a = combat.createWorld({ mode: 'pve', introFrames: 0, seed: 123 });
  const b = combat.createWorld({ mode: 'pve', introFrames: 0, seed: 123 });
  const noise = combat.createWorld({ mode: 'pve', introFrames: 0, seed: 777 });
  for (let frame = 0; frame < 500; frame++) {
    const input = { right: frame < 80, punch: frame % 25 === 0, special: frame % 100 === 0 };
    a.step([input, {}]); noise.step([{ left: true, skill1: true }, {}]); b.step([input, {}]);
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const before = b.snapshot();
  a.fighters[0].hp = 1;
  assert.deepEqual(b.snapshot(), before);
  const snapshot = b.snapshot();
  snapshot.fighters[0].hp = -999;
  snapshot.events.push({ seq: -99 });
  assert.deepEqual(b.snapshot(), before);
  assert.ok(snapshot.fighters.every(fighter => !('def' in fighter)));
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  const projectileWorld = localWorld({ left: 'pyro' });
  projectileWorld.step([{ skill1: true }, {}]);
  advance(projectileWorld, 11);
  const projectile = projectileWorld.snapshot().projectiles[0];
  assert.equal(projectile.owner, 0);
  projectile.x = -10000;
  assert.notEqual(projectileWorld.snapshot().projectiles[0].x, -10000);
});

test('event sequence stays monotonic while old events expire to bound network snapshots', () => {
  const world = localWorld();
  const seen = [];
  for (let frame = 0; frame < 300; frame++) {
    world.step([{ punch: frame % 24 === 0 }, {}]);
    const snapshot = world.snapshot();
    assert.ok(snapshot.events.length <= 180);
    assert.ok(snapshot.events.every(event => event.frame >= snapshot.frame - 12));
    for (const event of snapshot.events) if (!seen.includes(event.seq)) seen.push(event.seq);
  }
  assert.ok(seen.length > 10);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.ok(world.snapshot().events[0].seq > 1);
});
