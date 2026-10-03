"""Random-fight render fuzz in a real browser (Edge + the bundled Node Playwright).

Every character pairing fights with random inputs while the real ArenaRenderer draws each
simulation frame, so every skill, hit, projectile, hazard, KO and rematch reset goes through
src/game/art.ts / fx.ts / stage.ts / renderer.ts. Any uncaught error or console error fails the run.
Paths mirror ui-smoke.py; use --help for overrides. Nothing is written outside .scratch/.
"""
from pathlib import Path
import argparse
import os
import shutil
import subprocess

LAB = r'''<!doctype html>
<meta charset="utf-8">
<canvas id="arena" style="width:1280px;height:720px;display:block"></canvas>
<script src="/__render-runtime.js"></script>
<script>
const q = new URLSearchParams(location.search);
const left = q.get('l'), right = q.get('r'), mode = q.get('mode') || 'normal';
const renderer = new ArenaRenderer(document.getElementById('arena'), AveCombat.characters);
if (mode === 'reduced') renderer.reducedMotion = true;
if (mode === 'low') { renderer.lowQuality = true; renderer.fx.density = 0.55; }
let seed = Number(q.get('seed') || 7), world, frame = 0, rng = 12345;
const rand = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
const hold = [{}, {}];
const counts = { hits: 0, skills: 0, kos: 0, matches: 0, frames: 0, seq: 0 };
function start() {
  world = AveCombat.createWorld({ left, right, mode: 'pvp', introFrames: 0, duration: 90, seed: seed++ });
  if (q.get('weak')) for (const f of world.fighters) { f.hp = 90; } // 低血量：很快分出胜负，覆盖 K.O.、胜利演出与重开
  counts.matches++; counts.seq = 0;
}
function inputs(f) {
  const arr = [{}, {}];
  for (let s = 0; s < 2; s++) {
    if (f % 9 === s) hold[s] = { left: rand() < .4, right: rand() < .4 };
    Object.assign(arr[s], hold[s]);
    for (const [k, p] of [['up', .03], ['punch', .12], ['special', .05], ['skill1', .05], ['skill2', .05], ['ult', .03]]) if (rand() < p) arr[s][k] = true;
  }
  if (f % 150 === 0) { world.fighters[0].mp = 200; world.fighters[1].mp = 200; }
  return arr;
}
window.runFrames = (n) => {
  start();
  for (let i = 0; i < n; i++) {
    world.step(inputs(frame++));
    const snap = world.snapshot();
    for (const e of snap.events) {
      if (e.seq <= counts.seq) continue;
      counts.seq = e.seq;
      if (e.kind === 'hit') counts.hits++; else if (e.kind === 'skill') counts.skills++; else if (e.kind === 'ko') counts.kos++;
    }
    renderer.draw(snap, 0, 1000 + (counts.frames++) * 16.667);
    if (snap.result) start(); // 分出胜负后开新的一局，渲染器必须能无缝重置
  }
  return counts;
};
window.checkAnimationFrames = async () => {
  const report = [];
  for (const id of ['pyro', 'shadow', 'gale', 'bastion', 'iron']) {
    const spec = MujicaArt.manifest.characters[id];
    if (Object.keys(spec.frames).length !== 24) throw new Error(id + ' does not contain 24 frames');
    const atlas = new Image(); atlas.src = MujicaArt.assetUrl(id, 'atlas'); await atlas.decode();
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
    const c = cv.getContext('2d', {willReadFrequently:true}), hashes = new Set();
    for (const [name, pose] of Object.entries(spec.frames)) {
      c.clearRect(0, 0, 512, 512); c.drawImage(atlas, ...pose.rect, 0, 0, 512, 512);
      const data = c.getImageData(0, 0, 512, 512).data;
      let hash = 2166136261, alpha = 0, edges = 0;
      for (let p = 0; p < data.length; p++) { hash = Math.imul(hash ^ data[p], 16777619); if (p % 4 === 3 && data[p]) alpha++; }
      for (let p = 0; p < 512; p++) edges += data[p*4+3]+data[(511*512+p)*4+3]+data[(p*512)*4+3]+data[(p*512+511)*4+3];
      if (!alpha || edges) throw new Error(id + ' ' + name + ' empty or touches packing edge');
      hashes.add(hash >>> 0);
    }
    if (hashes.size !== 24) throw new Error(id + ' contains duplicate frame pixels');
    const phases = {pyro:[0,4,10,33],shadow:[0,4,12,45],gale:[0,5,15,40],bastion:[0,5,15,44],iron:[0,8,20,50]}[id];
    const f = {id, stateT:0, anim:0}, used = new Set();
    for (const frame of [0,12,24,36,120,240]) {
      const name = MujicaArt.frameName({...f,state:'idle',anim:frame},frame);
      if (name !== 'idle-0') throw new Error(id+' idle pose changes with the clock');
      used.add(name);
    }
    for (const walkPhase of [0,.17,.34,.5,.67,.84]) used.add(MujicaArt.frameName({...f,state:'walk',walkPhase}));
    for (const vy of [-1,1]) used.add(MujicaArt.frameName({...f,state:'jump',vy}));
    for (const stateT of [0,3,5,12]) used.add(MujicaArt.frameName({...f,state:'punch',stateT}));
    for (const stateT of phases) used.add(MujicaArt.frameName({...f,state:'skill',stateT,skillMove:id+'_ult'}));
    for (const stateT of [0,10]) used.add(MujicaArt.frameName({...f,state:'stun',stateT}));
    for (const frame of [0,18]) used.add(MujicaArt.frameName({...f,state:'idle',win:true},frame));
    if (used.size !== 21 || [...used].some(name=>!spec.frames[name])) throw new Error(id+' has missing active animation frames');
    // Lighting must not expand alpha or create any silhouette outline.
    const before = c.getImageData(0,0,512,512).data;
    renderer.lightSprite({ctx:c},512,512);
    const after = c.getImageData(0,0,512,512).data;
    for(let p=3;p<before.length;p+=4) if(before[p]!==after[p]) throw new Error(id+' lighting expands/changes alpha');
    // The rendered idle pixels must stay identical, including the former
    // breathing/scale transform. Walk transitions still redraw between cells.
    const posePixels = (state, walkPhase, frame) => {
      c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,512,512);
      c.save(); c.translate(256,470);
      MujicaArt.drawCharacter(c,{id,state,walkPhase,stateT:frame,anim:frame},frame);
      c.restore();
      const data = c.getImageData(0,0,512,512).data;
      let hash = 2166136261;
      for (const value of data) hash = Math.imul(hash ^ value,16777619);
      return hash >>> 0;
    };
    const idlePixels = new Set([0,12,36,120,240].map(frame=>posePixels('idle',0,frame)));
    if (idlePixels.size !== 1) throw new Error(id+' rendered idle pixels are moving');
    const transitionPixels = new Set([.72,.81,.9,.98].map(phase=>posePixels('walk',phase/6,0)));
    if (transitionPixels.size !== 4) throw new Error(id+' walk frames do not blend smoothly');
    const heads = [], soles = [];
    for (let step=0;step<6;step++) {
      posePixels('walk',(step+.001)/6,0);
      const data=c.getImageData(0,0,512,512).data;
      let top=512,bottom=0,sum=0,count=0;
      for(let y=0;y<512;y++) {
        let opaque=0;
        for(let x=0;x<512;x++) if(data[(y*512+x)*4+3]>=192) opaque++;
        if(opaque>=3) {top=Math.min(top,y);bottom=y;}
      }
      for(let y=Math.round(top+(bottom-top)*.04);y<Math.round(top+(bottom-top)*.17);y++) {
        for(let x=0;x<512;x++) if(data[(y*512+x)*4+3]>=192) {sum+=x;count++;}
      }
      heads.push(sum/count);soles.push(bottom);
    }
    const headDrift=Math.max(...heads)-Math.min(...heads),soleDrift=Math.max(...soles)-Math.min(...soles);
    if(headDrift>1.5||soleDrift>1) throw new Error(id+' walks with head/ground jitter: '+headDrift+'/'+soleDrift);
    report.push({id,activeFrames:used.size,distinctPixelFrames:hashes.size,idlePixelsFixed:true,walkTransitionSamples:transitionPixels.size,headDrift,soleDrift,outlineAlphaPreserved:true});
  }
  return report;
};
window.checkMovementInterpolation = () => {
  const snapshot = {frame:0,fighters:[{id:'bastion',seat:0,x:100,y:600,state:'walk',walkPhase:.98,facing:1}]};
  const samples = [];
  renderer.track(snapshot,1000);
  for (let packet=1;packet<=4;packet++) {
    snapshot.frame = packet*3;
    snapshot.fighters[0].x += 15;
    snapshot.fighters[0].walkPhase = (snapshot.fighters[0].walkPhase+.1)%1;
    const at = 1000+packet*50;
    renderer.track(snapshot,at);
    for (const offset of [0,10,20,30,40]) samples.push(renderer.interpolate(snapshot,at+offset)[0]);
  }
  for (let i=1;i<samples.length;i++) {
    if (Math.abs(samples[i].x-samples[i-1].x-3)>1e-8) throw new Error('position pulses between network packets');
    const phaseDelta = (samples[i].walkPhase-samples[i-1].walkPhase+1)%1;
    if (Math.abs(phaseDelta-.02)>1e-8) throw new Error('walk phase jumps at cycle wrap or packet boundary');
  }
  for (const [index,state] of ['idle','walk'].entries()) {
    const f = snapshot.fighters[0], previous = f.walkPhase;
    snapshot.frame += 3; f.state = state; f.x += 6; f.walkPhase = (previous+.04)%1;
    const at = 1250 + index*50;
    renderer.track(snapshot,at);
    for (const offset of [0,25,50]) {
      const rendered = renderer.interpolate(snapshot,at+offset)[0];
      const delta = (rendered.walkPhase-previous+1)%1;
      if (Math.abs(delta-.04*offset/50)>1e-8) throw new Error('walk phase snaps on '+state+' transition');
    }
  }
  return {samples:samples.length,pixelsPerSample:3,phasePerSample:.02,startStopPhaseContinuous:true};
};
MujicaArt.ready.then(ok => { window.__assets = ok; window.__ready = true; });
</script>
'''

