(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const engine = window.AveCombat;
  if (!engine || !window.ArenaRenderer) {
    $('menu-status').textContent = '游戏文件未加载完整，请通过“启动游戏”重新打开。';
    return;
  }
  const characters = engine.characters;
  const character = (id) => characters.find((item) => item.id === id) || characters[0];
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private browsing still supports matches */ } };
  const defaultVolumes = window.GameAudio?.defaultVolumes || { music: 1, sfx: 1, voice: 1 };
  const defaults = { player: 'pyro', opponent: 'shadow', difficulty: 'easy', ...defaultVolumes, lowMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  const saved = read('ave-theatre-settings-v2', {});
  const settings = { ...defaults, ...saved };
  // The old sticker/procedural figures have been removed, including their settings.
  delete settings.style; delete settings.mask; settings.artRev = window.MujicaCharacterAssets?.version || 7;
  // Apply the requested full-volume defaults once for existing saves; later
  // slider adjustments persist normally.
  if (saved.audioRev !== 3) Object.assign(settings, defaultVolumes);
  settings.audioRev = 3;
  if (!characters.some((c) => c.id === settings.player)) settings.player = defaults.player;
  if (!characters.some((c) => c.id === settings.opponent)) settings.opponent = defaults.opponent;
  if (!engine.difficulties[settings.difficulty]) settings.difficulty = 'easy';
  for (const key of ['music', 'sfx', 'voice']) settings[key] = Number.isFinite(settings[key]) ? Math.max(0, Math.min(1, settings[key])) : defaults[key];
  write('ave-theatre-settings-v2', settings);
  const records = { played: 0, won: 0, drawn: 0, bestStreak: 0, streak: 0, ...read('ave-theatre-records-v2', {}) };
  const audio = window.GameAudio ? new window.GameAudio(settings) : { unlock() {}, setScene() {}, setVolumes() {}, handle() {}, playVoice() {}, voiceAvailable: false };
  const renderer = new ArenaRenderer($('arena'), characters);
  const Art = window.MujicaArt;
  const stage = window.MujicaStage ? new window.MujicaStage.Stage() : null;
  const backdrop = $('backdrop'), backdropCtx = backdrop.getContext('2d', { alpha: false });
  backdrop.width = 1280; backdrop.height = 720;
  // 每个角色每个按键对应的技能图标（图标定义见 index.html 顶部的 SVG 精灵）
  const ICONS = {
    pyro: { special: 'curtain', skill1: 'note', skill2: 'wave', ult: 'meteor', punch: 'fist' },
    shadow: { special: 'string', skill1: 'mask', skill2: 'shadow', ult: 'cross', punch: 'fist' },
    gale: { special: 'scissors', skill1: 'dash', skill2: 'slash3', ult: 'bolt', punch: 'fist' },
    iron: { special: 'camera', skill1: 'shield', skill2: 'dash', ult: 'flame', punch: 'fist' },
    bastion: { special: 'quake', skill1: 'ring', skill2: 'slash2', ult: 'pillars', punch: 'fist' },
  };
  const look = (id) => (Art && Art.CHARS && Art.CHARS[id]) || { accent: '#7ea4f2', accent2: '#dbe8ff', glow: '#7ea4f2', dark: '#243a78', flowerCN: '', meaning: '' };
  function applyTheme(id) {
    const d = look(id), root = document.documentElement.style;
    root.setProperty('--accent', d.accent); root.setProperty('--accent2', d.accent2); root.setProperty('--dark', d.dark);
    root.setProperty('--glow', Art ? Art.rgba(d.glow, .55) : d.glow);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', d.dark);
  }
  // A generated cut-in can also stand in for a failed avatar request.
  function faceFallback(img, id) {
    try { const cv = document.createElement('canvas'); cv.width = 240; cv.height = 240; Art.drawShowcase(cv, id, 0, { mode: 'bust' }); img.src = cv.toDataURL(); } catch { img.removeAttribute('src'); }
  }
  let lastBackdropAt = 0, calloutText = '', cutinTimer = null, koTimer = null, versusTimer = null, versusShown = false;
  const hudState = [{ id: null }, { id: null }];
  let mode = 'pve', screen = 'menu', world = null, latest = null;
  let seat = 0, room = null, socket = null, socketGeneration = 0;
  let paused = false, finished = false, eventSeq = 0, inputSeq = 0, lastFrame = 0, accumulator = 0;
  let lastHudAt = 0, lastPortraitAt = 0, lastSendAt = 0, lastMessageAt = 0;
  let latency = null, pendingEntry = null, connectionTimeout = null, toastTimer = null, actionCharacter = null;
  let joystickPointer = null, stickUp = false, matchDuration = 90;
  let fightSpoken = false;
  const held = { left: false, right: false };
  const keys = new Set();
  const pulses = Object.create(null);
  const actionButtons = Array.from(document.querySelectorAll('[data-action]'));
  const fullNames = { gale: '若叶睦', iron: '祐天寺若麦', shadow: '三角初华', pyro: '丰川祥子', bastion: '八幡海铃' };
  const actionKeys = { KeyW: 'up', ArrowUp: 'up', Space: 'up', KeyJ: 'punch', KeyK: 'special', KeyU: 'skill1', KeyI: 'skill2', KeyL: 'ult', KeyO: 'ult' };
  const slots = { special: 's0', skill1: 's1', skill2: 's2', ult: 'ult', punch: 'punch' };
  const persist = () => write('ave-theatre-settings-v2', settings);
  function sound(method, ...args) { try { const result = audio[method]?.(...args); if (result?.catch) result.catch(() => {}); } catch { /* audio never controls gameplay */ } }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
  function status(message) { $(screen === 'room' ? 'room-status' : 'menu-status').textContent = message; }
  function show(name) {
    for (const id of ['menu', 'room', 'battle']) $(id).hidden = id !== name;
    screen = name;
    clearInputs();
    if (name !== 'battle') { world = null; paused = false; $('pause-overlay').hidden = true; }
    sound('setScene', name === 'battle' ? 'battle' : 'menu');
    if (name === 'menu') updateRecordLine();
  }
  function clearInputs() {
    keys.clear(); held.left = held.right = false;
    for (const action of Object.keys(pulses)) delete pulses[action];
    if (joystickPointer !== null) { try { $('joystick').releasePointerCapture(joystickPointer); } catch { /* already released */ } }
    joystickPointer = null; stickUp = false;
    $('stick-knob').style.transform = '';
    actionButtons.forEach((button) => button.classList.remove('pressed'));
  }
  function press(action, buttonPress = false) { if (screen !== 'battle' || paused || finished || !latest || latest.intro > 0 || !$('pause-overlay').hidden) return; pulses[action] = performance.now() + 160; if (buttonPress) sound('playUI', action); }
  function takeInput() {
    const now = performance.now();
    const input = { left: held.left || keys.has('KeyA') || keys.has('ArrowLeft'), right: held.right || keys.has('KeyD') || keys.has('ArrowRight'), down: false };
    for (const action of ['up', 'punch', 'special', 'skill1', 'skill2', 'ult']) { input[action] = (pulses[action] || 0) >= now; delete pulses[action]; }
    return input;
  }
  function makeRoster(target, selected, callback, compact = false) {
    target.replaceChildren();
    for (const c of characters) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `${compact ? 'opponent-card' : 'character-card'}${selected === c.id ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(selected === c.id)); button.setAttribute('aria-label', `${c.name} ${c.tag}`); button.dataset.character = c.id;
      if (!compact) {
        const d = look(c.id);
        button.style.setProperty('--c', d.accent); button.style.setProperty('--c-bg', d.dark); button.style.setProperty('--c-glow', Art ? Art.rgba(d.glow, .7) : d.glow);
        const face = document.createElement('img'); face.className = 'card-face'; face.alt = ''; face.decoding = 'async'; face.src = Art.assetUrl(c.id);
        face.addEventListener('error', () => faceFallback(face, c.id), { once: true }); button.appendChild(face);
      }
      const label = document.createElement(compact ? 'span' : 'strong'); label.textContent = c.name; button.appendChild(label);
      if (!compact) { const alias = document.createElement('span'); alias.className = 'card-alias'; alias.textContent = c.tag; button.appendChild(alias); }
      button.addEventListener('click', () => callback(c.id)); target.appendChild(button);
    }
  }
  function renderCardArt() {
    for (const canvas of document.querySelectorAll('canvas[data-portrait-id]')) {
      if (canvas.getClientRects().length) ArenaRenderer.drawPortrait(canvas, canvas.dataset.portraitId, characters, 1000);
    }
  }
  function renderMenu() {
    const c = character(settings.player);
    $('portrait').dataset.character = c.id;
    $('portrait').setAttribute('aria-label', `${fullNames[c.id]}的立绘`);
    applyTheme(c.id);
    $('opponent-name').textContent = character(settings.opponent).name;
    $('voice-preview-role').textContent = `${c.name} · 语音试听`;
    makeRoster($('character-roster'), settings.player, (id) => { settings.player = id; persist(); renderMenu(); sound('unlock'); sound('playVoice', id, 'select'); });
    makeRoster($('opponent-roster'), settings.opponent, (id) => { settings.opponent = id; persist(); renderMenu(); }, true);
    $('start-btn').disabled = !Art.assetReady(settings.player) || !Art.assetReady(settings.opponent);
    for (const button of document.querySelectorAll('[data-difficulty]')) { const active = button.dataset.difficulty === settings.difficulty; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  }
  function changeMode(next) {
    mode = next; $('pve-options').hidden = next !== 'pve'; $('pvp-options').hidden = next !== 'pvp';
    for (const id of ['pve', 'pvp']) { $(`mode-${id}`).classList.toggle('active', next === id); $(`mode-${id}`).setAttribute('aria-pressed', String(next === id)); }
    $('menu-status').textContent = '';
    if (next === 'pvp' && location.protocol === 'file:') $('online-status').textContent = '联机请双击“启动游戏”，再用浏览器打开显示的地址。';
    else if (next === 'pvp' && /(^|\.)github\.io$/i.test(location.hostname)) $('online-status').textContent = '这个页面只能人机对战。人人对战需要本机或云服务器上的游戏服务。';
  }
  function updateRecordLine() { $('record-line').textContent = records.played ? `${records.played} 场出演 · ${records.won} 场胜利 · 最佳连胜 ${records.bestStreak}` : '今晚，从第一场开始。'; }
  function openBattle() {
    show('battle'); paused = false; finished = false; eventSeq = 0; accumulator = 0; lastFrame = 0;
    $('pause-overlay').hidden = true; $('result-overlay').hidden = true; $('rematch-status').textContent = '';
    $('rematch-btn').disabled = false; $('rematch-btn').textContent = '再来一场';
    hudState.forEach((s) => { s.id = null; s.hp = null; }); calloutText = ''; $('battle-callout').textContent = '';
    versusShown = false; clearTimeout(versusTimer); $('versus').hidden = true;
    $('combo').hidden = true; $('ko-banner').hidden = true; $('cutin').hidden = true; $('cutin').classList.remove('play');
    for (const id of ['left-skill', 'right-skill']) { $(id).textContent = ''; $(id).classList.remove('on'); }
    $('battle').classList.remove('portrait-allowed');
    const own = latest?.fighters?.[seat]?.id || settings.player;
    fightSpoken = false;
    syncActions(own); sound('unlock'); sound('playAnnouncer', 'round1');
    renderer.resize();
  }
  function startPve() {
    if (!Art.assetReady(settings.player) || !Art.assetReady(settings.opponent)) { toast('角色图片正在加载，请稍候。'); return; }
    disconnect(false); mode = 'pve'; room = null; seat = 0;
    world = engine.createWorld({ left: settings.player, right: settings.opponent, mode: 'pve', difficulty: settings.difficulty, duration: 90 });
    latest = world.snapshot();
    matchDuration = Math.ceil(latest.timeLeft);
    const nextWorld = world; openBattle(); world = nextWorld;
  }
  function syncActions(id) {
    if (actionCharacter === id) return;
    actionCharacter = id;
    const c = character(id);
    for (const button of actionButtons) {
      const def = c[slots[button.dataset.action]]; button.querySelector('.action-name').textContent = button.dataset.action === 'punch' ? '普攻' : def.name; button.setAttribute('aria-label', `${def.name} ${def.hint || ''}`);
      const icon = button.querySelector('use'); const key = (ICONS[id] || ICONS.pyro)[button.dataset.action]; if (icon && key) icon.setAttribute('href', `#ic-${key}`);
    }
  }
  function consumeEvents(snapshot) {
    const fresh = (snapshot.events || []).filter((event) => event.seq > eventSeq);
    if (fresh.length) eventSeq = Math.max(eventSeq, ...fresh.map((event) => event.seq));
    sound('handle', fresh);
    sound('handleCombatVoices', fresh, snapshot.fighters);
  }
  function updateHud(snapshot) {
    if (!snapshot?.fighters) return;
    const labels = ['left', 'right'];
    snapshot.fighters.forEach((f, index) => {
      const id = labels[index]; const def = character(f.id), hud = document.querySelector(`.${id}-hud`), state = hudState[index];
      if (state.id !== f.id) {
        // 角色变了（新一场 / 重赛）：刷新头像框与主题色
        state.id = f.id; const d = look(f.id);
        hud.style.setProperty('--hc', d.accent); hud.style.setProperty('--hc2', d.accent2);
        const img = $(`${id}-face`); img.onerror = () => { img.onerror = null; faceFallback(img, f.id); }; img.src = Art.assetUrl(f.id);
        $(`${id}-lag`).style.width = '100%';
      }
      $(`${id}-name`).textContent = def.name;
      $(`${id}-seat`).textContent = index === seat ? '你' : mode === 'pve' ? engine.difficulties[settings.difficulty].label : '对手';
      const hp = Math.max(0, f.hp / f.maxHp * 100);
      if (state.hp !== null && state.hp !== undefined && hp < state.hp - 0.8) { const face = hud.querySelector('.fh-face'); face.classList.remove('hurt'); void face.offsetWidth; face.classList.add('hurt'); }
      state.hp = hp;
      $(`${id}-hp`).style.width = `${hp}%`; $(`${id}-lag`).style.width = `${hp}%`;
      $(`${id}-mp`).style.width = `${Math.max(0, Math.min(100, f.mp / 200 * 100))}%`;
      hud.classList.toggle('low', hp < 25 && !f.dead); hud.classList.toggle('ult-ready', f.mp >= 200 && !f.dead);
    });
    // 连击数：显示在连击者一侧
    {
      let best = -1;
      renderer.combo.forEach((cb, i) => { if (cb.n >= 2 && snapshot.frame - cb.last <= 70 && (best < 0 || cb.last > renderer.combo[best].last)) best = i; });
      const el = $('combo');
      if (best >= 0) {
        const n = renderer.combo[best].n;
        el.hidden = false; el.classList.toggle('right', best === 1);
        if (el.dataset.n !== String(n)) { $('combo-n').textContent = String(n); el.dataset.n = String(n); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
      } else { el.hidden = true; el.dataset.n = ''; }
    }
    $('clock').textContent = String(Math.max(0, Math.ceil(snapshot.timeLeft)));
    $('connection-label').textContent = mode === 'pve' ? '人机对战' : latency === null ? '联机对战' : `${latency} ms`;
    const own = snapshot.fighters[seat];
    for (const button of actionButtons) {
      const slot = slots[button.dataset.action]; const def = character(own.id)[slot];
      const cd = slot === 's0' ? own.cd0 : slot === 's1' ? own.cd1 : slot === 's2' ? own.cd2 : 0;
      const fraction = slot === 'ult' ? Math.max(0, 1 - own.mp / 200) : cd / (def.cd || 1);
      button.style.setProperty('--cooldown', String(Math.max(0, Math.min(1, fraction))));
      const cdElement = button.querySelector('.cooldown');
      if (cdElement) cdElement.textContent = slot === 'ult' ? own.mp < 200 ? `${Math.floor(own.mp / 2)}%` : 'READY' : cd > 0 ? (cd / 60).toFixed(1) : '';
      button.classList.toggle('ready', slot === 'ult' && own.mp >= 200);
    }
    setCallout(snapshot.intro);
  }
  // 开场：双方对阵画面（VS）→ 3 → 2 → 1 → FIGHT!
  function showVersus(snapshot) {
    const el = $('versus'); el.hidden = false;
    snapshot.fighters.slice(0, 2).forEach((f, index) => {
      const side = index === 0 ? 'left' : 'right', d = look(f.id), def = character(f.id), band = $(`vs-${side}`);
      band.style.setProperty('--accent', d.accent); band.style.setProperty('--dark', d.dark); band.style.setProperty('--glow', Art ? Art.rgba(d.glow, .6) : d.glow);
      $(`vs-name-${side}`).textContent = def.name; $(`vs-role-${side}`).textContent = def.tag.toUpperCase();
      try { Art.drawShowcase($(`vs-art-${side}`), f.id, 0, { mode: 'bust', fill: 1.1, reduced: true }); } catch { /* 立绘失败不影响开场 */ }
    });
    for (const node of [el, $('vs-left'), $('vs-right'), el.querySelector('.vs-mark')]) { node.style.animation = 'none'; void node.offsetWidth; node.style.animation = ''; }
    clearTimeout(versusTimer); versusTimer = setTimeout(() => { el.hidden = true; }, 1350);
  }
  function setCallout(intro) {
    const text = intro > 108 ? 'ROUND 1' : intro > 30 ? String(Math.ceil((intro - 30) / 26)) : intro > 0 ? 'FIGHT!' : '';
    if (!fightSpoken && intro <= 30 && !finished) { fightSpoken = true; sound('playAnnouncer', 'fight'); }
    if (!versusShown && intro > 108 && latest && latest.fighters && latest.fighters.length >= 2) { versusShown = true; showVersus(latest); }
    if (text === calloutText) return;
    calloutText = text;
    const el = $('battle-callout'); el.textContent = text; el.classList.remove('pop'); el.classList.toggle('fight', text === 'FIGHT!');
    if (text) { void el.offsetWidth; el.classList.add('pop'); }
  }
  function showCutin(detail) {
    const el = $('cutin'), d = look(detail.id), def = character(detail.id);
    el.style.setProperty('--accent', d.accent); el.style.setProperty('--accent2', d.accent2); el.style.setProperty('--dark', d.dark); el.style.setProperty('--glow', Art ? Art.rgba(d.glow, .6) : d.glow);
    $('cutin-skill').textContent = detail.name || def.ult.name; $('cutin-name').textContent = `${def.name} · ${def.tag}`;
    try { Art.drawShowcase($('cutin-art'), detail.id, 0, { mode: 'bust', fill: 1.12, reduced: true }); } catch { /* 立绘失败不影响战斗 */ }
    el.hidden = false; el.classList.remove('play'); void el.offsetWidth; el.classList.add('play');
    clearTimeout(cutinTimer); cutinTimer = setTimeout(() => { el.hidden = true; el.classList.remove('play'); }, 1300);
  }
  window.addEventListener('mujica:skill', (event) => {
    const d = event.detail || {};
    if (screen !== 'battle' || finished) return;
    const el = $(d.seat === 0 ? 'left-skill' : 'right-skill');
    if (d.name) { el.textContent = d.name; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
    if (d.slot === 'ult') showCutin(d);
  });
  window.addEventListener('mujica:ko', () => {
    if (screen !== 'battle') return;
    const el = $('ko-banner'), span = el.firstElementChild;
    el.hidden = false; span.style.animation = 'none'; void span.offsetWidth; span.style.animation = '';
    clearTimeout(koTimer); koTimer = setTimeout(() => { el.hidden = true; }, 1700);
  });
  function finishMatch(snapshot) {
    if (finished || !snapshot.result) return;
    finished = true; clearInputs(); $('pause-overlay').hidden = true;
    const { winner, reason } = snapshot.result;
    const win = winner === seat, draw = winner === null;
    $('result-reason').textContent = reason === 'timeout' ? 'TIME UP · 时间到' : reason === 'double-ko' ? 'DOUBLE K.O. · 同时倒下' : 'K.O.';
    $('result-title').textContent = draw ? '平局' : win ? '胜利' : '落败';
    $('result-description').textContent = reason === 'timeout' ? draw ? '双方剩余生命相同。' : '按剩余生命判定本场胜负。' : draw ? '双方同时倒下，再来一场吧。' : win ? `${character(snapshot.fighters[seat].id).name}完成了本场出演。` : '调整节奏，下一场再登台。';
    const own = snapshot.fighters[seat];
    const damage = Math.round(snapshot.fighters[1 - seat].maxHp - snapshot.fighters[1 - seat].hp);
    $('result-stats').replaceChildren();
    for (const [label, value] of [['剩余生命', `${Math.max(0, Math.ceil(own.hp))}`], ['对手损失生命', `${damage}`], ['对战用时', `${Math.max(0, Math.round(matchDuration - snapshot.timeLeft))}s`]]) {
      const node = document.createElement('span'); const amount = document.createElement('b'); amount.textContent = value; node.append(amount, document.createTextNode(label)); $('result-stats').appendChild(node);
    }
    records.played += 1; if (win) { records.won += 1; records.streak += 1; } else { records.streak = 0; if (draw) records.drawn += 1; }
    records.bestStreak = Math.max(records.bestStreak, records.streak); write('ave-theatre-records-v2', records);
    // 击倒时让 K.O. 演出先播一小会儿：浮层立即存在，但卡片延迟淡入
    $('result-overlay').classList.toggle('delayed', (reason === 'ko' || reason === 'double-ko') && !settings.lowMotion);
    $('result-overlay').hidden = false; sound('setScene', 'result'); sound('playResult', snapshot);
  }
  function send(message) { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(message)); return true; } return false; }
  function disconnect(notify = true) {
    pendingEntry = null; clearTimeout(connectionTimeout); socketGeneration += 1;
    if (socket) { if (notify) send({ type: 'leave' }); socket.close(); socket = null; }
    room = null; latency = null;
  }
  function enterRoom(type, code) {
    if (location.protocol === 'file:') { status('请双击“启动游戏”后，通过网页地址进入联机。'); return; }
    if (/(^|\.)github\.io$/i.test(location.hostname)) { status('GitHub Pages 没有房间服务。人人对战请使用本机或云服务器上的游戏地址。'); return; }
    mode = 'pvp'; sound('unlock'); disconnect(false);
    const generation = ++socketGeneration;
    inputSeq = 0;
    pendingEntry = { type, character: settings.player, ...(code ? { code } : {}) };
    status('正在连接房间服务…'); $('create-btn').disabled = true;
    try { socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); } catch { connectionFailed('无法连接房间服务。'); return; }
    connectionTimeout = setTimeout(() => { if (generation === socketGeneration && !room) { disconnect(false); connectionFailed('连接超时，请检查网络后重试。'); } }, 8000);
    socket.addEventListener('open', () => { if (generation !== socketGeneration) return; lastMessageAt = performance.now(); send(pendingEntry); });
    socket.addEventListener('message', (event) => {
      if (generation !== socketGeneration) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      lastMessageAt = performance.now();
      if (message.type === 'room') {
        clearTimeout(connectionTimeout); pendingEntry = null; $('create-btn').disabled = false; room = message; seat = message.seat; mode = 'pvp';
        if (message.phase === 'battle') {
          if (screen !== 'battle' || finished) { latest = null; world = null; openBattle(); }
        } else if (message.phase === 'lobby') { show('room'); renderRoom(); }
        else if (message.phase === 'result' && finished) $('rematch-status').textContent = message.players[seat]?.ready ? '已请求重赛，等待对方。' : message.players[1 - seat]?.ready ? '对方邀请你再来一场。' : '';
      } else if (message.type === 'snapshot') {
        if (!room) return;
        if (!latest) matchDuration = Math.ceil(message.snapshot.timeLeft);
        latest = message.snapshot;
        consumeEvents(latest); if (latest.fighters?.[seat]) syncActions(latest.fighters[seat].id);
        if (latest.result) finishMatch(latest);
      } else if (message.type === 'error') {
        $('create-btn').disabled = false; status(message.message || '操作未完成，请重试。'); toast(message.message || '操作未完成。');
        if (!room) { clearTimeout(connectionTimeout); disconnect(false); }
      } else if (message.type === 'left') {
        room = null; clearInputs(); disconnect(false);
        if (screen === 'battle') interrupted(message.message || '对战连接已结束。');
        else { show('menu'); changeMode('pvp'); status(message.message || '房间已结束。'); }
      } else if (message.type === 'pong' && Number.isFinite(message.at)) latency = Math.max(0, Math.round(performance.now() - message.at));
    });
    socket.addEventListener('close', () => {
      if (generation !== socketGeneration) return;
      socket = null; room = null; $('create-btn').disabled = false;
      if (screen === 'battle') interrupted('连接已中断，本场已结束。重新建房即可再次邀请。');
      else { show('menu'); changeMode('pvp'); status('房间连接已断开，请重新连接。'); }
    });
    socket.addEventListener('error', () => { if (generation === socketGeneration && !room) connectionFailed('房间服务暂时无法连接，请确认游戏服务已启动。'); });
  }
  function connectionFailed(message) { $('create-btn').disabled = false; status(message); }
  function renderRoom() {
    if (!room) return;
    $('room-display').textContent = room.code; $('room-seats').replaceChildren();
    room.players.forEach((player, index) => {
      const card = document.createElement('div'); card.className = `room-seat${player ? '' : ' empty'}`;
      if (player) {
        const def = character(player.character); const image = document.createElement('canvas'); image.className = 'room-portrait'; image.dataset.portraitId = def.id; image.dataset.portraitMode = 'bust'; image.width = 240; image.height = 280; image.setAttribute('aria-label', def.name);
        const name = document.createElement('h3'); name.textContent = `${def.name}${index === seat ? ' · 你' : ''}`;
        const ready = document.createElement('p'); ready.className = player.ready ? 'prepared' : ''; ready.textContent = player.ready ? '已准备' : '选择角色中'; card.append(image, name, ready);
      } else { const moon = document.createElement('span'); moon.className = 'empty-moon'; moon.textContent = '☾'; const text = document.createElement('p'); text.textContent = '等待朋友加入'; card.append(moon, text); }
      $('room-seats').appendChild(card);
    });
    renderCardArt();
    makeRoster($('room-roster'), room.players[seat]?.character, (id) => { settings.player = id; persist(); send({ type: 'select', character: id }); sound('playVoice', id, 'select'); });
    const ready = !!room.players[seat]?.ready; $('ready-btn').textContent = ready ? '取消准备' : '准备开场';
    $('ready-btn').disabled = !characters.every(c => Art.assetReady(c.id));
    $('room-status').textContent = room.players.every(Boolean) ? ready ? '你已准备，等待对方。' : '选好角色后点击准备，双方准备即可开始。' : '把房间码或邀请链接发给朋友。';
  }
  function interrupted(message) {
    paused = true; finished = true; clearInputs(); $('result-overlay').hidden = true;
    $('pause-title').textContent = '本场中断'; $('pause-description').textContent = message;
    $('resume-btn').hidden = true; $('pause-overlay').hidden = false;
  }
  function pauseGame() {
    if (screen !== 'battle' || finished) return;
    clearInputs(); paused = mode === 'pve';
    if (mode === 'pvp') send({ type: 'input', input: takeInput(), seq: ++inputSeq });
    $('pause-title').textContent = mode === 'pve' ? '已暂停' : '联机对战';
    $('pause-description').textContent = mode === 'pve' ? '准备好了就继续。' : '联机比赛仍在继续；返回对战，或退出本场。';
    $('resume-btn').hidden = false; $('pause-overlay').hidden = false;
  }
  function backToMenu() { disconnect(true); world = null; latest = null; finished = false; show('menu'); renderMenu(); changeMode(mode); }
  function frame(now) {
    requestAnimationFrame(frame);
    if (screen !== 'battle' && stage && now - lastBackdropAt > (settings.lowMotion ? 500 : 45)) {
      lastBackdropAt = now; stage.setTint(look(settings.player).accent, 0.2); stage.draw(backdropCtx, now, !!settings.lowMotion);
    }
    if (screen === 'menu' && now - lastPortraitAt > 33) { ArenaRenderer.drawPortrait?.($('portrait'), settings.player, characters, settings.lowMotion ? 1000 : now); lastPortraitAt = now; }
    if (screen !== 'battle') { lastFrame = now; return; }
    const elapsed = lastFrame ? Math.min(100, now - lastFrame) : 0; lastFrame = now;
    if (mode === 'pve' && world && !paused && !finished) {
      accumulator += elapsed;
      let steps = 0; while (accumulator >= 1000 / 60 && steps < 6) { world.step([takeInput(), {}]); accumulator -= 1000 / 60; steps += 1; }
      latest = world.snapshot(); consumeEvents(latest); if (latest.result) finishMatch(latest);
    } else if (paused) accumulator = 0;
    if (latest) {
      renderer.draw(latest, seat, now);
      if (now - lastHudAt > 65 || latest.result) { updateHud(latest); lastHudAt = now; }
    }
  }
  // 联机输入按固定 30Hz 发送，不依赖画面帧率：画面卡顿时操作也不会变慢
  setInterval(() => {
    if (mode !== 'pvp' || !room || finished || screen !== 'battle') return;
    const now = performance.now();
    if (now - lastSendAt < 28) return;
    lastSendAt = now; send({ type: 'input', input: takeInput(), seq: ++inputSeq });
  }, 1000 / 30);
  function showSkills() {
    const c = character(settings.player); $('skill-role').textContent = c.tag; $('skill-title').textContent = `${c.name}的招式`; $('skill-list').replaceChildren();
    for (const [slot, key] of [['punch', 'J'], ['s0', 'K'], ['s1', 'U'], ['s2', 'I'], ['ult', 'L']]) {
      const def = c[slot]; const row = document.createElement('div'); row.className = 'skill-row'; const title = document.createElement('h3'); const label = document.createElement('small'); label.textContent = slot === 'ult' ? `${key} · 满能量` : `${key}${def.cd ? ` · 冷却 ${(def.cd / 60).toFixed(1)}s` : ''}`; title.append(document.createTextNode(def.name), label);
      const topline = document.createElement('div'); topline.className = 'skill-topline'; topline.append(title);
      if (slot === 'ult') {
        const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'voice-preview'; preview.textContent = '试听大招语音'; preview.setAttribute('aria-label', `${c.name} 大招 试听语音`); preview.addEventListener('click', () => sound('playVoice', c.id, 'ult')); topline.append(preview);
      }
      const hint = document.createElement('p'); hint.textContent = def.hint || '靠近对手，在空隙中出拳。'; row.append(topline, hint);
      if (def.detail) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '详细数值'; const value = document.createElement('p'); value.textContent = def.detail; details.append(summary, value); row.append(details); }
      $('skill-list').appendChild(row);
    }
    $('skills-dialog').showModal();
  }
  $('mode-pve').addEventListener('click', () => changeMode('pve')); $('mode-pvp').addEventListener('click', () => changeMode('pvp'));
  $('start-btn').addEventListener('click', () => { sound('unlock'); startPve(); });
  $('create-btn').addEventListener('click', () => enterRoom('create'));
  $('join-form').addEventListener('submit', (event) => { event.preventDefault(); const code = $('room-code').value.trim(); if (/^\d{6}$/.test(code)) enterRoom('join', code); else status('请输入六位数字房间码。'); });
  $('leave-room').addEventListener('click', backToMenu);
  $('ready-btn').addEventListener('click', () => { if (room && characters.every(c => Art.assetReady(c.id))) send({ type: 'ready', ready: !room.players[seat]?.ready }); });
  $('copy-room').addEventListener('click', async () => { if (!room) return; const url = new URL(location.href); url.searchParams.set('room', room.code); try { await navigator.clipboard.writeText(url.href); toast('邀请链接已复制。'); } catch { toast(`房间码：${room.code}。请手动发给朋友。`); } });
  for (const button of document.querySelectorAll('[data-difficulty]')) button.addEventListener('click', () => { settings.difficulty = button.dataset.difficulty; persist(); renderMenu(); });
  $('pause-btn').addEventListener('click', pauseGame); $('resume-btn').addEventListener('click', () => { paused = false; accumulator = 0; $('pause-overlay').hidden = true; }); $('quit-btn').addEventListener('click', backToMenu); $('result-menu').addEventListener('click', backToMenu);
  $('rematch-btn').addEventListener('click', () => { if (mode === 'pve') startPve(); else if (send({ type: 'rematch' })) { $('rematch-btn').disabled = true; $('rematch-btn').textContent = '已请求重赛'; $('rematch-status').textContent = '等待对方同意。'; } });
  $('portrait-play').addEventListener('click', () => $('battle').classList.add('portrait-allowed'));
  $('skill-info-btn').addEventListener('click', showSkills);
  for (const name of ['settings', 'help', 'credits']) $(`${name}-btn`).addEventListener('click', () => { sound('unlock'); $(`${name}-dialog`).showModal(); });
  $('help-done').addEventListener('click', () => { $('help-dialog').close(); write('ave-theatre-help-seen-v2', true); });
  for (const channel of ['music', 'sfx', 'voice']) {
    $(`${channel}-volume`).value = String(Math.round(settings[channel] * 100)); $(`${channel}-value`).value = `${Math.round(settings[channel] * 100)}%`;
    $(`${channel}-volume`).addEventListener('input', () => { settings[channel] = Number($(`${channel}-volume`).value) / 100; $(`${channel}-value`).value = `${Math.round(settings[channel] * 100)}%`; sound('unlock'); sound('setVolumes', settings); persist(); });
  }
  for (const button of document.querySelectorAll('[data-voice-cue]')) button.addEventListener('click', () => sound('playVoice', settings.player, button.dataset.voiceCue));
  const buttonCues = { 'mode-pve': 'pve', 'mode-pvp': 'pvp', 'start-btn': 'start', 'create-btn': 'create', 'leave-room': 'back', 'ready-btn': 'ready', 'copy-room': 'copy', 'pause-btn': 'pause', 'resume-btn': 'resume', 'quit-btn': 'back', 'result-menu': 'back', 'rematch-btn': 'rematch', 'settings-btn': 'settings', 'help-btn': 'help', 'credits-btn': 'credits', 'skill-info-btn': 'help', 'help-done': 'confirm' };
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled || button.dataset.action) return;
    if (button.classList.contains('character-card') || button.classList.contains('voice-preview') || button.dataset.voiceCue) { sound('playUI', 'confirm'); return; }
    const cue = buttonCues[button.id] || button.dataset.difficulty || (button.classList.contains('opponent-card') ? 'opponent' : button.classList.contains('dialog-close') ? 'back' : button.closest('#join-form') ? 'join' : 'confirm');
    sound('playUI', cue);
  });
  window.addEventListener('mujica:assets', () => { renderCardArt(); if (screen === 'menu') renderMenu(); else if (screen === 'room') renderRoom(); });
  Art.ready.then(ok => { if (!ok) status('角色图片未加载完整，请刷新页面。'); renderCardArt(); if (screen === 'menu') renderMenu(); else if (screen === 'room') renderRoom(); });
  $('low-motion').checked = !!settings.lowMotion;
  function applyMotion() { document.body.classList.toggle('low-motion', !!settings.lowMotion); renderer.reducedMotion = !!settings.lowMotion; }
  $('low-motion').addEventListener('change', () => { settings.lowMotion = $('low-motion').checked; applyMotion(); persist(); }); applyMotion();
  function syncVoiceStatus() { $('voice-status').textContent = audio.voiceAvailable ? '选人、大招、获胜台词已加载。开场使用格斗播报，按钮使用点击音效。' : '角色语音正在加载；配乐与音效可以正常使用。'; }
  syncVoiceStatus();
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
    if (screen !== 'battle') return;
    if (event.code === 'Escape') { event.preventDefault(); if (finished) return; if ($('pause-overlay').hidden) pauseGame(); else { paused = false; $('pause-overlay').hidden = true; } return; }
    if (!$('pause-overlay').hidden || !$('result-overlay').hidden) return;
    if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', ...Object.keys(actionKeys)].includes(event.code)) { event.preventDefault(); if (!event.repeat && actionKeys[event.code]) press(actionKeys[event.code]); keys.add(event.code); }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  const joystick = $('joystick');
  function moveStick(event) {
    const rect = joystick.getBoundingClientRect(); const radius = rect.width * .33;
    let dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy); if (distance > radius) { dx *= radius / distance; dy *= radius / distance; }
    $('stick-knob').style.transform = `translate(${dx}px,${dy}px)`;
    held.left = dx / radius < -.22; held.right = dx / radius > .22;
    const up = dy / radius < -.55; if (up && !stickUp) press('up'); stickUp = up;
  }
  joystick.addEventListener('pointerdown', (event) => { if (joystickPointer !== null) return; event.preventDefault(); joystickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); moveStick(event); });
  joystick.addEventListener('pointermove', (event) => { if (event.pointerId === joystickPointer) { event.preventDefault(); moveStick(event); } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(type, (event) => { if (event.pointerId === joystickPointer) { joystickPointer = null; held.left = held.right = false; stickUp = false; $('stick-knob').style.transform = ''; } });
  for (const button of actionButtons) {
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); press(button.dataset.action, true); button.classList.add('pressed'); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => button.classList.remove('pressed'));
    button.addEventListener('click', (event) => { if (event.detail === 0) press(button.dataset.action, true); });
  }
  function releaseOnBackground() { clearInputs(); if (screen === 'battle' && !finished) { if (mode === 'pve') pauseGame(); else send({ type: 'input', input: takeInput(), seq: ++inputSeq }); } }
  window.addEventListener('blur', releaseOnBackground); document.addEventListener('visibilitychange', () => { if (document.hidden) releaseOnBackground(); }); window.addEventListener('pagehide', () => disconnect(true)); window.addEventListener('resize', () => { renderer.resize(); renderCardArt(); });
  setInterval(() => { syncVoiceStatus(); if (socket?.readyState !== WebSocket.OPEN) return; send({ type: 'ping', at: performance.now() }); if (performance.now() - lastMessageAt > 15000 && !document.hidden) { disconnect(false); if (screen === 'battle') interrupted('连接长时间没有响应，请重新建房。'); else { show('menu'); status('连接超时，请重试。'); } } }, 3000);
  renderMenu(); updateRecordLine(); sound('setScene', 'menu'); requestAnimationFrame(frame);
  const invited = new URLSearchParams(location.search).get('room'); if (invited && /^\d{6}$/.test(invited)) { changeMode('pvp'); $('room-code').value = invited; status(/(^|\.)github\.io$/i.test(location.hostname) ? '邀请链接需要游戏服务器。GitHub Pages 只能进行人机对战。' : '已填入邀请房间码，选择角色后点击加入。'); }
  if (!read('ave-theatre-help-seen-v2', false)) { $('help-dialog').showModal(); write('ave-theatre-help-seen-v2', true); }
  // Read-only diagnostics used by the bundled smoke checks.
  window.AveGame = { getState: () => ({ mode, screen, seat, room: room?.code || null, snapshot: latest, paused, finished, records: { ...records } }) };
})();
