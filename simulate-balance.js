"use strict";

// Runs the real combat code from the HTML in a tiny headless DOM. This keeps the
// balance report aligned with the game instead of maintaining a second ruleset.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const gamePath = path.join(__dirname, "Ave Mujica乱斗.html");
const html = fs.readFileSync(gamePath, "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!match) throw new Error("Game script not found");

const initAt = match[1].lastIndexOf("\n  bindTouchPad();");
if (initAt < 0) throw new Error("Game initialization marker not found");

let body = match[1].slice(0, initAt);
const facesAt = body.indexOf("const EMBEDDED_FACES = {");
if (facesAt >= 0) {
  const facesEnd = body.indexOf("\n  };", facesAt);
  if (facesEnd > facesAt) {
    body = `${body.slice(0, facesAt)}const EMBEDDED_FACES = {};${body.slice(facesEnd + 5)}`;
  }
}
body = body.replace("let headless = false;", "let headless = true;");

const expose = `
  burst = function () {};
  playSfx = function () {};
  impactSound = function () {};
  impactRings.push = function () { return this.length; };
  combatFeedback.push = function () { return this.length; };

  function simThink(me, opponent) {
    player = opponent;
    cpu = me;
    return cpuThink();
  }

  function simReset(left, right, difficulty) {
    selection.difficulty = difficulty || "hard";
    player = left;
    cpu = right;
    projectiles.length = 0;
    hazards.length = 0;
    particles.length = 0;
    afterimages.length = 0;
    combatFeedback.length = 0;
    impactRings.length = 0;
    hitstop = 0;
    shake = 0;
  }

  function simStep(left, right) {
    player = left;
    cpu = right;
    if (hitstop > 0) {
      hitstop -= 1;
      return false;
    }
    const leftInput = simThink(left, right);
    const rightInput = simThink(right, left);
    player = left;
    cpu = right;
    left.update(leftInput, right);
    right.update(rightInput, left);
    pushApart();
    resolveHits();
    particles.length = 0;
    afterimages.length = 0;
    return true;
  }

  globalThis.__balanceGame = {
    characters: CHARACTERS,
    Fighter,
    reset: simReset,
    step: simStep,
  };
})();`;

const source = `${body}\n${expose}`;

function makeElement() {
  const element = {
    style: {},
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    width: 1280,
    height: 720,
    clientWidth: 1280,
    clientHeight: 720,
    offsetLeft: 0,
    offsetTop: 0,
    parentElement: null,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    getContext() { return context2d; },
  };
  element.parentElement = element;
  return element;
}

const context2d = new Proxy({
  measureText(text) { return { width: String(text).length * 10 }; },
  createLinearGradient() { return { addColorStop() {} }; },
  createRadialGradient() { return { addColorStop() {} }; },
}, {
  get(target, key) {
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

const elements = new Map();
const math = Object.create(Math);
let randomState = 1;
math.random = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
};

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  Math: math,
  Date,
  Promise,
  Uint8Array,
  setTimeout() { return 0; },
  clearTimeout() {},
  requestAnimationFrame() { return 0; },
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {} },
  screen: { orientation: { lock: () => Promise.resolve() } },
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement() { return makeElement(); },
  },
  Image: class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
    }
    set src(value) { this._src = value; }
    get src() { return this._src; }
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: gamePath });

const game = sandbox.__balanceGame;
const roundsPerSide = Math.max(1, Number(process.argv[2]) || 100);
const difficulty = process.argv[3] || "hard";
const baseSeed = Number(process.argv[4]) || 0x51f15e;
const maxActiveFrames = 99 * 60;

function seed(value) {
  randomState = value >>> 0 || 1;
}

function fight(leftDef, rightDef, seedValue) {
  seed(seedValue);
  const left = new game.Fighter(leftDef, 280, 1, true);
  const right = new game.Fighter(rightDef, 1000, -1, true);
  game.reset(left, right, difficulty);
  let activeFrames = 0;
  let safetyFrames = 0;
  while (!left.dead && !right.dead && activeFrames < maxActiveFrames && safetyFrames < maxActiveFrames * 2) {
    if (game.step(left, right)) activeFrames += 1;
    safetyFrames += 1;
  }
  if (left.dead && right.dead) return 0;
  if (right.dead) return 1;
  if (left.dead) return -1;
  if (left.hp > right.hp) return 1;
  if (right.hp > left.hp) return -1;
  return 0;
}

const stats = new Map(game.characters.map((character) => [character.id, {
  id: character.id,
  name: character.name,
  wins: 0,
  losses: 0,
  draws: 0,
  matches: 0,
}]));
const matrix = [];
let matchSeed = baseSeed;

for (let i = 0; i < game.characters.length; i += 1) {
  for (let j = i + 1; j < game.characters.length; j += 1) {
    const a = game.characters[i];
    const b = game.characters[j];
    let aWins = 0;
    let bWins = 0;
    let draws = 0;
    for (let round = 0; round < roundsPerSide; round += 1) {
      let result = fight(a, b, matchSeed++);
      if (result > 0) aWins += 1;
      else if (result < 0) bWins += 1;
      else draws += 1;

      result = fight(b, a, matchSeed++);
      if (result > 0) bWins += 1;
      else if (result < 0) aWins += 1;
      else draws += 1;
    }
    const sa = stats.get(a.id);
    const sb = stats.get(b.id);
    sa.wins += aWins; sa.losses += bWins; sa.draws += draws; sa.matches += roundsPerSide * 2;
    sb.wins += bWins; sb.losses += aWins; sb.draws += draws; sb.matches += roundsPerSide * 2;
    matrix.push({ matchup: `${a.name} vs ${b.name}`, aWins, bWins, draws });
  }
}

const summary = [...stats.values()].map((entry) => ({
  角色: entry.name,
  胜: entry.wins,
  负: entry.losses,
  平: entry.draws,
  胜率: `${((entry.wins + entry.draws * 0.5) / entry.matches * 100).toFixed(1)}%`,
}));

console.log(`AI balance simulation: ${roundsPerSide} rounds/side, ${difficulty} difficulty, seed ${baseSeed}`);
console.table(summary);
console.table(matrix.map((entry) => ({
  对局: entry.matchup,
  前者胜: entry.aWins,
  后者胜: entry.bWins,
  平: entry.draws,
})));
