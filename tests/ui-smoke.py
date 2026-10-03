"""Real Edge / Playwright smoke checks, using the bundled Node Playwright.

Python only orchestrates the installed Node runtime (Python Playwright is absent).
Run with --help for runtime overrides. Outputs stay in .scratch/ui-*.
The PVE clock drives normal browser rAF callbacks; it never mutates combat state.
PVP uses real HTTP, two isolated browser contexts, and real WebSocket messages.
"""
from pathlib import Path
import argparse
import os
import shutil
import subprocess


SCRIPT = r'''
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.UI_PLAYWRIGHT);
const root = path.resolve(__dirname, '..');
const { createGameServer } = require(path.join(root, 'server.js'));
const output = name => path.join(root, '.scratch', `ui-${name}`);
const report = { started: new Date().toISOString(), checks: [], browserErrors: [], resourceErrors: [], screenshots: [] };
let browser, app;
const ctxs = [];
const maps = new Map();
const sent = new Map();
const sessions = new Map();
const mobileSurfaces = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = page => page.evaluate(() => window.AveGame.getState());
function record(name, detail = {}) { report.checks.push({ name, passed: true, ...detail }); console.log(`PASS ${name} ${JSON.stringify(detail)}`); }
async function group(name, fn) {
  if (process.env.UI_ONLY && !name.toLowerCase().startsWith(process.env.UI_ONLY.toLowerCase())) return;
  try { await fn(); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack || String(error) }); console.log(`FAIL ${name}: ${error.message}`); }
}
async function waitState(page, predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const s = await state(page); if (predicate(s)) return s; await sleep(40); }
  throw new Error(`Timed out waiting for state: ${JSON.stringify(await state(page)).slice(0, 400)}`);
}
async function capture(page, name, fullPage = false) {
  const mobile = mobileSurfaces.get(page);
  await sessions.get(page).send('Emulation.setTouchEmulationEnabled', mobile ? {enabled:true,maxTouchPoints:1} : {enabled:false});
  const filename = output(`${name}.png`); await page.screenshot({ path: filename, fullPage }); report.screenshots.push(filename);
  await sessions.get(page).send('Emulation.setTouchEmulationEnabled', mobile ? {enabled:true,maxTouchPoints:1} : {enabled:false});
}
async function overflow(page, name) {
  const dims = await page.evaluate(() => ({ inner: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, height: innerHeight,
    coarse:matchMedia('(pointer:coarse)').matches,fine:matchMedia('(pointer:fine)').matches,hover:matchMedia('(hover:hover)').matches,touches:navigator.maxTouchPoints,
    joystick:getComputedStyle(document.getElementById('joystick')).display }));
  assert.ok(dims.document <= dims.inner + 1 && dims.body <= dims.inner + 1, JSON.stringify(dims)); record(name, dims);
}
// The two HP bars must be one fixed length, equal and mirrored about the clock, and a skill name appearing
// in the label row must never stretch, shrink or shift them (they used to shrink-wrap to the label).
async function hudBars(page, name, minimum) {
  const measure = () => page.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: +r.left.toFixed(1), right: +r.right.toFixed(1), width: +r.width.toFixed(1) }; };
    return { left: box('.left-hud .health-track'), right: box('.right-hud .health-track'), viewport: innerWidth };
  });
  const setSkillText = text => page.evaluate(value => {
    for (const id of ['left-skill', 'right-skill']) { const el = document.getElementById(id); el.textContent = value; el.classList.toggle('on', !!value); }
  }, text);
  await setSkillText('');
  const before = await measure();
  await setSkillText('弦在哭弦在哭弦在哭弦在哭');
  const during = await measure();
  await setSkillText('');
  assert.ok(Math.abs(before.left.width - before.right.width) <= 1, 'HP bars differ in length: ' + JSON.stringify(before));
  assert.ok(before.left.width >= minimum, 'HP bars are too short: ' + JSON.stringify(before));
  assert.ok(Math.abs(before.left.x - (before.viewport - before.right.right)) <= 2, 'HP bars are not mirrored: ' + JSON.stringify(before));
  for (const side of ['left', 'right']) for (const key of ['x', 'width']) {
    assert.ok(Math.abs(during[side][key] - before[side][key]) <= 0.5, `a skill name moved the ${side} HP bar (${key}): ` + JSON.stringify({ before, during }));
  }
  record(name, { length: before.left.width, left: before.left.x, right: before.right.right, viewport: before.viewport });
}
async function newPage(name, viewport = { width: 844, height: 390 }, clock = false, mobile = true) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
    ...(mobile ? {userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'} : {}) }); ctxs.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  mobileSurfaces.set(page, mobile);
  sessions.set(page, await context.newCDPSession(page));
  if (clock) await page.clock.install();
  const snaps = new Map(); const inputs = []; maps.set(page, snaps); sent.set(page, inputs);
  page.on('pageerror', error => report.browserErrors.push({ name, message: String(error) }));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) report.resourceErrors.push({ name, status: response.status(), url: response.url() }); });
  page.on('websocket', ws => {
    ws.on('framereceived', event => { try { const m = JSON.parse(String(event.payload)); if (m.type === 'snapshot') { snaps.set(m.snapshot.frame, JSON.stringify(m.snapshot)); if (snaps.size > 500) snaps.delete(snaps.keys().next().value); } } catch {} });
    ws.on('framesent', event => { try { const m = JSON.parse(String(event.payload)); if (m.type === 'input') inputs.push({ seq: m.seq, input: m.input }); } catch {} });
  });
  await page.goto(`http://127.0.0.1:${process.env.UI_PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.AveGame && !!window.GameAudio);
  const compiledStyles = await page.evaluate(() => ({
    tailwindHeight: getComputedStyle(document.querySelector('.min-h-screen')).minHeight,
    viewportHeight: innerHeight,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    chamfer: getComputedStyle(document.querySelector('#start-btn')).clipPath,
    preflight: getComputedStyle(document.querySelector('#mode-pve')).borderTopWidth,
    nativeCanvas: document.querySelector('#arena') instanceof HTMLCanvasElement,
  }));
  assert.equal(compiledStyles.tailwindHeight, compiledStyles.viewportHeight + 'px');
  assert.equal(compiledStyles.ink, '#07080c', 'design tokens from tailwind.css are missing');
  assert.notEqual(compiledStyles.chamfer, 'none', 'component CSS from kit.css is missing');
  assert.equal(compiledStyles.preflight, '0px', 'Tailwind preflight did not reset button borders');
  assert.equal(compiledStyles.nativeCanvas, true);
  assert.equal(await page.evaluate(() => MujicaArt.ready), true, 'generated character images did not load');
  assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), true);
  if (mobile) await page.locator('#help-done').tap(); else await page.locator('#help-done').click();
  record(name + ' input emulation', await page.evaluate(() => ({coarse:matchMedia('(pointer:coarse)').matches,fine:matchMedia('(pointer:fine)').matches,hover:matchMedia('(hover:hover)').matches,touches:navigator.maxTouchPoints})));
  return page;
}
async function selectAllCharacters(page, name) {
  const ids = ['gale', 'iron', 'shadow', 'pyro', 'bastion'];
  assert.equal(await page.locator('#character-roster [data-character]').count(), ids.length);
  for (const id of ids) {
    const card = page.locator(`#character-roster [data-character="${id}"]`);
    if (mobileSurfaces.get(page)) await card.tap(); else await card.click();
    assert.equal(await card.getAttribute('aria-pressed'), 'true', id + ' selection is not announced');
    assert.equal(await page.locator('#character-roster [aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('#portrait').getAttribute('data-character'), id, id + ' showcase and card disagree');
    assert.ok((await page.locator('#portrait').getAttribute('aria-label')).endsWith('的立绘'));
    assert.ok(await page.locator('#portrait').isVisible());
  }
  record(name + ' all five character cards update selected showcase and accessibility state');
}
async function controlBounds(page, name) {
  const boxes = await page.locator('[data-action]').evaluateAll(buttons => buttons.map(button => {
    const r = button.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {action:button.dataset.action,x:r.x,y:r.y,width:r.width,height:r.height,
      inside:r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      exposed:!!top && (top === button || button.contains(top))};
  }));
  assert.equal(boxes.length, 5);
  assert.deepEqual(boxes.map(box => box.action).sort(), ['punch','skill1','skill2','special','ult']);
  for (const box of boxes) assert.ok(box.inside && box.exposed && box.width >= 40 && box.height >= 40, JSON.stringify(box));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlapX = Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
    const overlapY = Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    assert.ok(overlapX <= 1 || overlapY <= 1, 'attack buttons overlap: '+a.action+'/'+b.action);
  }
  record(name + ' five usable attack targets stay exposed inside viewport', {boxes});
}
async function cdpTouch(page, selector, dx = 0, dy = 0, advance = 0, clock = false) {
  const session = sessions.get(page);
  await session.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
  const box = await page.locator(selector).boundingBox(); assert.ok(box, selector + ' has no visible box');
  const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
  const hit = await page.evaluate(({x,y,selector}) => { const el = document.querySelector(selector); const top = document.elementFromPoint(x,y); return !!top && (top === el || el.contains(top)); }, {x,y,selector});
  assert.equal(hit, true, selector + ' is covered or outside viewport');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  if (advance) { if (clock) await page.clock.runFor(advance); else await sleep(advance); }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function clockAdvance(page, milliseconds) { await page.clock.runFor(milliseconds); }
async function pauseClock(page) { await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000))); }
async function clickClock(page, selector) { await cdpTouch(page, selector); await clockAdvance(page, 20); }

(async () => {
  app = createGameServer({ host: '127.0.0.1', port: Number(process.env.UI_PORT), duration: 10, introFrames: 0 });
  await app.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.UI_EDGE, args: ['--autoplay-policy=no-user-gesture-required'] });
  report.runtime = { edge: process.env.UI_EDGE, playwright: require(path.join(process.env.UI_PLAYWRIGHT, 'package.json')).version, testServer: { port: Number(process.env.UI_PORT), pvpDuration: 10, introFrames: 0 } };
  await group('desktop layout, selection, keyboard, pause and room', async () => {
    const page = await newPage('desktop', {width:1440,height:900}, true, false);
    const media = await page.evaluate(() => ({fine:matchMedia('(pointer:fine)').matches,coarse:matchMedia('(pointer:coarse)').matches,touches:navigator.maxTouchPoints}));
    assert.equal(media.fine,true); assert.equal(media.coarse,false); assert.equal(media.touches,0);
    await overflow(page,'desktop menu no horizontal overflow');
    await selectAllCharacters(page,'desktop');
    await page.locator('#character-roster [data-character="shadow"]').click();
    await capture(page,'menu-desktop',true);
    await page.locator('#settings-btn').click(); await capture(page,'settings-desktop');
    assert.equal(await page.locator('#char-style, #stage-mask').count(), 0);
    const art = await page.evaluate(() => ({ source: MujicaArt.source, failures: MujicaArt.failures,
      ready: AveCombat.characters.every(c => MujicaArt.assetReady(c.id)),
      avatars: Array.from(document.querySelectorAll('.card-face')).map(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight })) }));
    assert.equal(art.source, 'generated-images'); assert.equal(art.ready, true); assert.deepEqual(art.failures, []);
    assert.equal(art.avatars.length, 5);
    for (const img of art.avatars) { assert.match(img.src, /^assets\/characters\//); assert.ok(img.width >= 256 && img.height >= 256); }
    record('all five generated atlases, portraits, cut-ins and avatars load; old art settings are removed');
    await page.locator('#settings-dialog .dialog-close').click();
    await page.locator('#opponent-roster [data-character="bastion"]').click();
    await page.locator('#start-btn').click(); await pauseClock(page); await clockAdvance(page,2700);
    let s=await state(page); assert.equal(s.screen,'battle'); assert.equal(s.snapshot.intro,0);
    assert.equal(await page.locator('#joystick').isVisible(),false);
    assert.equal(await page.locator('.keyboard-guide').isVisible(),true);
    await controlBounds(page,'desktop battle'); await hudBars(page,'desktop HP bars are one stable, equal length',300);
    const x=s.snapshot.fighters[0].x;
    await page.keyboard.down('a'); await clockAdvance(page,300); await page.keyboard.up('a');
    assert.ok((await state(page)).snapshot.fighters[0].x < x-30);
    await page.keyboard.press('w'); await clockAdvance(page,120);
    assert.ok((await state(page)).snapshot.fighters[0].y < 602);
    await clockAdvance(page,1000);
    let attacked=false;
    for(let retry=0;retry<30&&!attacked;retry++) {
      s=await state(page);
      if(!['skill','punch','stun','dead'].includes(s.snapshot.fighters[0].state)) await page.keyboard.press('j');
      await clockAdvance(page,60);
      attacked=(await state(page)).snapshot.events.some(e=>e.kind==='attack'&&e.actor===0);
    }
    assert.equal(attacked,true); record('desktop keyboard moves, jumps and attacks through ordinary events');
    await overflow(page,'desktop battle no horizontal overflow'); await capture(page,'battle-desktop');
    await page.locator('#pause-btn').click(); const frame=(await state(page)).snapshot.frame;
    await clockAdvance(page,700); assert.equal((await state(page)).snapshot.frame,frame); assert.equal((await state(page)).paused,true);
    await capture(page,'pause-desktop');
    await page.locator('#resume-btn').click(); await clockAdvance(page,300); assert.ok((await state(page)).snapshot.frame>frame);
    await page.locator('#pause-btn').click(); await page.locator('#quit-btn').click(); assert.equal((await state(page)).screen,'menu');
    await page.locator('#mode-pvp').click(); await page.locator('#create-btn').click();
    const roomState=await waitState(page,value=>value.screen==='room'); assert.match(roomState.room,/^\d{6}$/);
    await overflow(page,'desktop room no horizontal overflow');
    await page.locator('#room-roster [data-character="gale"]').click(); await page.locator('#ready-btn').click();
    await page.waitForFunction(()=>document.getElementById('ready-btn').textContent.includes('取消'));
    await capture(page,'room-desktop');
    await page.locator('#leave-room').click(); assert.equal((await state(page)).screen,'menu');
    record('desktop pause/resume/quit and selectable ready room remain usable'); await page.context().close();
  });
  await group('PVE touch, settings, pause, result and rematch', async () => {
    const page = await newPage('pve', { width:844, height:390 }, true);
    record('first help dismissed', { helpOpen: await page.locator('#help-dialog').evaluate(el => el.open) });
    await overflow(page, 'landscape menu no horizontal overflow'); await capture(page, 'menu-landscape', true);
    await page.locator('#settings-btn').tap();
    await page.locator('#music-volume').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const savedMusicVolume = await page.locator('#music-volume').inputValue();
    await page.locator('#low-motion').check();
    await page.locator('#settings-dialog .dialog-close').tap();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), false);
    await page.locator('#settings-btn').tap();
    assert.equal(await page.locator('#music-volume').inputValue(), savedMusicVolume); assert.equal(await page.locator('#low-motion').isChecked(), true);
    await capture(page,'settings-landscape');
    await page.locator('#settings-dialog .dialog-close').tap(); record('settings and help dismissal persist after reload');
    await selectAllCharacters(page,'landscape');
    await page.locator('#character-roster [data-character="shadow"]').tap();
    await page.locator('#opponent-roster [data-character="bastion"]').tap();
    await page.locator('#start-btn').tap();
    await pauseClock(page);
    await clockAdvance(page, 2700);
    let s = await state(page); assert.equal(s.screen, 'battle'); assert.equal(s.paused, false, JSON.stringify(s)); assert.equal(s.snapshot.intro, 0); assert.equal(s.snapshot.fighters[0].id, 'shadow');
    record('PVE starts and countdown finishes', { frame: s.snapshot.frame, timeLeft: s.snapshot.timeLeft });
    const x = s.snapshot.fighters[0].x;
    await cdpTouch(page, '#joystick', -30, 0, 300, true);
    s = await state(page); assert.ok(s.snapshot.fighters[0].x < x - 30); record('touch joystick moves fighter', { from: x, to: s.snapshot.fighters[0].x });
    await cdpTouch(page, '#joystick', 0, -30, 120, true);
    s = await state(page); assert.ok(s.snapshot.fighters[0].y < 602); record('touch joystick jumps', { y: s.snapshot.fighters[0].y });
    await clockAdvance(page, 1000);
    const beforeMp = (await state(page)).snapshot.fighters[0].mp;
    await clickClock(page, '[data-action="ult"]'); await clockAdvance(page, 80);
    s = await state(page); assert.notEqual(s.snapshot.fighters[0].skillMove, 'shadow_ult'); assert.ok(s.snapshot.fighters[0].mp >= beforeMp);
    record('uncharged ultimate blocked and energy percentage visible', { label: await page.locator('[data-action="ult"] .cooldown').textContent() });
    await clickClock(page, '[data-action="special"]'); await clockAdvance(page, 160);
    s = await state(page); assert.ok(s.snapshot.fighters[0].cd0 > 0); assert.equal(s.snapshot.fighters[0].mp, 200);
    assert.match(await page.locator('[data-action="special"] .cooldown').textContent(), /\d/);
    record('special cooldown and original shadow energy skill work', { cooldown: s.snapshot.fighters[0].cd0, mp: s.snapshot.fighters[0].mp });
    await clockAdvance(page, 400); await clickClock(page, '[data-action="ult"]'); await clockAdvance(page, 150);
    s = await state(page); assert.equal(s.snapshot.fighters[0].skillMove, 'shadow_ult'); assert.ok(s.snapshot.fighters[0].mp < 200);
    record('charged ultimate fires through touch button', { state: s.snapshot.fighters[0].state, move: s.snapshot.fighters[0].skillMove, mp: s.snapshot.fighters[0].mp });
    await clockAdvance(page, 1100);
    for (const [action, cd] of [['skill1','cd1'], ['skill2','cd2']]) {
      // A real AI may hit during the click. Retry ordinary input after recovery,
      // rather than assuming an interrupted fighter can act immediately.
      for (let retry = 0; retry < 30; retry++) {
        s = await state(page);
        if (!['skill','punch','stun','dead'].includes(s.snapshot.fighters[0].state)) await clickClock(page, `[data-action="${action}"]`);
        await clockAdvance(page, 80); s = await state(page); if (s.snapshot.fighters[0][cd] > 0) break;
      }
      assert.ok(s.snapshot.fighters[0][cd] > 0, action + ' did not activate: ' + JSON.stringify(s.snapshot.fighters[0]));
      assert.match(await page.locator(`[data-action="${action}"] .cooldown`).textContent(), /\d/); record(action + ' touch activation and cooldown', { value: s.snapshot.fighters[0][cd] }); await clockAdvance(page, 700);
    }
    let punchObserved = false;
    for (let retry = 0; retry < 30 && !punchObserved; retry++) {
      s = await state(page); if (!['skill','punch','stun','dead'].includes(s.snapshot.fighters[0].state)) await clickClock(page, '[data-action="punch"]');
      await clockAdvance(page, 80); s = await state(page); punchObserved = s.snapshot.events.some(e => e.kind === 'attack' && e.actor === 0);
    }
    assert.equal(punchObserved, true); record('normal attack touch activation'); await clockAdvance(page, 500);
    await controlBounds(page,'landscape battle'); await hudBars(page,'landscape HP bars are one stable, equal length',200);
    await overflow(page, 'landscape battle no horizontal overflow'); await capture(page, 'battle-landscape');
    await clickClock(page, '#pause-btn'); const frozen = (await state(page)).snapshot.frame;
    await clockAdvance(page, 1000); assert.equal((await state(page)).snapshot.frame, frozen); assert.equal((await state(page)).paused, true);
    await capture(page,'pause-landscape');
    await clickClock(page, '#resume-btn'); await clockAdvance(page, 500); assert.ok((await state(page)).snapshot.frame > frozen);
    record('PVE pause freezes simulation and resume advances it', { frozen });
    // Drive the real local engine through rAF, with ordinary keyboard attacks.
    const combatStart = (await state(page)).snapshot.frame;
    for (let i = 0; i < 90 && !(await state(page)).finished; i++) {
      s = await state(page); const me = s.snapshot.fighters[0], other = s.snapshot.fighters[1];
      const direction = me.x < other.x ? 'd' : 'a'; await page.keyboard.down(direction);
      for (const key of ['j','k','u','i','l']) await page.keyboard.press(key);
      await clockAdvance(page, 900); await page.keyboard.up(direction);
      if (i % 10 === 0) console.log(`PVE progress ${i} time=${(await state(page)).snapshot.timeLeft.toFixed(1)}`);
    }
    s = await state(page); assert.equal(s.finished, true); assert.ok(s.snapshot.result); assert.equal(s.records.played, 1);
    assert.equal(await page.locator('#result-overlay').isVisible(), true); await capture(page, 'result-pve');
    record('PVE real combat produces result and record', { fromFrame: combatStart, frame: s.snapshot.frame, result: s.snapshot.result, records: s.records });
    await clickClock(page, '#rematch-btn'); s = await state(page); assert.equal(s.finished, false); assert.ok(s.snapshot.frame < 10); assert.equal(s.records.played, 1);
    record('PVE rematch starts fresh world and retains record');
    await clickClock(page, '#pause-btn'); await clickClock(page, '#quit-btn'); assert.equal((await state(page)).screen, 'menu');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ave-theatre-records-v2'))); assert.equal(saved.played, 1); record('PVE record persisted without counting early quit');
    await page.context().close();
  });
  await group('portrait layout and controls', async () => {
    const page = await newPage('portrait', { width:390, height:844 });
    await selectAllCharacters(page,'portrait');
    await overflow(page, 'portrait menu no horizontal overflow'); await capture(page, 'menu-portrait', true);
    await page.locator('#start-btn').tap(); assert.equal(await page.locator('#rotate-hint').isVisible(), true);
    await page.locator('#portrait-play').tap(); assert.equal(await page.locator('#rotate-hint').isVisible(), false);
    await page.waitForFunction(() => window.AveGame.getState().snapshot.intro === 0);
    await overflow(page, 'portrait battle no horizontal overflow');
    // Reset the browser's touch emulation before capture: Edge can revert its
    // pointer media after the full-page screenshot temporarily resizes viewport.
    const portraitSession = sessions.get(page);
    await portraitSession.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
    await overflow(page, 'portrait explicit touch emulation'); await controlBounds(page,'portrait battle'); await hudBars(page,'portrait HP bars are one stable, equal length',90); await capture(page, 'battle-portrait');
    const x = (await state(page)).snapshot.fighters[0].x;
    await cdpTouch(page, '#joystick', -30, 0, 250);
    assert.ok((await state(page)).snapshot.fighters[0].x < x - 20);
    for (const action of ['special','skill1','skill2','ult','punch']) await cdpTouch(page, `[data-action="${action}"]`);
    record('portrait joystick and all five attack buttons are inside viewport and receive touch');
    await page.locator('#pause-btn').tap(); const portraitFrame=(await state(page)).snapshot.frame;
    await sleep(200); assert.equal((await state(page)).snapshot.frame,portraitFrame); assert.equal((await state(page)).paused,true);
    await capture(page,'pause-portrait');
    await page.locator('#quit-btn').tap(); assert.equal((await state(page)).screen,'menu'); await page.context().close();
  });
  await group('PVP room, authority, result, rematch sequence and disconnect', async () => {
    const a = await newPage('pvp-a'); const b = await newPage('pvp-b-desktop',{width:1440,height:900},false,false); const c = await newPage('pvp-third');
    for (const p of [a,b,c]) { if(mobileSurfaces.get(p)) await p.locator('#mode-pvp').tap(); else await p.locator('#mode-pvp').click(); }
    await c.locator('#room-code').fill('999999'); await c.locator('#join-form button').tap();
    await c.waitForFunction(() => document.getElementById('menu-status').textContent.includes('不存在'));
    record('unknown room rejected with visible message', { message: await c.locator('#menu-status').textContent() });
    await a.locator('#create-btn').tap(); const sa = await waitState(a, s => s.screen === 'room'); const code = sa.room;
    assert.match(code, /^\d{6}$/); await capture(a, 'room');
    await b.locator('#room-code').fill(code); await b.locator('#join-form button').click(); const sb = await waitState(b, s => s.screen === 'room');
    assert.equal(sb.room, code); assert.equal(sb.seat, 1); record('two isolated clients create and join six digit private room', { code, seats: [sa.seat,sb.seat] });
    await c.locator('#room-code').fill(code); await c.locator('#join-form button').tap();
    await c.waitForFunction(() => document.getElementById('menu-status').textContent.includes('已满'));
    record('third client rejected with visible room-full message'); await c.context().close();
    await a.locator('#room-roster [data-character="shadow"]').tap();
    await capture(a,'room-paired');
    await capture(b,'room-paired-desktop');
    await a.setViewportSize({width:390,height:844}); await overflow(a,'portrait paired room no horizontal overflow'); await capture(a,'room-paired-portrait',true);
    await a.setViewportSize({width:844,height:390});
    await a.locator('#ready-btn').tap(); assert.equal((await state(a)).screen, 'room');
    await b.locator('#ready-btn').click(); await waitState(a, s => s.screen === 'battle' && s.snapshot); await waitState(b, s => s.screen === 'battle' && s.snapshot);
    assert.equal((await state(a)).snapshot.fighters[0].id, 'shadow'); record('selection and both-ready start authoritative battle');
    const x = (await state(a)).snapshot.fighters[0].x; await cdpTouch(a, '#joystick', -30, 0, 300); assert.ok((await state(a)).snapshot.fighters[0].x < x - 30);
    const ax = (await state(a)).snapshot.fighters[0].x; await sleep(140); const bx = (await state(b)).snapshot.fighters[0].x; assert.ok(bx < x - 30);
    let common = 0; for (const [frame, serialized] of maps.get(a)) if (maps.get(b).has(frame)) { assert.equal(maps.get(b).get(frame), serialized); common++; }
    assert.ok(common >= 3); record('both clients receive identical authority snapshots and remote movement', { commonFrames: common, ax, bx });
    await a.locator('#pause-btn').tap(); assert.equal((await state(a)).paused, false);
    await capture(a,'pause-pvp');
    const frame = (await state(a)).snapshot.frame; await sleep(300); assert.ok((await state(a)).snapshot.frame > frame); await a.locator('#resume-btn').tap();
    record('PVP pause menu explains and preserves continuing match');
    await waitState(a, s => s.finished && s.snapshot.result, 12000); await waitState(b, s => s.finished && s.snapshot.result, 1000);
    assert.deepEqual((await state(a)).snapshot, (await state(b)).snapshot); await capture(a, 'result-pvp');
    assert.equal(await b.locator('#result-overlay').isVisible(),true); await capture(b,'result-desktop');
    await a.setViewportSize({width:390,height:844}); assert.equal(await a.locator('#result-overlay').isVisible(),true);
    await overflow(a,'portrait result no horizontal overflow'); await capture(a,'result-portrait');
    await a.setViewportSize({width:844,height:390});
    record('real online result remains visible on desktop, landscape and portrait');
    const seqBefore = sent.get(a).at(-1).seq; assert.ok(seqBefore > 100); const oldResultFrame = (await state(a)).snapshot.frame;
    await a.locator('#rematch-btn').tap(); await sleep(100); assert.equal((await state(a)).finished, true);
    await b.locator('#rematch-btn').click(); await waitState(a, s => !s.finished && s.snapshot && s.snapshot.frame < oldResultFrame); await waitState(b, s => !s.finished);
    await sleep(150); const seqAfter = sent.get(a).at(-1).seq; assert.ok(seqAfter > seqBefore, `${seqBefore} -> ${seqAfter}`);
    const rx = (await state(a)).snapshot.fighters[0].x; await cdpTouch(a, '#joystick', -30, 0, 300); assert.ok((await state(a)).snapshot.fighters[0].x < rx - 30);
    record('both clients must agree to rematch; sequence remains monotonic and controls work', { seqBefore, seqAfter });
    await b.context().close(); await waitState(a, s => s.finished && s.room === null, 3000);
    assert.equal(await a.locator('#pause-title').textContent(), '本场中断'); assert.equal(await a.locator('#resume-btn').isVisible(), false);
    record('disconnected opponent visibly ends battle', { message: await a.locator('#pause-description').textContent() }); await capture(a, 'disconnect');
    await a.locator('#quit-btn').tap(); assert.equal((await state(a)).screen, 'menu'); assert.equal(app.rooms.size, 0); record('disconnect cleanup returns survivor to usable menu'); await a.context().close();
  });
  await group('Vue lifecycle', async () => {
    const page = await newPage('lifecycle', { width: 1440, height: 900 }, false, false);
    await page.locator('#mode-pvp').click();
    await page.locator('#create-btn').click();
    const current = await waitState(page, s => s.screen === 'room');
    await page.evaluate(() => {
      const previousAudio = GameAudio.prototype.dispose;
      const previousRenderer = ArenaRenderer.prototype.destroy;
      window.__lifecycle = { audio: null, renderer: false };
      GameAudio.prototype.dispose = function() { previousAudio.call(this); window.__lifecycle.audio = this.context; };
      ArenaRenderer.prototype.destroy = function() { previousRenderer.call(this); window.__lifecycle.renderer = true; };
      const app = document.getElementById('app').__vue_app__;
      if (!app) throw new Error('Vue application was not mounted');
      app.unmount();
    });
    await sleep(250);
    assert.equal(await page.evaluate(() => typeof AveGame), 'undefined');
    assert.equal(await page.evaluate(() => window.__lifecycle.renderer), true);
    assert.equal(await page.evaluate(() => window.__lifecycle.audio.state), 'closed');
    assert.equal(app.rooms.has(current.room), false);
    record('Vue unmount disposes renderer, native audio, diagnostics and its online room');
    await page.context().close();
  });
  assert.equal(report.browserErrors.length, 0, JSON.stringify(report.browserErrors)); record('no uncaught browser errors');
  assert.equal(report.resourceErrors.length, 0, JSON.stringify(report.resourceErrors)); record('all game resources load locally without HTTP errors');
})().catch(error => { report.checks.push({name:'harness',passed:false,error:error.stack||String(error)}); console.error(error); }).finally(async () => {
  for (const context of ctxs) { try { await context.close(); } catch {} }
  if (browser) await browser.close(); if (app) await app.close();
  report.finished = new Date().toISOString(); fs.writeFileSync(output('report.json'), JSON.stringify(report,null,2));
  const failed = report.checks.filter(c => !c.passed); console.log(`REPORT ${report.checks.length-failed.length} passed, ${failed.length} failed: ${output('report.json')}`); process.exitCode = failed.length ? 1 : 0;
});
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--playwright', default='C:/Users/ruofa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
    parser.add_argument('--edge', default='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    parser.add_argument('--port', type=int, default=18080)
    parser.add_argument('--only', default='', help='optional group prefix, e.g. desktop, PVE, portrait or PVP')
    args = parser.parse_args()
    if not args.node or not Path(args.playwright).is_dir() or not Path(args.edge).is_file():
        parser.error('installed Node, Playwright module and Edge executable are required; override their paths above')
    root = Path(__file__).resolve().parents[1]
    scratch = root / '.scratch'
    scratch.mkdir(exist_ok=True)
    script = scratch / 'ui-smoke.cjs'
    script.write_text(SCRIPT, encoding='utf-8')
    env = dict(os.environ, UI_PLAYWRIGHT=args.playwright, UI_EDGE=args.edge, UI_PORT=str(args.port), UI_ONLY=args.only)
    return subprocess.call([args.node, str(script)], cwd=root, env=env)


if __name__ == '__main__':
    raise SystemExit(main())
