import type { Action, AttackBox, Character, CharacterId, CombatEvent, CombatEventDetail, CombatEventKind, Difficulty, FighterSnapshot, FighterState, Hazard, Hit, HitSpec, Input, MatchResult, Projectile, Rect, Seat, SkillActionSlot, SkillMove, SkillSlot, Snapshot, WorldOptions } from './types';
import { crossedFootPlant, cyclePhase, WALK_CYCLE_DISTANCE } from './locomotion';
import { ARENA } from './arena';
import { AI_DIFFICULTIES, createAiMemory, thinkAi } from './ai';
import type { AiMemory } from './ai';
interface ImpactRing { x: number; y: number; life: number; max: number; radius: number; speed: number; color: string }
  const CANVAS_W = ARENA.width, CANVAS_H = ARENA.height, GROUND = ARENA.ground, SIZE = 1.5;
  const GRAVITY = 0.82, LEFT_WALL = ARENA.leftWall, RIGHT_WALL = ARENA.rightWall, MAX_MP = 200;
  const SKILL_DAMAGE_SCALE = 2.1, ULT_DAMAGE_SCALE = 2;
  const ACTIONS: readonly Action[] = ["up", "punch", "special", "skill1", "skill2", "ult"];
  const SLOT_ACTION: Record<SkillSlot | Action, Action> = { up: 'up', special: 'special', skill1: 'skill1', skill2: 'skill2', punch: "punch", s0: "special", s1: "skill1", s2: "skill2", ult: "ult" };
  function deepFreeze<T extends object>(value: T) {
    Object.values(value).forEach((entry) => { if (entry && typeof entry === "object") deepFreeze(entry); });
    return Object.freeze(value);
  }
  function sanitizeInput(raw: unknown): Input {
    const source = raw && typeof raw === "object" ? raw as Partial<Record<keyof Input, unknown>> : {};
    const input: Input = { left: source.left === true, right: source.right === true, down: false,
      up: false, punch: false, special: false, skill1: false, skill2: false, ult: false };
    ACTIONS.forEach((key) => { input[key] = source[key] === true; });
    return input;
  }
  function rectsOverlap(a: Rect, b: Rect) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function removeAtSwap<T>(list: T[], index: number) {
    const last = list.length - 1;
    if (index !== last) list[index] = list[last];
    list.pop();
  }
  const CHARACTERS: Character[] = [
    {
      id: "gale",
      name: "睦",
      color: "#c5e0d0",
      accent: "#f8fafc",
      thick: 3.6,
      hp: 600,
      speed: 5.15,
      jump: 14,
      airJumps: 0,
      punch: { name: "……", dmg: 11.2, kb: 6.5, stun: 14, reach: 55, startup: 5, active: 7, recover: 10 },
      s0: { name: "剪掉坠线", cd: 244, hint: "跃起后折返俯冲砸击。", detail: "最长 0.57 秒，落地提前结束。前 0.20 秒上升（水平速度 5.4，垂直初速 18），随后转向对手俯冲（水平 9.5，垂直 7.5）。0.22–0.38 秒可命中：伤害 35.7，击退 13，硬直 0.33 秒。判定 117×138。冷却 4.07 秒。" },
      s1: { name: "睦不在", cd: 180, hint: "闪现突进，途中短暂无敌，穿招、追人、换边。", detail: "持续 0.27 秒。每秒位移 780，总位移 208。前 0.08 秒完全无敌。全程可命中：伤害 22.7，击退 8，硬直 0.22 秒。判定 105×105。冷却 3.00 秒。" },
      s2: { name: "再死一次", cd: 229, hint: "三刀连斩，最后一刀最重。", detail: "持续 0.57 秒。每秒位移 330，总位移 187。第一刀 0.10–0.15 秒伤害 16.4、击退 5；第二刀 0.23–0.28 秒伤害 16.4、击退 5；第三刀 0.37–0.43 秒伤害 25.2、击退 9。每刀硬直 0.20 秒。三刀全中合计 58.0。判定 96×75。冷却 3.82 秒。" },
      ult: { name: "人偶剧开演", cost: 200, hint: "瞬到身侧连落三道闪电，贴身清场。", detail: "耗蓝 200。持续 0.70 秒。前 0.30 秒无敌。0.13 / 0.30 / 0.47 秒时瞬移到对手身侧 72 像素并落雷。前两波 0.13–0.20、0.30–0.37 秒各伤害 26、击退 8；第三波 0.47–0.57 秒伤害 40、击退 14。每波硬直 0.28 秒。全中合计 92。判定 168×150。" },
      tag: "Mortis",
    },
    {
      id: "iron",
      name: "喵梦",
      color: "#aa4477",
      accent: "#f4c6d7",
      thick: 7.2,
      hp: 600,
      speed: 5.15,
      jump: 14,
      airJumps: 0,
      punch: { name: "出镜", dmg: 11.2, kb: 6.5, stun: 14, reach: 55, startup: 5, active: 7, recover: 10 },
      s0: { name: "拍了没", cd: 243, hint: "近身抓住抛飞，命中回复蓝量。", detail: "持续 0.43 秒。前 0.15 秒每秒靠近 210。0.17 秒时抓取：水平距离小于 104、垂直小于 90。只有打中才生效：把对手拉到身前 54 像素，伤害 37.4，击退 13，硬直 0.33 秒，自身回复 55 蓝并转身。冷却 4.05 秒。" },
      s1: { name: "镜头别停", cd: 229, hint: "停手获得长时间霸体。", detail: "动作 0.43 秒，无攻击判定。获得 2.00 秒霸体：近战受伤为 72%，远程受伤为 69%，不进硬直，击退仅保留 18%。冷却 3.82 秒。" },
      s2: { name: "我要出镜", cd: 211, hint: "带霸体肩撞贴脸。", detail: "持续 0.38 秒。前 0.50 秒霸体（近战受伤 72%，远程 69%，不硬直）。每秒位移 432，总位移 166。0.10–0.23 秒可命中：伤害 38.2，击退 10，硬直 0.27 秒。判定 108×99。冷却 3.52 秒。" },
      ult: { name: "今晚热搜", cost: 200, hint: "三记砸地越来越重，接近全程霸体。", detail: "耗蓝 200。持续 0.93 秒。前 0.67 秒霸体。第一记 0.20–0.27 秒伤害 32、击退 9；第二记 0.40–0.47 秒伤害 32、击退 9；第三记 0.63–0.73 秒伤害 46、击退 15。每记硬直 0.30 秒。全中合计 110。判定 168×114。" },
      tag: "Amoris",
    },
    {
      id: "shadow",
      name: "初华",
      color: "#bb9955",
      accent: "#f3e0b8",
      thick: 4.4,
      hp: 600,
      speed: 5.15,
      jump: 14,
      airJumps: 0,
      punch: { name: "对不起", dmg: 11.2, kb: 6.5, stun: 14, reach: 55, startup: 5, active: 7, recover: 10 },
      s0: { name: "弦在哭", cd: 365, hint: "自损换无敌，刷新另两技能并灌满蓝。", detail: "持续 0.37 秒。0.12 秒时自损 24 生命（至少留 1），立刻刷新另两个技能冷却，蓝量灌满 200，并获得 0.53 秒无敌。不对敌人造成伤害。冷却 6.08 秒。" },
      s1: { name: "面具戴好", cd: 291, hint: "瞬到背后补一记重斩。", detail: "持续 0.37 秒。0.13 秒时瞬到对手背后 58 像素，并获得 0.23 秒无敌。0.17–0.23 秒可命中：伤害 35.7，击退 9，硬直 0.27 秒。判定 129×120。冷却 4.85 秒。" },
      s2: { name: "小祥等等", cd: 291, hint: "影子现身，近身打断并抽蓝。", detail: "持续 0.40 秒。0.17 秒时近身判定：水平小于 145、垂直小于 105。命中不造成伤害，抽取最多 40 蓝（自己获得其中 60%，最多 24），使对手硬直 0.40 秒、速度清零并打断当前技能。冷却 4.85 秒。" },
      ult: { name: "我来守护你", cost: 200, hint: "五次闪现连斩，用来收残血。", detail: "耗蓝 200。持续 0.83 秒。前 0.60 秒无敌。0.10 / 0.23 / 0.37 / 0.50 / 0.63 秒时闪现到对手左右 52 像素。五段各伤害 18.4、击退 6、硬直 0.15 秒。全中合计 92.0。判定 120×117。" },
      tag: "Doloris",
    },
    {
      id: "pyro",
      name: "祥子",
      color: "#7799cc",
      accent: "#dbe7f7",
      thick: 4.2,
      hp: 600,
      speed: 5.15,
      jump: 14,
      airJumps: 0,
      punch: { name: "听我的", dmg: 11.2, kb: 6.5, stun: 14, reach: 55, startup: 5, active: 7, recover: 10 },
      s0: { name: "改你的剧本", cd: 400, hint: "两侧幕刃同时合拢夹击。", detail: "动作 0.43 秒。0.15 秒时从场地左右两侧各出一道幕刃，速度每秒 810，持续飞行直到碰到对手或飞出场地。每道伤害 33.2，击退 8，硬直 0.27 秒，判定半径 34。两侧各能命中一次，全中 66.4。冷却 6.67 秒。" },
      s1: { name: "忘了吧", cd: 355, hint: "直线音符，命中把人推开。", detail: "动作 0.40 秒。0.18 秒时向前射出音符，速度每秒 720，存活 0.90 秒，最远约 648。伤害 43.7，击退 8，硬直 0.25 秒，判定半径 16。冷却 5.92 秒。" },
      s2: { name: "箱庭塌了", cd: 373, hint: "贴地乐浪推开近中距离。", detail: "动作 0.40 秒。0.17 秒时贴地推出乐浪，速度每秒 528，存活 0.73 秒，最远约 387。伤害 50.0，击退 14，硬直 0.25 秒。判定 96×92。冷却 6.22 秒。" },
      ult: { name: "我要成为神", cost: 200, hint: "终幕砸向预判落点，高伤强击退。", detail: "耗蓝 200。动作 0.63 秒。按对手当前速度超前 0.30 秒预判落点。陨石从高度 80 以每秒 930 下落，约 0.55 秒后落地。伤害 60，击退 20，硬直 0.43 秒。下落判定 36×36；若落地则爆炸 0.23 秒，范围 180×80。" },
      tag: "Oblivionis",
    },
    {
      id: "bastion",
      name: "海铃",
      color: "#335566",
      accent: "#9bb8c9",
      thick: 6.4,
      hp: 600,
      speed: 5.15,
      jump: 14,
      airJumps: 0,
      punch: { name: "加班", dmg: 11.2, kb: 6.5, stun: 14, reach: 55, startup: 5, active: 7, recover: 10 },
      s0: { name: "加钱吗", cd: 308, hint: "把贝斯砸进地面，前方裂开音刃。", detail: "持续 0.47 秒。0.17–0.27 秒可命中：伤害 35.7，击退 12，硬直 0.30 秒。判定 165×108，覆盖身前。冷却 5.13 秒。" },
      s1: { name: "我有点怕", cd: 360, hint: "原地蓄力，期间霸体，结束时震晕对手并造成伤害。", detail: "持续 0.80 秒。全程停步并获得霸体：近战受伤 72%，远程 69%，不进硬直。0.67–0.73 秒爆发：伤害 42.0，击退 6，硬直 0.60 秒。判定 330×135，覆盖自身周围。冷却 6.00 秒。" },
      s2: { name: "职业病犯了", cd: 339, hint: "持贝斯前冲两段斩击。", detail: "持续 0.43 秒。每秒位移 480。第一段 0.08–0.15 秒伤害 18.5、击退 6；第二段 0.20–0.28 秒伤害 28.1、击退 10。每段硬直 0.22 秒。全中合计 46.6。判定 108×96。冷却 5.65 秒。" },
      ult: { name: "海铃要崩溃", cost: 200, hint: "身前连续砸下四根音柱，高伤收割。", detail: "耗蓝 200。持续 0.87 秒。前 0.17 秒短暂无敌。0.13 / 0.27 / 0.40 / 0.57 秒在身前越来越远的位置落下音柱。前两柱伤害 18、击退 8；第三柱伤害 22、击退 10；第四柱伤害 30、击退 14。每柱硬直 0.25 秒，各命中一次。全中合计 88。判定宽 64、高 150。" },
      tag: "Timoris",
    },
  ];

  const DIFFICULTIES = AI_DIFFICULTIES;
  deepFreeze(CHARACTERS); deepFreeze(DIFFICULTIES);
  function createWorld(options?: WorldOptions) {
    options = options || {};
    const left = CHARACTERS.find((c) => c.id === (options.left || "pyro"));
    const right = CHARACTERS.find((c) => c.id === (options.right || "shadow"));
    if (!left || !right) throw new Error("Unknown character");
    const mode = options.mode === "pvp" ? "pvp" : "pve";
    // Only the offline balance tool uses this; room servers choose human inputs.
    const autoplay = options.autoplay === true;
    const selection: { difficulty: Difficulty } = { difficulty: options.difficulty && DIFFICULTIES[options.difficulty] ? options.difficulty : "easy" };
    let rng = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : 0x51f15e;
    const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
    let frame = 0, eventSeq = 0;
    let result: MatchResult | null = null;
    let intro = options.introFrames === undefined ? 150 : Math.max(0, Math.floor(Number(options.introFrames) || 0));
    let timeLeft = Number(options.duration) > 0 ? Number(options.duration) : 90;
    let hitstop = 0, shake = 0, comboCount = 0, comboTimer = 0;
    let currentActor: Fighter | null = null;
    const headless = true;
    const projectiles: Projectile<Fighter>[] = [], hazards: Hazard<Fighter>[] = [], events: CombatEvent[] = [];
    const queuedHits: { from: Fighter; target: Fighter; hit: Hit; after?: (clean: boolean) => void }[] = [];
    const queuedEffects: (() => void)[] = [];
    const impactRings: ImpactRing[] = [];
    const buffers: [Partial<Record<Action, number>>, Partial<Record<Action, number>>] = [Object.create(null), Object.create(null)];
    let player: Fighter, cpu: Fighter;
    function emit(kind: CombatEventKind, actor: Fighter | null, id: string, extra?: CombatEventDetail) {
      const event = { seq: ++eventSeq, frame, kind, actor: actor ? actor.seat : null, id,
        x: actor ? actor.x : CANVAS_W / 2, y: actor ? actor.y : GROUND, ...extra };
      events.push(event);
      if (events.length > 180) events.shift();
    }
    function playSfx(id?: string) { if (id && id !== "none") emit("sfx", currentActor, id); }
    function impactSound(hit: Hit) { playSfx(hit.sfx); }
    // Visual hooks are intentionally inert in the deterministic simulation.
    function burst(...args: unknown[]) { void args; } function beep(...args: unknown[]) { void args; } function noiseBurst(...args: unknown[]) { void args; }
    function leaveAfterimage(...args: unknown[]) { void args; } function skillReleaseEffect(...args: unknown[]) { void args; } function addParticle(...args: unknown[]) { void args; }
    function consumeAction(seat: Seat, slot: SkillSlot | Action) {
      if (buffers[seat]) buffers[seat][SLOT_ACTION[slot] || slot] = 0;
    }
  class Fighter {
  declare def: Character;
  declare id: CharacterId;
  declare seat: Seat;
  declare x: number;
  declare y: number;
  declare vx: number;
  declare vy: number;
  declare facing: number;
  declare hp: number;
  declare maxHp: number;
  declare mp: number;
  declare maxMp: number;
  declare state: FighterState;
  declare stateT: number;
  declare anim: number;
  declare invuln: number;
  declare armor: number;
  declare cd0: number;
  declare cd1: number;
  declare cd2: number;
  declare walkPhase: number;
  declare stepReady: boolean;
  declare airJumps: number;
  declare dead: boolean;
  declare hitFlash: number;
  declare attackHit: boolean;
  declare hitOn: boolean;
  declare hitSpec: HitSpec | null;
  declare skillMove: SkillMove | null;
  declare isCpu: boolean;
  declare dashT: number;
  declare lockX: number;
  declare heavyT: number;
  declare ai: AiMemory;
  declare stunMax: number;

    constructor(def: Character, x: number, facing: number, isCpu: boolean) {
      this.def = def;
      this.id = def.id;
      this.x = x;
      this.y = GROUND;
      this.vx = 0;
      this.vy = 0;
      this.facing = facing;
      this.hp = def.hp;
      this.maxHp = def.hp;
      this.mp = 35;
      this.maxMp = MAX_MP;
      this.state = "idle";
      this.stateT = 0;
      this.anim = random() * 40;
      this.invuln = 0;
      this.armor = 0;
      this.cd0 = 0;
      this.cd1 = 0;
      this.cd2 = 0;
      this.walkPhase = 0;
      this.stepReady = false;
      this.airJumps = def.airJumps;
      this.dead = false;
      this.hitFlash = 0;
      this.attackHit = false;
      this.hitOn = false;
      this.hitSpec = null;
      this.skillMove = null;
      this.isCpu = isCpu;
      this.dashT = 0;
      this.lockX = 0;
      this.heavyT = 0;
      this.ai = createAiMemory();
    }

    grounded() {
      return this.y >= GROUND - 0.01;
    }

    busy() {
      return ["punch", "skill", "stun", "dead"].includes(this.state);
    }

    gainMp(n: number) {
      this.mp = Math.min(this.maxMp, this.mp + n);
    }

    bodyBox() {
      return { x: this.x - 22 * SIZE, y: this.y - 92 * SIZE, w: 44 * SIZE, h: 92 * SIZE };
    }

    openHit(spec: HitSpec) {
      this.hitOn = true;
      this.hitSpec = spec;
    }

    closeHit() {
      this.hitOn = false;
    }

    attackBox(): AttackBox | null {
      if (this.state === "punch") {
        const spec = this.def.punch;
        const t = this.stateT;
        if (t < spec.startup || t >= spec.startup + spec.active || this.attackHit) return null;
        const reach = spec.reach * SIZE;
        const x = this.facing === 1 ? this.x + 10 * SIZE : this.x - 10 * SIZE - reach;
        return { x, y: this.y - 72 * SIZE, w: reach, h: 26 * SIZE, spec: { ...spec, sfx: `${this.id}_punch` }, kind: "punch" };
      }
      if (this.state === "skill" && this.hitOn && !this.attackHit && this.hitSpec) {
        const spec = this.hitSpec;
        const scale = String(this.skillMove || "").endsWith("_ult") ? ULT_DAMAGE_SCALE : SKILL_DAMAGE_SCALE;
        const ultimate = String(this.skillMove || "").endsWith("_ult");
        const scaledSpec = { ...spec, dmg: spec.dmg * scale, empowered: scale, ultimate };
        const w = spec.w * SIZE;
        const x = this.facing === 1 ? this.x + (spec.xOff || 0) * SIZE : this.x - w - (spec.xOff || 0) * SIZE;
        return {
          x,
          y: this.y + spec.yOff * SIZE,
          w,
          h: spec.h * SIZE,
          spec: scaledSpec,
          kind: spec.kind || "skill",
        };
      }
      return null;
    }

    startAttack(kind: 'punch') {
      if (this.dead || this.busy()) return;
      consumeAction(this.seat, "punch");
      emit("attack", this, this.id + "_punch", { slot: "punch" });
      this.state = kind;
      this.stateT = 0;
      this.attackHit = false;
      this.vx *= 0.45;
      playSfx(`${this.id}_punch`);
    }

    startSkill(slot: SkillActionSlot, opponent: Fighter) {
      if (this.dead || this.busy()) return;
      if (slot === "s0" && this.cd0 > 0) return;
      if (slot === "s1" && this.cd1 > 0) return;
      if (slot === "s2" && this.cd2 > 0) return;
      if (slot === "ult" && this.mp < this.def.ult.cost) return;

      consumeAction(this.seat, slot);
      emit("skill", this, this.id + "_" + slot, { slot });
      this.state = "skill";
      this.stateT = 0;
      this.attackHit = false;
      this.hitOn = false;
      this.skillMove = `${this.id}_${slot}`;
      if (slot === "s0") this.cd0 = this.def.s0.cd;
      if (slot === "s1") this.cd1 = this.def.s1.cd;
      if (slot === "s2") this.cd2 = this.def.s2.cd;
      if (slot === "ult") {
        this.mp = 0;
      }

      const move = this.skillMove;
      if (move === "gale_s0") {
        this.vx = this.facing * 5.4;
        this.vy = -18;
      } else if (move === "iron_s0") {
        this.vx = this.facing * 2;
      } else if (move === "gale_s1") {
        this.dashT = 16;
        this.invuln = 5;
        this.vx = this.facing * 14;
        this.vy = 0;
      } else if (move === "gale_s2") {
        this.vx = this.facing * 6;
      } else if (move === "gale_ult") {
        this.invuln = 18;
        this.vx = 0;
        burst(this.x, this.y - 50, "#bbf7d0", 22, 8);
        burst(this.x, this.y - 50, "#ffffff", 16, 7);
      } else if (move === "iron_s1") {
        this.armor = 120;
        this.vx = 0;
      } else if (move === "iron_s2") {
        this.armor = 30;
        this.vx = this.facing * 8.2;
      } else if (move === "iron_ult") {
        this.armor = 40;
        this.vx = 0;
        burst(this.x, this.y - 40, this.def.color, 24, 6);
      } else if (move === "shadow_s1") {
        burst(this.x, this.y - 50, this.def.color, 18, 6);
      } else if (move === "shadow_ult") {
        this.invuln = 36;
        burst(this.x, this.y - 50, this.def.color, 22, 7);
      } else if (move === "pyro_ult") {
        this.lockX = Math.max(LEFT_WALL, Math.min(RIGHT_WALL, opponent.x + opponent.vx * 18));
      } else if (move === "bastion_s0") {
        this.vx = this.facing * 2.4;
      } else if (move === "bastion_s1") {
        this.armor = 48;
        this.vx = 0;
        this.vy = 0;
      } else if (move === "bastion_s2") {
        this.vx = this.facing * 8;
      } else if (move === "bastion_ult") {
        this.invuln = 10;
        this.vx = 0;
        burst(this.x + this.facing * 40, this.y - 40, this.def.accent, 24, 7);
      }
      skillReleaseEffect(this, slot);
      playSfx(move);
    }

    takeHit(hit: Hit, from: Fighter) {
      if (this.dead || this.invuln > 0) return false;
      const armored = this.armor > 0 && hit.kind !== "counter";
      const damage = Math.max(0, hit.dmg) * (armored ? hit.kind === "projectile" ? 0.69 : 0.72 : 1);
      const actualDamage = Math.min(this.hp, damage);
      this.hp = Math.max(0, this.hp - damage);
      this.hitFlash = armored ? 6 : 8;
      from.gainMp(12);
      this.gainMp(5);
      const dir = Math.sign(this.x - from.x) || -from.facing;
      emit("hit", from, hit.id || from.skillMove || from.id + "_punch", {
        target: this.seat, x: this.x, y: this.y - 70, damage: actualDamage,
        armored, ultimate: !!hit.ultimate, blocked: false
      });
      impactSound(hit);
      if (armored) {
        this.vx += dir * hit.kb * 0.18;
      } else {
        this.vx = dir * hit.kb;
        this.vy = -4.2 - hit.kb * 0.12;
        this.y = Math.min(this.y, GROUND - 1);
        this.state = "stun";
        this.stateT = 0;
        this.stunMax = hit.stun;
        this.dashT = 0;
        this.skillMove = null;
        this.closeHit();
        hitstop = Math.max(hitstop, hit.dmg >= 45 ? 16 : hit.dmg >= 24 ? 12 : 8);
      }
      if (this.hp <= 0) this.ko(dir);
      return true;
    }

    ko(dir: number) {
      emit("ko", this, this.id, { target: this.seat });
      this.dead = true;
      this.state = "dead";
      this.vx = dir * 10;
      this.vy = -8;
      burst(this.x, this.y - 40, this.def.color, 36, 8);
    }

    update(input: Omit<Input, 'down'>, opponent: Fighter) {
      this.anim += 1;
      if (this.cd0 > 0) this.cd0 -= 1;
      if (this.cd1 > 0) this.cd1 -= 1;
      if (this.cd2 > 0) this.cd2 -= 1;
      if (this.invuln > 0) this.invuln -= 1;
      if (this.armor > 0) this.armor -= 1;
      if (this.hitFlash > 0) this.hitFlash -= 1;
      if (this.heavyT > 0) this.heavyT -= 1;
      if (!this.dead && this.state !== "skill") this.gainMp(0.1);

      if (this.dead) {
        this.stateT += 1;
        this.vy += GRAVITY;
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.96;
        if (this.y > GROUND) {
          this.y = GROUND;
          this.vy = 0;
          this.vx *= 0.8;
        }
        return;
      }

      if (this.state === "stun") {
        this.stateT += 1;
        this.vy += GRAVITY;
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.86;
        if (this.y >= GROUND) {
          this.y = GROUND;
          this.vy = 0;
        }
        if (this.stateT >= this.stunMax) this.state = "idle";
        this.clamp();
        return;
      }

      if (this.state === "skill") this.updateSkill(opponent);

      if (this.state === "punch") {
        this.stateT += 1;
        const spec = this.def.punch;
        const total = spec.startup + spec.active + spec.recover;
        this.vy += GRAVITY;
        this.x += this.vx * 0.4;
        this.y += this.vy;
        this.vx *= 0.86;
        if (this.y >= GROUND) {
          this.y = GROUND;
          this.vy = 0;
        }
        if (this.stateT >= total) this.state = "idle";
        this.clamp();
        return;
      }

      if (!this.busy()) {
        if (input.punch || input.special || input.skill1 || input.skill2 || input.ult) {
          this.facing = Math.sign(opponent.x - this.x) || this.facing;
        }
        if (input.ult) this.startSkill("ult", opponent);
        else if (input.skill1) this.startSkill("s1", opponent);
        else if (input.skill2) this.startSkill("s2", opponent);
        else if (input.special) this.startSkill("s0", opponent);
        else if (input.punch) this.startAttack("punch");
      }
      if (this.busy() && this.state !== "skill") {
        this.clamp();
        return;
      }
      if (this.state === "skill") {
        this.clamp();
        return;
      }

      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (dir) {
        this.facing = dir;
        const heavyScale = this.heavyT > 0 ? 0.7 : 1;
        this.vx += dir * (this.grounded() ? 0.9 : 0.42) * heavyScale;
        const cap = this.def.speed * (this.grounded() ? 1 : 0.85) * heavyScale;
        this.vx = Math.max(-cap, Math.min(cap, this.vx));
        this.state = this.grounded() ? "walk" : "jump";
      } else {
        if (this.grounded()) this.vx = 0;
        else this.vx *= 0.94;
        this.state = this.grounded() ? "idle" : "jump";
      }

      if (input.up && this.heavyT <= 0) {
        if (this.grounded()) {
          consumeAction(this.seat, "up");
          this.vy = -this.def.jump;
          this.airJumps = this.def.airJumps;
          this.state = "jump";
          beep(300, 0.05, "sine", 0.03);
        } else if (this.airJumps > 0) {
          consumeAction(this.seat, "up");
          this.airJumps -= 1;
          this.vy = -this.def.jump * 0.92;
          burst(this.x, this.y, this.def.color, 8, 3);
        }
      }

      this.vy += GRAVITY;
      this.x += this.vx;
      this.y += this.vy;
      if (this.y >= GROUND) {
        if (this.vy > 8) burst(this.x, GROUND, "rgba(255,255,255,0.5)", 6, 2.2);
        this.y = GROUND;
        this.vy = 0;
        this.airJumps = this.def.airJumps;
      }
      this.clamp();
    }

    updateSkill(opponent: Fighter) {
      this.stateT += 1;
      const t = this.stateT;
      const move = this.skillMove;
      this.closeHit();

      if (move === "gale_s0") {
        if (t <= 12) {
          this.x += this.vx;
          this.y += this.vy;
          this.vy += GRAVITY * 0.72;
        } else {
          if (t === 13) {
            this.facing = Math.sign(opponent.x - this.x) || this.facing;
            this.vx = this.facing * 9.5;
            this.vy = 7.5;
          }
          this.x += this.vx;
          this.y += this.vy;
          this.vy += GRAVITY * 0.85;
        }
        if (t === 13) {
          this.attackHit = false;
          burst(this.x, this.y - 48, this.def.color, 28, 9);
        }
        if (t >= 13 && t <= 23) this.openHit({ dmg: 17.0, kb: 13, stun: 20, w: 78, h: 92, yOff: -100, sfx: "gale_s0" });
        if (t > 13 && this.y >= GROUND) {
          this.y = GROUND;
          this.vy = 0;
          burst(this.x, GROUND - 4, this.def.accent, 24, 7);
          shake = Math.max(shake, 11);
          this.endSkill();
        } else if (t >= 34) this.endSkill();
      } else if (move === "iron_s0") {
        this.vx *= 0.55;
        if (t <= 9) this.x += this.facing * 3.5;
        if (t === 10 && Math.abs(opponent.x - this.x) < 104 && Math.abs(opponent.y - this.y) < 90) {
          const facing = this.facing;
          queuedHits.push({ from: this, target: opponent,
            hit: { dmg: 17.8 * SKILL_DAMAGE_SCALE, kb: 13, stun: 20, kind: "skill", sfx: "iron_s0", id: "iron_s0", empowered: SKILL_DAMAGE_SCALE },
            after: (clean) => {
              this.attackHit = true;
              if (!clean) return;
              opponent.x = this.x - facing * 54;
              opponent.y = Math.min(opponent.y, this.y);
              this.gainMp(55);
              this.facing = -facing;
            }
          });
        }
        if (t >= 26) this.endSkill();
      } else if (move === "shadow_s0") {
        this.vx *= 0.5;
        if (t % 2 === 0) leaveAfterimage(this, 14, 0.38);
        if (t === 7) {
          this.hp = Math.max(1, this.hp - this.maxHp * 0.04);
          this.cd1 = 0;
          this.cd2 = 0;
          this.mp = this.maxMp;
          this.invuln = Math.max(this.invuln, 32);
          burst(this.x - 46, this.y - 72, this.def.color, 24, 6);
          burst(this.x + 46, this.y - 72, this.def.accent, 24, 6);
        }
        if (t >= 22) this.endSkill();
      } else if (move === "pyro_s0") {
        if (t === 9) {
          const targetY = Math.max(110, Math.min(GROUND - 35, opponent.y - 52));
          const curtainSpeed = 13.5;
          // Survive a full arena crossing even when the scrolling stage is wider.
          const curtainLife = Math.ceil(CANVAS_W / curtainSpeed) + 1;
          projectiles.push({
            type: "curtain",
            x: LEFT_WALL + 12,
            y: targetY,
            vx: curtainSpeed,
            vy: 0,
            life: curtainLife,
            owner: this,
            color: "#60a5fa",
            dmg: 15.8,
            kb: 8,
            stun: 16,
            r: 34,
            sfx: "pyro_s0",
          });
          projectiles.push({
            type: "curtain",
            x: RIGHT_WALL - 12,
            y: targetY + 18,
            vx: -curtainSpeed,
            vy: 0,
            life: curtainLife,
            owner: this,
            color: "#f9a8d4",
            dmg: 15.8,
            kb: 8,
            stun: 16,
            r: 34,
            sfx: "pyro_s0",
          });
          burst(this.x - 34, this.y - 58, "#60a5fa", 18, 5);
          burst(this.x + 34, this.y - 58, "#f9a8d4", 18, 5);
        }
        this.vx *= 0.55;
        if (t >= 26) this.endSkill();
      } else if (move === "bastion_s0") {
        this.vx *= 0.55;
        if (t === 10) {
          playSfx("bastion_s0_stomp");
          burst(this.x + this.facing * 40, GROUND, "#67e8f9", 22, 7);
          burst(this.x + this.facing * 40, GROUND, "#ffffff", 12, 5);
          if (impactRings.length >= 10) impactRings.shift();
          impactRings.push({ x: this.x + this.facing * 48, y: GROUND, life: 18, max: 18, radius: 20, speed: 12, color: "#22d3ee" });
          shake = Math.max(shake, 10);
        }
        if (t >= 10 && t <= 16) this.openHit({ dmg: 17.0, kb: 12, stun: 18, w: 110, h: 72, yOff: -70, xOff: 8, sfx: "bastion_s0" });
        if (t >= 28) this.endSkill();
      } else if (move === "gale_s1") {
        this.dashT -= 1;
        this.x += this.facing * 13;
        this.vy = 0;
        this.openHit({ dmg: 10.8, kb: 8, stun: 13, w: 70, h: 70, yOff: -80, sfx: "gale_s1" });
        if (t % 2 === 0) leaveAfterimage(this, 8, 0.22);
        if (t >= 16) this.endSkill();
      } else if (move === "gale_s2") {
        this.x += this.facing * 5.5;
        this.vy *= 0.4;
        if (t === 6 || t === 14 || t === 22) {
          this.attackHit = false;
          playSfx("gale_s2_cut");
        }
        if ((t >= 6 && t <= 9) || (t >= 14 && t <= 17) || (t >= 22 && t <= 26)) {
          this.openHit({ dmg: t >= 22 ? 12.0 : 7.8, kb: t >= 22 ? 9 : 5, stun: 12, w: 64, h: 50, yOff: -70, sfx: "gale_s2" });
        }
        if (t >= 34) this.endSkill();
      } else if (move === "gale_ult") {
        this.vx *= 0.6;
        if (t === 8 || t === 18 || t === 28) {
          this.facing = Math.sign(opponent.x - this.x) || this.facing;
          this.x = opponent.x - this.facing * 72;
          this.attackHit = false;
          burst(opponent.x, opponent.y - 40, "#ffffff", 28, 10);
          burst(opponent.x, GROUND - 8, "#86efac", 22, 8);
          playSfx("gale_ult_bolt");
          shake = 16;
        }
        if ((t >= 8 && t <= 12) || (t >= 18 && t <= 22) || (t >= 28 && t <= 34)) {
          this.openHit({ dmg: t >= 28 ? 20 : 13, kb: t >= 28 ? 14 : 8, stun: 17, w: 112, h: 100, yOff: -106, sfx: "gale_ult" });
        }
        if (t >= 42) this.endSkill();
      } else if (move === "iron_s1") {
        this.vx *= 0.45;
        if (t === 8) {
          burst(this.x - 24, this.y - 70, this.def.accent, 26, 5);
          burst(this.x + 24, this.y - 70, "#ffffff", 22, 5);
          burst(this.x, this.y - 80, "#fbcfe8", 16, 4);
          if (impactRings.length >= 10) impactRings.shift();
          impactRings.push({ x: this.x, y: this.y - 58, life: 24, max: 24, radius: 16, speed: 8, color: "#f9a8d4" });
          playSfx("iron_s1_smash");
        }
        if (t >= 26) this.endSkill();
      } else if (move === "iron_s2") {
        this.x += this.facing * 7.2;
        this.vy = 0;
        if (t % 2 === 0) leaveAfterimage(this, 10, 0.28);
        if (t >= 6 && t <= 14) this.openHit({ dmg: 18.2, kb: 10, stun: 16, w: 72, h: 66, yOff: -76, sfx: "iron_s2" });
        if (t >= 23) this.endSkill();
      } else if (move === "iron_ult") {
        this.vx *= 0.5;
        if (t === 12 || t === 24 || t === 38) {
          this.attackHit = false;
          shake = 15;
          burst(this.x + this.facing * 36, GROUND, this.def.color, 28, 8);
          burst(this.x + this.facing * 36, GROUND, "#fbcfe8", 16, 6);
          if (impactRings.length >= 10) impactRings.shift();
          impactRings.push({ x: this.x + this.facing * 36, y: GROUND, life: 18, max: 18, radius: 24, speed: 14, color: "#fb7185" });
          playSfx("iron_ult_slam");
        }
        if ((t >= 12 && t <= 16) || (t >= 24 && t <= 28) || (t >= 38 && t <= 44)) {
          this.openHit({ dmg: t >= 38 ? 23 : 16, kb: t >= 38 ? 15 : 9, stun: 18, w: 112, h: 76, yOff: -78, xOff: -8, sfx: "iron_ult" });
        }
        if (t >= 56) this.endSkill();
      } else if (move === "shadow_s1") {
        if (t === 8) {
          leaveAfterimage(this, 16, 0.42);
          leaveAfterimage(this, 12, 0.28);
          burst(this.x, this.y - 50, this.def.color, 16, 5);
          this.x = opponent.x - opponent.facing * 58;
          this.y = opponent.y;
          this.facing = Math.sign(opponent.x - this.x) || this.facing;
          this.invuln = 14;
          burst(this.x, this.y - 50, this.def.accent, 16, 5);
          playSfx("shadow_s1_slash");
        }
        if (t >= 10 && t <= 14) this.openHit({ dmg: 17.0, kb: 9, stun: 16, w: 86, h: 80, yOff: -88, sfx: "shadow_s1" });
        if (t >= 9) leaveAfterimage(this, 10, 0.32);
        if (t >= 22) this.endSkill();
      } else if (move === "shadow_s2") {
        this.vx *= 0.65;
        if (t === 10 && !opponent.dead && opponent.invuln <= 0 && Math.abs(opponent.x - this.x) < 145 && Math.abs(opponent.y - this.y) < 105) {
          queuedEffects.push(() => {
            if (opponent.dead) return;
            const stolen = Math.min(40, opponent.mp);
            opponent.mp -= stolen;
            this.gainMp(stolen * 0.6);
            opponent.state = "stun";
            opponent.stateT = 0;
            opponent.stunMax = 24;
            opponent.vx = opponent.vy = 0;
            opponent.skillMove = null;
            opponent.closeHit();
            emit("hit", this, "shadow_s2", { target: opponent.seat, x: opponent.x, y: opponent.y - 70, damage: 0, stolen });
          });
        }
        if (t >= 24) this.endSkill();
      } else if (move === "shadow_ult") {
        if (t === 6 || t === 14 || t === 22 || t === 30 || t === 38) {
          leaveAfterimage(this, 16, 0.45);
          leaveAfterimage(this, 11, 0.28);
          burst(this.x, this.y - 50, this.def.color, 12, 5);
          const side = ((t - 6) / 8) % 2 === 0 ? -1 : 1;
          this.x = opponent.x + side * 52;
          this.y = opponent.y;
          this.facing = Math.sign(opponent.x - this.x) || this.facing;
          this.attackHit = false;
          playSfx("shadow_ult_cut");
        }
        if ([7, 8, 9, 15, 16, 23, 24, 31, 32, 39, 40, 41].includes(t)) {
          this.openHit({ dmg: 9.2, kb: 6, stun: 9, w: 80, h: 78, yOff: -86, sfx: "shadow_ult" });
          leaveAfterimage(this, 9, 0.34);
        }
        if (t >= 50) this.endSkill();
      } else if (move === "pyro_s1") {
        if (t === 11) {
          projectiles.push({
            type: "note",
            x: this.x + this.facing * 36,
            y: this.y - 58,
            vx: this.facing * 12,
            vy: 0,
            life: 54,
            owner: this,
            color: "#fb923c",
            dmg: 20.8,
            kb: 8,
            stun: 15,
            r: 16,
            sfx: "pyro_s1",
          });
          burst(this.x + this.facing * 30, this.y - 58, "#f59e0b", 10, 3);
          playSfx("pyro_s1_shot");
        }
        this.vx *= 0.8;
        if (t >= 24) this.endSkill();
      } else if (move === "pyro_s2") {
        if (t === 10) {
          projectiles.push({
            type: "wave",
            x: this.x + this.facing * 40,
            y: GROUND - 24,
            vx: this.facing * 8.8,
            vy: 0,
            life: 44,
            owner: this,
            color: "#f97316",
            dmg: 23.8,
            kb: 14,
            stun: 16,
            r: 32,
            facing: this.facing,
            sfx: "pyro_s2",
          });
          burst(this.x + this.facing * 28, GROUND - 8, "#fb923c", 16, 4);
          playSfx("pyro_s2_wave");
          shake = Math.max(shake, 6);
        }
        this.vx *= 0.7;
        if (t >= 24) this.endSkill();
      } else if (move === "pyro_ult") {
        if (t === 6) {
          hazards.push({
            type: "meteor",
            x: this.lockX,
            y: 80,
            delay: 0,
            life: 36,
            owner: this,
            dmg: 30,
            kb: 20,
            stun: 26,
            hit: false,
            color: "#fb923c",
            vy: 15.5,
            sfx: "pyro_ult",
          });
          playSfx("pyro_ult_fall");
        }
        this.vx *= 0.7;
        if (t >= 38) this.endSkill();
      } else if (move === "bastion_s1") {
        this.vx = 0;
        this.vy = 0;
        if (t === 40) {
          playSfx("bastion_s1_shot");
          burst(this.x, this.y - 52, "#67e8f9", 28, 8);
          burst(this.x, this.y - 52, "#ffffff", 16, 6);
          if (impactRings.length >= 10) impactRings.shift();
          impactRings.push({ x: this.x, y: this.y - 48, life: 22, max: 22, radius: 24, speed: 14, color: "#22d3ee" });
          shake = Math.max(shake, 12);
        }
        if (t >= 40 && t <= 44) this.openHit({ dmg: 20.0, kb: 6, stun: 36, w: 220, h: 90, yOff: -92, xOff: -40, sfx: "bastion_s1" });
        if (t >= 48) this.endSkill();
      } else if (move === "bastion_s2") {
        this.x += this.facing * 8;
        this.vy = 0;
        if (t === 5 || t === 12) {
          this.attackHit = false;
          playSfx("bastion_s2_bash");
        }
        if (t >= 5 && t <= 9) this.openHit({ dmg: 8.8, kb: 6, stun: 13, w: 72, h: 64, yOff: -72, sfx: "bastion_s2" });
        if (t >= 12 && t <= 17) this.openHit({ dmg: 13.4, kb: 10, stun: 13, w: 80, h: 70, yOff: -76, sfx: "bastion_s2" });
        if (t >= 26) this.endSkill();
      } else if (move === "bastion_ult") {
        this.vx *= 0.5;
        if (t === 8 || t === 16 || t === 24 || t === 34) {
          const wave = t === 8 ? 0 : t === 16 ? 1 : t === 24 ? 2 : 3;
          hazards.push({
            type: "pillar",
            x: this.x + this.facing * (56 + wave * 48),
            y: GROUND,
            delay: 0,
            life: 16,
            owner: this,
            dmg: wave >= 3 ? 15 : wave >= 2 ? 11 : 9,
            kb: wave >= 3 ? 14 : wave >= 2 ? 10 : 8,
            stun: 15,
            hit: false,
            color: "#67e8f9",
            sfx: "bastion_ult",
          });
          burst(this.x + this.facing * (56 + wave * 48), GROUND, "#e0f2fe", 20, 7);
          shake = 12;
          playSfx("bastion_ult_quake");
        }
        if (t >= 52) this.endSkill();
      } else {
        this.endSkill();
      }
    }

    endSkill() {
      this.state = "idle";
      this.skillMove = null;
      this.closeHit();
      this.dashT = 0;
    }

    clamp() {
      this.x = Math.max(LEFT_WALL, Math.min(RIGHT_WALL, this.x));
      if (this.y > GROUND) this.y = GROUND;
    }
  }
  function resolveHits() {
    // Capture all outgoing attacks before applying damage. A same-frame hit does
    // not erase the other fighter's already-active attack, including a lethal trade.
    for (const [atk, def] of [[player, cpu], [cpu, player]]) {
      const box = atk.attackBox();
      if (!box || !rectsOverlap(box, def.bodyBox())) continue;
      atk.attackHit = true;
      queuedHits.push({ from: atk, target: def, hit: {
        ...box.spec, id: atk.skillMove || atk.id + "_punch",
        kind: box.kind || box.spec.kind || "skill"
      }});
    }
    for (const command of queuedHits) {
      currentActor = command.from;
      const clean = command.target.takeHit(command.hit, command.from);
      if (command.after) command.after(clean);
    }
    queuedHits.length = 0;
    for (const effect of queuedEffects) effect();
    queuedEffects.length = 0;

    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const p = projectiles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
      if (p.type === "wave") {
        p.y = GROUND - 24;
        if (!headless) {
          addParticle({
            x: p.x + (random() * 28 - 14),
            y: GROUND - random() * 22,
            vx: -p.vx * 0.08,
            vy: -1.6 - random() * 1.4,
            life: 12,
            max: 12,
            size: 3 + random() * 3,
            color: random() < 0.5 ? "#fb923c" : "#fff7ed",
          });
        }
      } else if (!headless) {
        addParticle({
          x: p.x, y: p.y, vx: 0, vy: -0.4, life: 10, max: 10, size: Math.max(2, p.r / 3), color: p.color,
        });
      }
      const target = p.owner === player ? cpu : player;
      const pb = p.type === "wave"
        ? { x: p.x - 48, y: GROUND - 92, w: 96, h: 92 }
        : { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
      if (rectsOverlap(pb, target.bodyBox())) {
        currentActor = p.owner;
        const clean = target.takeHit({ dmg: p.dmg * SKILL_DAMAGE_SCALE, kb: p.kb, stun: p.stun, kind: "projectile", id: p.sfx, sfx: p.sfx, empowered: SKILL_DAMAGE_SCALE }, p.owner);
        burst(p.x, p.y, p.color, 16, 5);
        if (clean && p.owner === player) {
          comboCount += 1;
          comboTimer = 70;
        }
        removeAtSwap(projectiles, i);
        continue;
      }
      if (p.life <= 0 || p.x < 0 || p.x > CANVAS_W) removeAtSwap(projectiles, i);
    }

    for (let i = hazards.length - 1; i >= 0; i -= 1) {
      const h = hazards[i];
      if (h.delay > 0) {
        h.delay -= 1;
        if (h.delay > 0) continue;
      }
      if (h.type === "meteor") {
        h.y += h.vy || 14;
        if (h.y >= GROUND - 20) {
          h.y = GROUND;
          h.type = "boom";
          h.life = 14;
          shake = 18;
          burst(h.x, GROUND, h.color, 36, 8);
          currentActor = h.owner;
          playSfx("pyro_ult_boom");
          emit("impact", h.owner, "pyro_ult", { x: h.x, y: GROUND, radius: 90 });
        }
      }
      h.life -= 1;
      const box = hazardBox(h);
      const target = h.owner === player ? cpu : player;
      if (!h.hit && box && rectsOverlap(box, target.bodyBox())) {
        currentActor = h.owner;
        h.hit = true;
        const scale = h.scale || ULT_DAMAGE_SCALE;
        const clean = target.takeHit({ dmg: h.dmg * scale, kb: h.kb, stun: h.stun, kind: "skill", id: h.sfx || h.owner.id + "_ult", sfx: "none", empowered: scale, ultimate: !h.scale }, h.owner);
        if (clean && h.owner === player) {
          comboCount += 1;
          comboTimer = 70;
        }
      }
      if (h.life <= 0) removeAtSwap(hazards, i);
    }
  }
  function hazardBox(h: Hazard<Fighter>) {
    if (h.type === "shock" || h.type === "boom") return { x: h.x - 90, y: GROUND - 80, w: 180, h: 80 };
    if (h.type === "meteor") return { x: h.x - 18, y: h.y - 18, w: 36, h: 36 };
    if (h.type === "skillShock") return { x: h.x - h.radius, y: GROUND - h.radius * 1.45, w: h.radius * 2, h: h.radius * 1.45 };
    if (h.type === "pillar") return { x: h.x - 32, y: GROUND - 150, w: 64, h: 150 };
    return null;
  }
  function cpuThink() {
    return thinkAi(cpu, player, cpu.def, cpu.ai, {
      difficulty: cpu.seat === 0 ? options?.autoplayDifficulty ?? selection.difficulty : selection.difficulty,
      projectiles, hazards, random,
    });
  }

    function pushApart() {
      player.clamp(); cpu.clamp();
      if (Math.abs(player.x - cpu.x) >= 52 * SIZE || Math.abs(player.y - cpu.y) >= 80 * SIZE) return;
      const first = player.x <= cpu.x ? player : cpu;
      const second = first === player ? cpu : player;
      const half = 26 * SIZE;
      const middle = Math.max(LEFT_WALL + half, Math.min(RIGHT_WALL - half, (player.x + cpu.x) / 2));
      first.x = middle - half; second.x = middle + half;
    }
    player = new Fighter(left, CANVAS_W / 2 - 240, 1, false); player.seat = 0;
    cpu = new Fighter(right, CANVAS_W / 2 + 240, -1, mode === "pve"); cpu.seat = 1;
    const fighters = [player, cpu];
    function bufferedInput(seat: Seat, raw: unknown) {
      const input = sanitizeInput(raw);
      ACTIONS.forEach((key) => {
        if (input[key]) buffers[seat][key] = 8;
        input[key] = (buffers[seat][key] || 0) > 0;
      });
      const fighter = fighters[seat];
      input.ult = input.ult && fighter.mp >= fighter.def.ult.cost;
      input.special = input.special && fighter.cd0 <= 1;
      input.skill1 = input.skill1 && fighter.cd1 <= 1;
      input.skill2 = input.skill2 && fighter.cd2 <= 1;
      return input;
    }
    function finish(winner: Seat | null, reason: MatchResult['reason']) {
      result = { winner, reason };
      emit("match-end", winner === null ? null : fighters[winner], reason, result);
    }
    function step(inputs?: readonly Partial<Input>[]) {
      if (result) return false;
      frame += 1;
      while (events.length && events[0].frame < frame - 12) events.shift();
      if (intro > 0) { intro -= 1; return true; }
      const human = Array.isArray(inputs) ? inputs : [];
      let leftInput: Omit<Input, 'down'> = bufferedInput(0, human[0]);
      const rightHumanInput = mode === "pvp" ? bufferedInput(1, human[1]) : null;
      if (hitstop > 0) { hitstop -= 1; return true; }
      if (autoplay) {
        const originalPlayer = player, originalCpu = cpu;
        try { player = originalCpu; cpu = originalPlayer; leftInput = cpuThink(); }
        finally { player = originalPlayer; cpu = originalCpu; }
      }
      const rightInput = rightHumanInput ?? cpuThink();
      timeLeft = Math.max(0, timeLeft - 1 / 60);
      const beforeMovement = fighters.map(f => f.x);
      currentActor = player; player.update(leftInput, cpu);
      currentActor = cpu; cpu.update(rightInput, player);
      pushApart(); resolveHits(); pushApart();
      fighters.forEach((fighter, seat) => {
        if (fighter.state !== "walk" || !fighter.grounded()) return;
        const distance = Math.abs(fighter.x - beforeMovement[seat]);
        if (distance < 0.001) {
          fighter.state = "idle";
          fighter.vx = 0;
          return;
        }
        const plant = crossedFootPlant(fighter.walkPhase, distance);
        fighter.walkPhase = cyclePhase(fighter.walkPhase + distance / WALK_CYCLE_DISTANCE);
        fighter.stepReady = !plant;
        if (plant) {
          currentActor = fighter;
          burst(fighter.x - fighter.facing * 6, GROUND - 1, "rgba(255,230,180,0.75)", 3, 1.2);
          noiseBurst(0.035, 0.05, 280);
        }
      });
      ACTIONS.forEach((key) => { for (const buffer of buffers) { const frames = buffer[key] || 0; if (frames > 0) buffer[key] = frames - 1; } });
      if (comboTimer > 0) comboTimer -= 1; else comboCount = 0;
      if (player.dead && cpu.dead) finish(null, "double-ko");
      else if (player.dead || cpu.dead) finish(player.dead ? 1 : 0, "ko");
      else if (timeLeft <= 1e-9) {
        timeLeft = 0;
        finish(player.hp === cpu.hp ? null : player.hp > cpu.hp ? 0 : 1, "timeout");
      }
      return true;
    }
    function copyFighter(fighter: Fighter): FighterSnapshot {
      const { def, ai, ...copy } = fighter;
      void def; void ai;
      if (copy.hitSpec) copy.hitSpec = { ...copy.hitSpec };
      return copy;
    }
    function copyEffect(effect: Projectile<Fighter>): Projectile;
    function copyEffect(effect: Hazard<Fighter>): Hazard;
    function copyEffect(effect: Projectile<Fighter> | Hazard<Fighter>): Projectile | Hazard {
      const copy = { ...effect, owner: effect.owner ? effect.owner.seat : null };
      return copy;
    }
    function snapshot(): Snapshot {
      void comboCount; // The presentation derives its combo count from hit events.
      return { frame, timeLeft, intro, fighters: fighters.map(copyFighter),
        projectiles: projectiles.map(effect => copyEffect(effect)), hazards: hazards.map(effect => copyEffect(effect)),
        events: events.map((event) => ({ ...event })), result: result ? { ...result } : null };
    }
    return { step, snapshot, fighters, getResult: () => result ? { ...result } : null,
      _debug: { projectiles, hazards, resolveHits, setTimeLeft: (n: number) => { timeLeft = n; },
        setHitstop: (n: number) => { hitstop = n; }, buffers }
    };
  }

export const characters = CHARACTERS;
export const difficulties = DIFFICULTIES;
export { createWorld, sanitizeInput };
export const constants = Object.freeze({ CANVAS_W, CANVAS_H, GROUND, SIZE, GRAVITY, LEFT_WALL, RIGHT_WALL, MAX_MP, FPS: 60 });
export default { characters, difficulties, createWorld, sanitizeInput, constants };
