import { context2d } from './canvas';
interface Mote { x: number; y: number; s: number; v: number; ph: number; a: number }
interface StagePetal { x: number; y: number; s: number; v: number; ph: number; c: string; rot: number }
import A from './art';
import F from './fx';
import { artImage, artRevision, artSlots } from './ui-art';
const TAU = Math.PI * 2;
const W = 1280, H = 720, GROUND = 602, M = 32;
const { clamp } = A;

// 可复现的伪随机，保证每次进入场景时星空 / 石纹一致
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const MEMBER_COLORS = ['#5f86e0', '#f0b94a', '#5fd493', '#35b7d6', '#f06aae'];

class Stage {
  declare canvas: HTMLCanvasElement;
  declare tint: string | null;
  declare tintAmt: number;
  declare motes: Mote[];
  declare petals: StagePetal[];
  /** Painted arena plate from assets/ui/art (bg-arena-*); null keeps the code-drawn stage below. */
  declare plate: HTMLImageElement | null;
  declare arena: number;
  declare artSeen: number;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W + M * 2; this.canvas.height = H + M * 2;
    this.tint = null; this.tintAmt = 0;
    this.plate = null; this.arena = 0; this.artSeen = -1;
    this.motes = [];
    const r = rng(77);
    for (let i = 0; i < 70; i++) this.motes.push({ x: r() * W, y: 60 + r() * 560, s: 0.6 + r() * 1.8, v: 3 + r() * 9, ph: r() * TAU, a: 0.25 + r() * 0.5 });
    this.petals = [];
    for (let i = 0; i < 16; i++) this.petals.push({ x: r() * W, y: r() * H, s: 4 + r() * 5, v: 8 + r() * 14, ph: r() * TAU, c: MEMBER_COLORS[i % 5], rot: r() * TAU });
    this.build();
  }

  setTint(color: string | null, amt: number) { this.tint = color; this.tintAmt = amt; }

  /** Chooses which delivered plate this match uses (no plates delivered: keep the code-drawn stage). */
  setArena(seed: number) { this.arena = seed; this.pick(); }

  pick() {
    const slots = artSlots('bg-arena');
    const plate = slots.length ? artImage(slots[this.arena % slots.length]) : null;
    if (plate === this.plate) return;
    this.plate = plate;
    this.build();
  }

  build() {
    if (this.plate) this.buildPlate(this.plate); else this.buildGothic();
  }

  /**
   * The plate is painted so its floor edge sits at 83.6% of the height, which is exactly where the
   * fighters stand (GROUND / H). It therefore maps 1:1 onto the world rect; the shake margin around it
   * gets a stretched, darkened copy so a jolt never exposes bare canvas.
   */
  buildPlate(plate: HTMLImageElement) {
    const c = context2d(this.canvas);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.save(); c.translate(M, M);
    c.drawImage(plate, -M, -M, W + M * 2, H + M * 2);
    c.fillStyle = 'rgba(6,4,13,.6)'; c.fillRect(-M, -M, W + M * 2, H + M * 2);
    c.drawImage(plate, 0, 0, W, H);
    // calm the edges and sink the audience pit below the floor line so sprites stay the brightest thing
    const vg = c.createRadialGradient(W / 2, H * 0.5, 300, W / 2, H * 0.5, 860);
    vg.addColorStop(0, 'rgba(6,4,16,0)'); vg.addColorStop(1, 'rgba(6,4,16,.6)');
    c.fillStyle = vg; c.fillRect(-M, -M, W + M * 2, H + M * 2);
    const pit = c.createLinearGradient(0, GROUND + 16, 0, H + M);
    pit.addColorStop(0, 'rgba(4,3,10,0)'); pit.addColorStop(1, 'rgba(4,3,10,.72)');
    c.fillStyle = pit; c.fillRect(-M, GROUND + 16, W + M * 2, H - GROUND + M);
    c.restore();
  }

  buildGothic() {
    const c = context2d(this.canvas);
    c.save(); c.translate(M, M);
    const r = rng(2026);
    /* 夜空 */
    const sky = c.createLinearGradient(0, -M, 0, 500);
    sky.addColorStop(0, '#080a1f'); sky.addColorStop(0.45, '#17153a'); sky.addColorStop(0.78, '#2f1f4d'); sky.addColorStop(1, '#4a2a55');
    c.fillStyle = sky; c.fillRect(-M, -M, W + M * 2, 560 + M);
    for (let i = 0; i < 110; i++) {
      const x = r() * W, y = r() * 330, s = r() * 1.5 + 0.4;
      c.globalAlpha = 0.25 + r() * 0.7; c.fillStyle = r() < 0.2 ? '#ffe9b8' : '#e8ecff';
      c.beginPath(); c.arc(x, y, s, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;

    /* 月亮与玫瑰窗 */
    const mx = 640, my = 252;
    let g = c.createRadialGradient(mx, my, 40, mx, my, 360);
    g.addColorStop(0, 'rgba(190,200,255,.42)'); g.addColorStop(0.5, 'rgba(130,120,220,.14)'); g.addColorStop(1, 'rgba(130,120,220,0)');
    c.fillStyle = g; c.fillRect(mx - 380, my - 380, 760, 760);
    g = c.createRadialGradient(mx - 30, my - 34, 6, mx, my, 112);
    g.addColorStop(0, '#fffdf2'); g.addColorStop(0.55, '#e7e4ff'); g.addColorStop(1, '#a9a6e6');
    c.fillStyle = g; c.beginPath(); c.arc(mx, my, 112, 0, TAU); c.fill();
    c.fillStyle = 'rgba(120,110,190,.16)';
    for (let i = 0; i < 12; i++) { const a = r() * TAU, d = r() * 80; c.beginPath(); c.arc(mx + Math.cos(a) * d, my + Math.sin(a) * d, 5 + r() * 14, 0, TAU); c.fill(); }
    // 五色彩玻璃扇区（环绕月亮）
    for (let i = 0; i < 5; i++) {
      const a0 = -Math.PI / 2 + i * TAU / 5, a1 = a0 + TAU / 5;
      const rg = c.createRadialGradient(mx, my, 118, mx, my, 176);
      rg.addColorStop(0, A.rgba(MEMBER_COLORS[i], 0.82)); rg.addColorStop(1, A.rgba(MEMBER_COLORS[i], 0.34));
      c.fillStyle = rg; c.beginPath(); c.moveTo(mx + Math.cos(a0) * 118, my + Math.sin(a0) * 118);
      c.arc(mx, my, 176, a0, a1); c.arc(mx, my, 118, a1, a0, true); c.closePath(); c.fill();
    }
    // 窗棂
    c.strokeStyle = '#0c0a1d'; c.lineWidth = 7;
    c.beginPath(); c.arc(mx, my, 182, 0, TAU); c.stroke();
    c.lineWidth = 5; c.beginPath(); c.arc(mx, my, 118, 0, TAU); c.stroke();
    c.lineWidth = 4;
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * TAU / 10; c.beginPath(); c.moveTo(mx + Math.cos(a) * 112, my + Math.sin(a) * 112); c.lineTo(mx + Math.cos(a) * 182, my + Math.sin(a) * 182); c.stroke(); }
    c.strokeStyle = '#2c2748'; c.lineWidth = 2; c.beginPath(); c.arc(mx, my, 190, 0, TAU); c.stroke();
    c.strokeStyle = 'rgba(210,190,255,.55)'; c.lineWidth = 1.5; c.beginPath(); c.arc(mx, my, 186, 0, TAU); c.stroke();

    /* 后墙：尖拱彩窗 */
    const arches = [[150, 0], [376, 1], [904, 3], [1130, 4]];
    for (const [x, ci] of arches) {
      const top = 150, bottom = 486, w = 86;
      const wall = (path: () => void) => { c.beginPath(); path(); c.closePath(); };
      c.fillStyle = '#0d0b1f';
      wall(() => { c.moveTo(x - w - 18, bottom); c.lineTo(x - w - 18, top + 60); c.quadraticCurveTo(x - w - 18, top - 20, x, top - 70); c.quadraticCurveTo(x + w + 18, top - 20, x + w + 18, top + 60); c.lineTo(x + w + 18, bottom); }); c.fill();
      const gg = c.createLinearGradient(0, top - 60, 0, bottom);
      gg.addColorStop(0, A.rgba(MEMBER_COLORS[ci], 0.88)); gg.addColorStop(0.55, A.rgba(MEMBER_COLORS[(ci + 2) % 5], 0.4)); gg.addColorStop(1, A.rgba('#150f2c', 0.9));
      c.fillStyle = gg;
      wall(() => { c.moveTo(x - w, bottom); c.lineTo(x - w, top + 60); c.quadraticCurveTo(x - w, top - 10, x, top - 54); c.quadraticCurveTo(x + w, top - 10, x + w, top + 60); c.lineTo(x + w, bottom); }); c.fill();
      // 光斑
      const sg = c.createRadialGradient(x, top + 70, 4, x, top + 70, 130);
      sg.addColorStop(0, 'rgba(255,255,255,.34)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sg; c.fillRect(x - w, top - 60, w * 2, bottom - top + 60);
      // 窗棂
      c.strokeStyle = '#0c0a1d'; c.lineWidth = 5;
      c.beginPath(); c.moveTo(x, top - 54); c.lineTo(x, bottom); c.stroke();
      for (const y of [top + 70, top + 150, top + 240]) { c.beginPath(); c.moveTo(x - w, y); c.lineTo(x + w, y); c.stroke(); }
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(x - w / 2, top + 70); c.lineTo(x - w / 2, bottom); c.moveTo(x + w / 2, top + 70); c.lineTo(x + w / 2, bottom); c.stroke();
      c.beginPath(); c.arc(x, top + 18, 26, 0, TAU); c.stroke();
      c.strokeStyle = '#3a3358'; c.lineWidth = 3;
      wall(() => { c.moveTo(x - w, bottom); c.lineTo(x - w, top + 60); c.quadraticCurveTo(x - w, top - 10, x, top - 54); c.quadraticCurveTo(x + w, top - 10, x + w, top + 60); c.lineTo(x + w, bottom); }); c.stroke();
    }
    // 立柱与柱头
    for (const x of [20, 262, 514, 766, 1018, 1260]) {
      const pg = c.createLinearGradient(x - 26, 0, x + 26, 0);
      pg.addColorStop(0, '#0e0c20'); pg.addColorStop(0.5, '#2a2447'); pg.addColorStop(1, '#0e0c20');
      c.fillStyle = pg; c.fillRect(x - 26, 40, 52, 460);
      c.fillStyle = '#3a3358'; c.fillRect(x - 34, 40, 68, 14); c.fillRect(x - 34, 488, 68, 14);
      c.strokeStyle = 'rgba(180,170,230,.14)'; c.lineWidth = 1;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x + i * 9, 56); c.lineTo(x + i * 9, 486); c.stroke(); }
    }
    // 后墙下半部暗色护墙板
    const dado = c.createLinearGradient(0, 430, 0, 520);
    dado.addColorStop(0, 'rgba(14,10,30,0)'); dado.addColorStop(1, 'rgba(14,10,30,.9)');
    c.fillStyle = dado; c.fillRect(-M, 430, W + M * 2, 90);

    /* 顶部桁架与灯 */
    c.fillStyle = '#0a0818'; c.fillRect(-M, -M, W + M * 2, 64);
    c.fillStyle = '#17132b'; c.fillRect(-M, 26, W + M * 2, 8);
    c.strokeStyle = '#2a2447'; c.lineWidth = 2;
    for (let x = -20; x < W + 30; x += 36) { c.beginPath(); c.moveTo(x, 8); c.lineTo(x + 18, 26); c.lineTo(x + 36, 8); c.stroke(); }
    for (let i = 0; i < 7; i++) {
      const x = 110 + i * 176;
      c.fillStyle = '#05040d'; c.beginPath(); c.moveTo(x - 14, 34); c.lineTo(x + 14, 34); c.lineTo(x + 10, 54); c.lineTo(x - 10, 54); c.closePath(); c.fill();
      c.fillStyle = MEMBER_COLORS[i % 5]; c.globalAlpha = 0.9; c.beginPath(); c.ellipse(x, 54, 8, 3, 0, 0, TAU); c.fill(); c.globalAlpha = 1;
    }

    /* 帷幕 */
    for (const side of [-1, 1]) {
      c.save(); if (side === 1) { c.translate(W, 0); c.scale(-1, 1); }
      const cg = c.createLinearGradient(0, 0, 250, 0);
      cg.addColorStop(0, '#12081a'); cg.addColorStop(0.3, '#5a1f45'); cg.addColorStop(0.62, '#2f1236'); cg.addColorStop(1, '#12081a');
      c.fillStyle = cg;
      c.beginPath(); c.moveTo(-M, -M); c.lineTo(262, -M); c.bezierCurveTo(240, 140, 190, 230, 170, 330); c.bezierCurveTo(160, 390, 168, 440, 120, 520); c.lineTo(-M, 560); c.closePath(); c.fill();
      for (let i = 0; i < 8; i++) {
        const x0 = 8 + i * 30;
        const lg = c.createLinearGradient(x0 - 14, 0, x0 + 14, 0);
        lg.addColorStop(0, 'rgba(0,0,0,.45)'); lg.addColorStop(0.5, 'rgba(255,170,200,.10)'); lg.addColorStop(1, 'rgba(0,0,0,.4)');
        c.fillStyle = lg;
        c.beginPath(); c.moveTo(x0 - 14, -M); c.bezierCurveTo(x0 + 16, 200, x0 - 40 + i * 4, 330, x0 - 40, 540); c.lineTo(x0 - 14, 540); c.bezierCurveTo(x0 - 44 + i * 4, 330, x0 + 4, 200, x0 - 14 - 10, -M); c.closePath(); c.fill();
      }
      // 金色系带与流苏
      c.strokeStyle = '#d9b36a'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(120, 300); c.quadraticCurveTo(182, 322, 224, 280); c.stroke();
      c.strokeStyle = '#8c6b2e'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(120, 304); c.quadraticCurveTo(182, 326, 224, 284); c.stroke();
      c.fillStyle = '#e8c779'; c.beginPath(); c.arc(224, 282, 6, 0, TAU); c.fill();
      c.strokeStyle = '#d9b36a'; c.lineWidth = 2;
      for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(214 + i * 2, 288); c.lineTo(208 + i * 3, 330 + (i % 3) * 4); c.stroke(); }
      c.restore();
    }
    // 上方帷幔（弧形下垂）
    c.fillStyle = '#4a1738';
    c.beginPath(); c.moveTo(-M, -M); c.lineTo(W + M, -M); c.lineTo(W + M, 52);
    const n = 9;
    for (let i = n; i >= 0; i--) { const x = (W + M) - i * ((W + M * 2) / n); c.quadraticCurveTo(x + (W + M * 2) / n / 2, i % 2 ? 108 : 92, x, 56); }
    c.closePath(); c.fill();
    c.strokeStyle = '#d9b36a'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(-M, 58);
    for (let i = 0; i < n; i++) { const x0 = -M + i * ((W + M * 2) / n); c.quadraticCurveTo(x0 + (W + M * 2) / n / 2, 100, x0 + (W + M * 2) / n, 58); }
    c.stroke();

    /* 地板 */
    const fy = 486;
    const floor = c.createLinearGradient(0, fy, 0, H + M);
    floor.addColorStop(0, '#2a1a3c'); floor.addColorStop(0.4, '#1c1230'); floor.addColorStop(1, '#0a0716');
    c.fillStyle = floor; c.fillRect(-M, fy, W + M * 2, H - fy + M);
    // 反光：月亮与彩窗在地板上的倒影
    for (const [x, col, w, a] of [[640, '#cfc9ff', 70, 0.28], [150, MEMBER_COLORS[0], 50, 0.16], [376, MEMBER_COLORS[1], 50, 0.16], [904, MEMBER_COLORS[3], 50, 0.16], [1130, MEMBER_COLORS[4], 50, 0.16]] as const) {
      const rg = c.createLinearGradient(0, fy, 0, fy + 190);
      rg.addColorStop(0, A.rgba(col, a)); rg.addColorStop(1, A.rgba(col, 0));
      c.fillStyle = rg; c.beginPath(); c.moveTo(x - w * 0.5, fy); c.lineTo(x + w * 0.5, fy); c.lineTo(x + w * 1.6, fy + 190); c.lineTo(x - w * 1.6, fy + 190); c.closePath(); c.fill();
    }
    // 地板拼缝（向消失点汇聚）
    c.strokeStyle = 'rgba(190,160,255,.10)'; c.lineWidth = 1;
    for (let y = fy + 14, i = 0; y < H + M; i++, y += 14 + i * 4.2) { c.beginPath(); c.moveTo(-M, y); c.lineTo(W + M, y); c.stroke(); }
    for (let x = -900; x < W + 900; x += 96) { c.beginPath(); c.moveTo(640 + (x - 640) * 0.3, fy); c.lineTo(x, H + M); c.stroke(); }
    // 地面法阵（静态底纹）
    c.save(); c.translate(640, 566); c.scale(1, 0.2);
    c.strokeStyle = 'rgba(244,214,140,.34)'; c.lineWidth = 5 / 0.2 * 0.2;
    c.beginPath(); c.arc(0, 0, 330, 0, TAU); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 300, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 0, 190, 0, TAU); c.stroke();
    c.restore();
    // 舞台前沿：亮边与观众席暗部
    const rim = c.createLinearGradient(0, GROUND - 2, 0, GROUND + 14);
    rim.addColorStop(0, 'rgba(255,230,190,0)'); rim.addColorStop(0.12, 'rgba(255,230,190,.55)'); rim.addColorStop(0.24, 'rgba(120,80,150,.25)'); rim.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rim; c.fillRect(-M, GROUND - 2, W + M * 2, 16);
    const pit = c.createLinearGradient(0, 640, 0, H + M);
    pit.addColorStop(0, 'rgba(4,3,10,0)'); pit.addColorStop(1, 'rgba(4,3,10,.82)');
    c.fillStyle = pit; c.fillRect(-M, 640, W + M * 2, H - 640 + M);
    // 地平雾
    const fog = c.createLinearGradient(0, fy - 70, 0, fy + 70);
    fog.addColorStop(0, 'rgba(160,140,220,0)'); fog.addColorStop(0.5, 'rgba(160,140,220,.22)'); fog.addColorStop(1, 'rgba(160,140,220,0)');
    c.fillStyle = fog; c.fillRect(-M, fy - 70, W + M * 2, 140);
    // 暗角
    const vg = c.createRadialGradient(W / 2, H * 0.48, 280, W / 2, H * 0.48, 820);
    vg.addColorStop(0, 'rgba(6,4,16,0)'); vg.addColorStop(1, 'rgba(6,4,16,.72)');
    c.fillStyle = vg; c.fillRect(-M, -M, W + M * 2, H + M * 2);
    c.restore();
  }

  // 绘制到世界坐标（原点为舞台左上角，1280×720）
  draw(c: CanvasRenderingContext2D, ts: number, reduced?: boolean, low?: boolean) {
    // art arrives asynchronously after the first frames; one integer compare per frame is all it costs
    if (this.artSeen !== artRevision()) { this.artSeen = artRevision(); this.pick(); }
    c.drawImage(this.canvas, -M, -M);
    const t = ts / 1000;
    c.save();
    c.globalCompositeOperation = 'lighter';
    if (this.plate) {
      // painted plate: a slow breathing light, plus a color wash while an ultimate's tint is active
      F.glow(c, W / 2, 360, 460, '#9fb3ff', 0.08 * (0.8 + 0.2 * Math.sin(t * 0.9)));
      if (this.tint && this.tintAmt > 0.02) { c.globalAlpha = Math.min(0.32, this.tintAmt * 0.4); c.fillStyle = this.tint; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
    } else {
    // 月光呼吸
    const pulse = 0.78 + 0.22 * Math.sin(t * 0.9);
    F.glow(c, 640, 252, 330, '#8b86ff', 0.26 * pulse);
    // 聚光灯光束
    const beams = [[110, 0], [286, 1], [462, 2], [818, 3], [994, 4], [1170, 0]];
    for (let i = 0; i < beams.length; i++) {
      const [x, ci] = beams[i];
      const sway = reduced ? 0 : Math.sin(t * (0.5 + i * 0.07) + i * 1.7) * 90;
      const col = this.tint && this.tintAmt > 0.02 ? A.mixHex(MEMBER_COLORS[ci], this.tint, clamp(this.tintAmt, 0, 0.85)) : MEMBER_COLORS[ci];
      const tx = x + sway + (i < 3 ? 150 : -150), ty = 590;
      const bg = c.createLinearGradient(x, 56, tx, ty);
      bg.addColorStop(0, A.rgba(col, 0.34 + this.tintAmt * 0.2)); bg.addColorStop(1, A.rgba(col, 0.02));
      c.fillStyle = bg;
      c.beginPath(); c.moveTo(x - 8, 56); c.lineTo(x + 8, 56); c.lineTo(tx + 88, ty); c.lineTo(tx - 88, ty); c.closePath(); c.fill();
      // 地面光斑
      if (!low) {
        c.save(); c.translate(tx, ty + 4); c.scale(1, 0.2);
        const sg = c.createRadialGradient(0, 0, 0, 0, 0, 120);
        sg.addColorStop(0, A.rgba(col, 0.34)); sg.addColorStop(1, A.rgba(col, 0));
        c.fillStyle = sg; c.beginPath(); c.arc(0, 0, 120, 0, TAU); c.fill(); c.restore();
      }
    }
    // 地面法阵旋转层
    F.drawMagicCircle(c, 640, 566, 316, 0.2, reduced ? 0 : t * 0.12, '#f4d68c', 0.3 + this.tintAmt * 0.3, 12);
    }
    // 光尘
    for (let mi = 0; mi < this.motes.length; mi += low ? 2 : 1) {
      const m = this.motes[mi];
      const y = m.y - ((reduced ? 0 : t * m.v) % 560), yy = y < 60 ? y + 560 : y;
      const x = m.x + (reduced ? 0 : Math.sin(t * 0.4 + m.ph) * 14);
      c.globalAlpha = m.a * (0.55 + 0.45 * Math.sin(t * 1.3 + m.ph));
      c.fillStyle = '#efe6ff'; c.beginPath(); c.arc(x, yy, m.s, 0, TAU); c.fill();
    }
    c.restore();
    // 落花（只属于哥特舞台，彩绘背景不画）
    if (!this.plate && !reduced && !low) {
      c.save();
      for (const p of this.petals) {
        const y = (p.y + t * p.v) % (H + 40) - 20, x = p.x + Math.sin(t * 0.7 + p.ph) * 40;
        c.globalAlpha = 0.5; c.fillStyle = p.c;
        c.save(); c.translate(x, y); c.rotate(p.rot + t * 0.8); c.scale(1, 0.55 + 0.45 * Math.sin(t * 2 + p.ph));
        A.petal(c, p.s * 1.4, p.s * 0.6); c.fill(); c.restore();
      }
      c.restore();
    }
  }
}

const stage = { Stage, MEMBER_COLORS, W, H, GROUND, M };
export default stage;