SCRIPT = r'''
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RF_PLAYWRIGHT);
const root = path.resolve(__dirname, '..');
const { createGameServer } = require(path.join(root, 'server.js'));
const { buildSync } = require('esbuild');
const runtime = buildSync({ stdin: { contents: `import Combat from './shared/combat.ts'; import Art from './src/game/art.ts'; import FX from './src/game/fx.ts'; import { ArenaRenderer } from './src/game/renderer.ts'; Object.assign(window, { AveCombat: Combat, MujicaArt: Art, MujicaFx: FX, ArenaRenderer });`, resolveDir: root }, bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
const lab = fs.readFileSync(path.join(root, '.scratch', 'render-lab.html'), 'utf8');
const ids = ['pyro', 'shadow', 'gale', 'bastion', 'iron'];
const frames = Number(process.env.RF_FRAMES || 600);
let browser, app, failed = 0, passed = 0;
const report = {started:new Date().toISOString(),checks:[]};
(async () => {
  app = createGameServer({ host: '127.0.0.1', port: Number(process.env.RF_PORT) });
  await app.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.RF_EDGE });
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i; j < ids.length; j++, n++) {
    const mode = n % 5 === 3 ? 'reduced' : n % 5 === 4 ? 'low' : 'normal';
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.route('**/__render-runtime.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: runtime }));
    await page.route('**/__render-lab.html*', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: lab }));
    try {
      await page.goto(`http://127.0.0.1:${process.env.RF_PORT}/__render-lab.html?l=${ids[i]}&r=${ids[j]}&mode=${mode}${n % 2 === 0 ? '&weak=1' : ''}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
      assert.equal(await page.evaluate(() => window.__assets), true, 'generated character images did not load');
      if (n === 0) {
        report.animationFrames = await page.evaluate(() => window.checkAnimationFrames());
        report.movementInterpolation = await page.evaluate(() => window.checkMovementInterpolation());
        console.log('PASS 120 distinct uncropped frames; fixed idle pixels, blended walking, constant packet interpolation, and unchanged alpha');
      }
      const counts = await page.evaluate(f => window.runFrames(f), frames);
      assert.equal(errors.length, 0, errors.slice(0, 3).join(' | '));
      // 随机操作：很短的运行里可能没有命中，所以命中 / K.O. 的断言只在帧数足够时才检查
      assert.ok(counts.skills > 0, 'random fight used no skills: ' + JSON.stringify(counts));
      if (frames >= 600) assert.ok(counts.hits > 0, 'random fight produced no hits: ' + JSON.stringify(counts));
      if (frames >= 600 && n % 2 === 0) assert.ok(counts.kos > 0 && counts.matches > 1, 'weak fighters should KO and restart: ' + JSON.stringify(counts));
      console.log(`PASS ${ids[i]} vs ${ids[j]} [${mode}/generated] ${JSON.stringify(counts)}`); passed++;
      report.checks.push({left:ids[i],right:ids[j],mode,passed:true,...counts});
    } catch (error) { console.log(`FAIL ${ids[i]} vs ${ids[j]} [${mode}]: ${error.message}`); failed++; report.checks.push({left:ids[i],right:ids[j],mode,passed:false,error:String(error)}); }
    await context.close();
  }
  console.log(`REPORT ${passed} passed, ${failed} failed`);
})().catch(error => { console.error(error); failed++; }).finally(async () => {
  report.finished=new Date().toISOString();fs.writeFileSync(path.join(root,'.scratch/render-fuzz-report.json'),JSON.stringify(report,null,2));
  try { if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); } catch {}
  try { if (app) await app.close(); } catch {}
  process.exit(failed ? 1 : 0);
});
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--playwright', default='C:/Users/ruofa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
    parser.add_argument('--edge', default='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    parser.add_argument('--port', type=int, default=18081)
    parser.add_argument('--frames', type=int, default=600, help='simulation frames per pairing (default 600)')
    args = parser.parse_args()
    if not args.node or not Path(args.playwright).is_dir() or not Path(args.edge).is_file():
        parser.error('installed Node, Playwright module and Edge executable are required; override their paths above')
    root = Path(__file__).resolve().parents[1]
    scratch = root / '.scratch'
    scratch.mkdir(exist_ok=True)
    (scratch / 'render-lab.html').write_text(LAB, encoding='utf-8')
    script = scratch / 'render-fuzz.cjs'
    script.write_text(SCRIPT, encoding='utf-8')
    env = dict(os.environ, RF_PLAYWRIGHT=args.playwright, RF_EDGE=args.edge, RF_PORT=str(args.port), RF_FRAMES=str(args.frames))
    return subprocess.call([args.node, str(script)], cwd=root, env=env)


if __name__ == '__main__':
    raise SystemExit(main())
