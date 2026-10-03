/* Ave Mujica 乱斗剧场 · 竞技场渲染器
 * 组合 art.js（角色）/ fx.js（特效）/ stage.js（舞台），把战斗核心的快照画成动画。
 * 对外接口保持不变：new ArenaRenderer(canvas, characters)、resize()、draw(snapshot, seat, ts)、
 * destroy()、ArenaRenderer.drawPortrait()、renderer.reducedMotion。
 * 新增：renderer.combo（两个席位的连击计数）、window 事件 mujica:skill / mujica:ko。
 */
(function () {
  'use strict';
  const A = window.MujicaArt, FX = window.MujicaFx, ST = window.MujicaStage;
  const W = 1280, H = 720, GROUND = 602, CS = FX.CS, SP = FX.SPRITE;
  const clamp = A.clamp, mix = A.lerp, ease = A.ease;

  // 技能 / 普攻中需要触发演出的关键帧（与 lib/combat.js 的时间轴一致）
  const MARKS = {
    punch: [5],
    pyro_s0: [9], pyro_s1: [11], pyro_s2: [10], pyro_ult: [6],
    shadow_s0: [7], shadow_s1: [8, 10], shadow_s2: [10], shadow_ult: [6, 14, 22, 30, 38],
    gale_s0: [0, 13], gale_s1: [0], gale_s2: [6, 14, 22], gale_ult: [0, 8, 18, 28],
    iron_s0: [0, 10], iron_s1: [8], iron_s2: [0, 6], iron_ult: [12, 24, 38],
    bastion_s0: [10], bastion_s1: [40], bastion_s2: [5, 12], bastion_ult: [8, 16, 24, 34],
  };

  const prefersReduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class ArenaRenderer {
    static drawPortrait(canvas, characterId, characters, ts = performance.now()) {
      const bust = canvas.dataset.portraitMode === 'bust';
      const fill = parseFloat(canvas.dataset.portraitFill);
      A.drawShowcase(canvas, characterId, ts, { mode: bust ? 'bust' : 'full', reduced: prefersReduced(), fill: Number.isFinite(fill) ? fill : undefined });
    }

    constructor(canvas, characters = []) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.characters = new Map((Array.isArray(characters) ? characters : Object.values(characters)).map((d) => [d.id, d]));
      this.stage = new ST.Stage();
      this.fx = new FX.Fx();
      this.sprites = [null, null];
      this.fx.spriteOf = (f) => { const S = this.sprites[f.seat === 1 ? 1 : 0]; return S ? S.canvas : null; };
      this.lastSeq = -1; this.lastFrame = -1; this.lastSnapshotAt = 0; this.interval = 50; this.lastDraw = 0;
      this.previous = []; this.current = []; this.tracks = [null, null];
      this.combo = [{ n: 0, last: -999 }, { n: 0, last: -999 }];
      this.tint = { color: null, at: 0, len: 1 };
      this.frameEma = 16.7; this.lastFrameTs = 0; this.slowCount = 0; this.fastCount = 0; this.lowQuality = false;
      this.matchMedia = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this._reduced = !!(this.matchMedia && this.matchMedia.matches);
      this.fx.reduced = this._reduced;
      this.onMotion = (e) => { this.reducedMotion = e.matches; };
      if (this.matchMedia && this.matchMedia.addEventListener) this.matchMedia.addEventListener('change', this.onMotion);
      this.resize();
    }

    get reducedMotion() { return this._reduced; }
    set reducedMotion(v) { this._reduced = !!v; this.fx.reduced = this._reduced; }

    resize() {
      const bounds = this.canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width || this.canvas.clientWidth || W);
      const height = Math.max(1, bounds.height || this.canvas.clientHeight || H);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.round(width * dpr), bh = Math.round(height * dpr);
      if (this.canvas.width !== bw) this.canvas.width = bw;
      if (this.canvas.height !== bh) this.canvas.height = bh;
      this.scale = Math.min(bw / W, bh / H);
      this.offsetX = (bw - W * this.scale) / 2;
      this.offsetY = (bh - H * this.scale) / 2;
      this.boundsWidth = width; this.boundsHeight = height; this.dpr = dpr;
    }

    destroy() {
      if (this.matchMedia && this.matchMedia.removeEventListener) this.matchMedia.removeEventListener('change', this.onMotion);
    }

    /* ---------- 快照跟踪与插值 ---------- */
    track(snapshot, ts) {
      if (snapshot.frame < this.lastFrame) {
        this.lastSeq = -1; this.fx.reset(); this.previous = []; this.current = []; this.tracks = [null, null];
        this.combo = [{ n: 0, last: -999 }, { n: 0, last: -999 }];
      }
      if (snapshot.frame !== this.lastFrame) {
        this.interval = this.lastSnapshotAt ? clamp(ts - this.lastSnapshotAt, 12, 75) : 50;
        this.previous = this.current;
        this.current = (snapshot.fighters || []).map((f) => ({ x: f.x, y: f.y, walkPhase: f.walkPhase, state: f.state, facing: f.facing }));
        this.lastSnapshotAt = ts; this.lastFrame = snapshot.frame;
        this.newFrame = true;
      } else this.newFrame = false;
    }

    interpolate(snapshot, ts) {
      // Constant motion across packets: restarting an ease curve at every
      // 20 Hz snapshot makes each step repeatedly slow down and speed up.
      const blend = clamp((ts - this.lastSnapshotAt) / this.interval, 0, 1);
      return (snapshot.fighters || []).map((f, i) => {
        const old = this.previous[i], now = this.current[i];
        if (!old || !now || Math.abs(old.x - now.x) > 140 || Math.abs(old.y - now.y) > 160) return Object.assign({ frame: snapshot.frame }, f);
        const v = Object.assign({ frame: snapshot.frame }, f, { x: mix(old.x, now.x, blend), y: mix(old.y, now.y, blend) });
        if (f.state === 'walk' && old.state === 'walk' && Number.isFinite(old.walkPhase) && Number.isFinite(now.walkPhase)) {
          const delta = ((now.walkPhase - old.walkPhase + 1.5) % 1) - 0.5;
          v.walkPhase = (old.walkPhase + delta * blend + 1) % 1;
        }
        return v;
      });
    }

    /* ---------- 事件与关键帧 -> 特效 ---------- */
    process(snapshot, view, ts) {
      const fx = this.fx;
      for (const e of snapshot.events || []) {
        if (!Number.isFinite(e.seq) || e.seq <= this.lastSeq) continue;
        this.lastSeq = e.seq;
        if (Number.isFinite(e.frame) && snapshot.frame - e.frame > 35) continue;
        const actor = view[e.actor];
        if (e.kind === 'hit') {
          const target = view[e.target];
          fx.hit(e, actor, target);
          if (actor && !e.armored && e.damage > 0 && e.actor !== null) {
            const cb = this.combo[e.actor];
            if (cb) { cb.n = snapshot.frame - cb.last <= 70 ? cb.n + 1 : 1; cb.last = snapshot.frame; }
          }
        } else if (e.kind === 'skill' && actor) {
          fx.cast(actor, e.slot);
          if (e.slot === 'ult') { this.tint = { color: FX.tone(actor.id).main, at: ts, len: 1500 }; }
          const detail = { seat: e.actor, id: actor.id, slot: e.slot, name: this.characters.get(actor.id)?.[e.slot]?.name || '' };
          window.dispatchEvent(new CustomEvent('mujica:skill', { detail }));
        } else if (e.kind === 'ko' && actor) {
          fx.ko(actor);
          window.dispatchEvent(new CustomEvent('mujica:ko', { detail: { seat: e.actor, id: actor.id } }));
        } else if (e.kind === 'impact') {
          fx.impact(e);
        }
      }
      // 状态推导：关键帧 / 落地 / 跑动扬尘
      if (!this.newFrame) return;
      for (let i = 0; i < view.length; i++) {
        const f = view[i], raw = (snapshot.fighters || [])[i], o = view[1 - i];
        const move = f.state === 'skill' ? f.skillMove : f.state === 'punch' ? 'punch' : null;
        const t = f.stateT || 0;
        const tr = this.tracks[i];
        if (move && MARKS[move]) {
          const prevT = tr && tr.move === move && t >= tr.t ? tr.t : -1;
          for (const m of MARKS[move]) {
            if (prevT < m && t >= m) {
              if (move === 'punch') fx.punch(f);
              else fx.mark(f, move, m, o, tr ? tr.pos : null);
            }
          }
        }
        if (tr) {
          // 落地
          if (tr.y < GROUND - 8 && raw.y >= GROUND - 1 && !f.dead) {
            if (move === 'gale_s0' && t > 13) fx.landing(f);
            else fx.dust(f.x, GROUND - 2, 4, '#d9d2ee', {});
          }
        }
        this.tracks[i] = { move, t, y: raw.y, pos: { x: raw.x, y: raw.y, facing: raw.facing } };
      }
    }

    /* ---------- 绘制 ---------- */
    draw(snapshot, localSeat, ts = performance.now()) {
      const t0 = performance.now();
      const bounds = this.canvas.getBoundingClientRect();
      if (Math.abs(bounds.width - this.boundsWidth) > 0.5 || Math.abs(bounds.height - this.boundsHeight) > 0.5 || Math.min(window.devicePixelRatio || 1, 2) !== this.dpr) this.resize();
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#06040d'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      const dt = this.lastDraw ? clamp((ts - this.lastDraw) / 16.667, 0, 3) : 1;
      this.lastDraw = ts;
      const reduced = this._reduced;

      let view = [];
      if (snapshot) {
        this.track(snapshot, ts);
        view = this.interpolate(snapshot, ts);
        const winner = snapshot.result ? snapshot.result.winner : null;
        if (winner === 0 || winner === 1) { if (view[winner]) { view[winner].win = true; this.celebrate(view[winner], ts); } }
        this.process(snapshot, view, ts);
        this.fx.update(dt, ts, view);
        for (let i = 0; i < view.length; i++) this.fx.sustain(view[i], view[1 - i], dt, ts);
        this.fx.sustainWorld(snapshot, ts);
        for (let i = 0; i < view.length; i++) this.dustTrail(view[i], ts);
      } else this.fx.update(dt, ts, view);

      // 舞台色调随大招变化
      const tintK = this.tint.color ? clamp(1 - (ts - this.tint.at) / this.tint.len, 0, 1) : 0;
      this.stage.setTint(this.tint.color, tintK * 0.8);

      const cam = this.fx.camera();
      c.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
      c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip();
      c.translate(cam.sx, cam.sy);
      if (cam.z > 1.0005) { c.translate(cam.zx, cam.zy); c.scale(cam.z, cam.z); c.translate(-cam.zx, -cam.zy); }
      this.stage.draw(c, ts, reduced, this.lowQuality);

      if (snapshot) {
        const frame = snapshot.result ? Math.floor(ts / 16.667) : snapshot.frame || 0;
        this.fx.drawBack(c);
        for (const h of (snapshot.hazards || []).slice(0, 24)) FX.drawHazardBack(c, h, (snapshot.fighters[h.owner] || {}).id || 'pyro', frame);
        // 先更新精灵，再绘制倒影与投影
        for (const f of view) this.updateSprite(f, frame, ts);
        for (let i = 0; i < view.length; i++) {
          const f = view[i];
          if (!reduced && !this.lowQuality && !f.dead) this.drawReflection(c, f);
          this.drawShadow(c, f, i === localSeat, ts);
        }
        for (const f of view) this.drawAura(c, f, ts);
        this.fx.drawGhosts(c);
        for (const f of view) this.drawFighter(c, f, frame, ts);
        for (const h of (snapshot.hazards || []).slice(0, 24)) FX.drawHazardFront(c, h, (snapshot.fighters[h.owner] || {}).id || 'pyro', frame);
        for (const p of (snapshot.projectiles || []).slice(0, 32)) FX.drawProjectile(c, p, (snapshot.fighters[p.owner] || {}).id || 'pyro', frame);
        this.fx.drawFront(c);
        this.fx.drawText(c);
        for (let i = 0; i < view.length; i++) if (i === localSeat && !view[i].dead) this.drawMarker(c, view[i], ts);
      }
      c.restore();

      // 屏幕空间叠层
      c.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
      c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip();
      this.fx.drawScreen(c, W, H, ts);
      c.restore();

      // 画质自适应：以实际帧间隔判断（光栅化多在 GPU / 合成线程，脚本耗时看不出来）。
      // 长期低于约 38fps 就降级（关倒影、减粒子、降低精灵刷新率、简化舞台动效），恢复到 50fps 以上再升回。
      if (this.lastFrameTs) {
        const gap = clamp(ts - this.lastFrameTs, 0, 120);
        this.frameEma = this.frameEma * 0.96 + gap * 0.04;
        if (!this.lowQuality && this.frameEma > 26 && ++this.slowCount > 90) { this.lowQuality = true; this.fx.density = 0.55; this.slowCount = 0; }
        else if (this.lowQuality && this.frameEma < 19 && ++this.fastCount > 240) { this.lowQuality = false; this.fx.density = 1; this.fastCount = 0; }
        if (this.frameEma <= 26) this.slowCount = 0;
        if (this.frameEma >= 19) this.fastCount = 0;
      }
      this.lastFrameTs = ts;
    }

    // 步行过渡随渲染帧更新；静止姿势保持不变。倒影、残影复用缓冲。
    updateSprite(f, frame, ts) {
      const i = f.seat === 1 ? 1 : 0;
      let S = this.sprites[i];
      if (!S) S = this.sprites[i] = { canvas: document.createElement('canvas'), sig: '', at: -1e9 };
      const px = CS * this.scale;
      const w = Math.max(8, Math.ceil(SP.w * px)), h = Math.max(8, Math.ceil(SP.h * px));
      const flash = f.hitFlash > 0 ? Math.round(clamp(f.hitFlash / 8, 0, 1) * 0.7 * 8) / 8 : 0;
      const pose = A.animationPose(f, frame);
      const sig = `${f.id}|${pose.name}|${Math.round(pose.blend * 64)}|${f.state}|${f.skillMove || ''}|${f.dead ? 1 : 0}|${f.win ? 1 : 0}|${flash}|${w}|${A.assetReady(f.id) ? 1 : 0}`;
      const slow = f.state === 'idle' || f.state === 'jump';
      const interval = this._reduced ? 120 : this.lowQuality ? (slow ? 100 : 50) : slow ? 50 : 33;
      if (S.canvas.width !== w || S.canvas.height !== h) { S.canvas.width = w; S.canvas.height = h; S.sig = ''; S.ctx = null; }
      if (sig !== S.sig || ts - S.at >= interval) {
        const c = S.ctx || (S.ctx = S.canvas.getContext('2d'));
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
        c.setTransform(px, 0, 0, px, SP.ox * px, SP.oy * px);
        A.drawCharacter(c, f, frame, { reduced: this._reduced, flash, lw: 1.3, noFlicker: true });
        if (flash > 0) {
          // 受击闪白：人物与手持乐器一起提亮
          c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-atop'; c.globalAlpha = Math.min(0.85, flash * 1.15);
          c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        }
        this.lightSprite(S, w, h);
        S.sig = sig; S.at = ts;
      }
      return S;
    }

    // Light only the existing pixels, without expanding the silhouette.
    lightSprite(S, w, h) {
      const c = S.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-atop';
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,.13)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(20,6,60,.24)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }

    drawFighter(c, f, frame, ts) {
      const S = this.updateSprite(f, frame, ts);
      c.save();
      c.translate(f.x, f.y); c.scale(f.facing === -1 ? -1 : 1, 1);
      if (f.invuln > 0 && !this._reduced) c.globalAlpha = 0.78 + 0.18 * Math.cos(frame * 0.5);
      c.drawImage(S.canvas, -SP.ox * CS, -SP.oy * CS, SP.w * CS, SP.h * CS);
      c.restore();
    }

    drawReflection(c, f) {
      const S = this.sprites[f.seat === 1 ? 1 : 0];
      if (!S) return;
      c.save();
      c.beginPath(); c.rect(0, GROUND, W, 130); c.clip();
      c.globalAlpha = 0.16;
      c.translate(f.x, 2 * GROUND - f.y + 3); c.scale(f.facing === -1 ? -1 : 1, -1);
      c.drawImage(S.canvas, -SP.ox * CS, -SP.oy * CS, SP.w * CS, SP.h * CS);
      c.restore();
    }

    drawShadow(c, f, mine, ts) {
      const height = Math.max(0, GROUND - f.y), k = clamp(1 - height / 340, 0.25, 1);
      c.save();
      c.translate(f.x, GROUND - 1); c.scale(1, 0.2);
      const g = c.createRadialGradient(0, 0, 2, 0, 0, 52 * k);
      g.addColorStop(0, 'rgba(0,0,0,.62)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 52 * k, 0, Math.PI * 2); c.fill();
      c.restore();
      if (mine && !f.dead) {
        const T = FX.tone(f.id);
        c.save(); c.globalCompositeOperation = 'lighter';
        c.strokeStyle = T.main; c.globalAlpha = 0.55 + 0.2 * Math.sin(ts / 260); c.lineWidth = 2;
        c.beginPath(); c.ellipse(f.x, GROUND - 1, 44, 9, 0, 0, Math.PI * 2); c.stroke();
        c.restore();
      }
    }

    drawAura(c, f, ts) {
      if (f.dead) return;
      const T = FX.tone(f.id);
      if (f.armor > 0) {
        c.save(); c.globalCompositeOperation = 'lighter';
        const p = 0.5 + 0.5 * Math.sin(ts / 120);
        FX.glow(c, f.x, f.y - 82 * CS, 104, T.main, 0.3 + 0.1 * p);
        // 缓慢旋转的六边形护盾
        c.translate(f.x, f.y - 84 * CS); c.rotate(ts / 900);
        c.strokeStyle = T.hi; c.globalAlpha = 0.5 + 0.2 * p; c.lineWidth = 2.2;
        c.beginPath();
        for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3, r = 86; (i ? c.lineTo : c.moveTo).call(c, Math.cos(a) * r, Math.sin(a) * r * 1.05); }
        c.stroke();
        c.globalAlpha = 0.18; c.fillStyle = T.main; c.fill();
        c.restore();
      }
      if (f.invuln > 0 && !this._reduced) {
        c.save(); c.globalCompositeOperation = 'lighter';
        FX.glow(c, f.x, f.y - 84 * CS, 92, '#ffffff', 0.16 + 0.08 * Math.sin(ts / 70));
        c.restore();
      }
    }

    drawMarker(c, f, ts) {
      const T = FX.tone(f.id), y = f.y - 178 * CS - 16 + Math.sin(ts / 240) * 3;
      c.save(); c.translate(f.x, y);
      c.globalCompositeOperation = 'lighter';
      FX.glow(c, 0, 4, 18, T.main, 0.6);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = T.hi; c.strokeStyle = 'rgba(10,6,24,.9)'; c.lineWidth = 2.4; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-8, -4); c.lineTo(8, -4); c.lineTo(0, 8); c.closePath(); c.stroke(); c.fill();
      c.restore();
    }

    // 胜者头顶落下花瓣与星光
    celebrate(f, ts) {
      if (this._reduced) return;
      const a = this.fx.acc, key = 'win';
      if (ts - (a[key] || 0) < 90) return;
      a[key] = ts;
      const x = 80 + Math.random() * 1120, T = FX.tone(f.id);
      this.fx.petals(x, -12, 1, f.id, { dir: Math.PI / 2, spread: 0.5, v0: 0.8, v1: 2.2, g: 0.012, l0: 170, l1: 260, jx: 4, jy: 2 });
      if (Math.random() < 0.5) this.fx.twinkles(f.x + (Math.random() - 0.5) * 120, f.y - 40 - Math.random() * 130, 1, 4, T.hi, { vy: -0.6, l0: 30, l1: 56 });
    }

    dustTrail(f, ts) {
      if (f.state !== 'walk' || f.dead || this._reduced) return;
      const a = this.fx.acc, key = 'run' + f.id;
      if (ts - (a[key] || 0) < 150) return;
      a[key] = ts;
      this.fx.dust(f.x - f.facing * 18, GROUND - 2, 1, '#cfc6e6', { dir: -f.facing, jx: 4 });
    }
  }

  window.ArenaRenderer = ArenaRenderer;
})();
