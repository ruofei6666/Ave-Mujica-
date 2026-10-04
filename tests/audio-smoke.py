"""Independent real Edge audio-chain checks; no listening-quality claims.

Uses installed Node Playwright, real user taps and native Web Audio APIs.
Audits API calls without replacing responses, audio buffers, or game behavior.
The independent asset pass decodes every manifest WAV in the real AudioContext.
Output: .scratch/ui-audio-report.json. Run --help for runtime overrides.
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
const output = name => path.join(root,'.scratch',`ui-audio-${name}`);
const report = { started:new Date().toISOString(), checks:[], errors:[], requests:[] };
let app, browser; const contexts=[];
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
function pass(name, data={}) { report.checks.push({name,passed:true,...data}); console.log('PASS '+name+' '+JSON.stringify(data)); }
async function check(name,fn) { try { await fn(); } catch(error) { report.checks.push({name,passed:false,error:error.stack||String(error)}); console.log('FAIL '+name+': '+error.message); } }
async function waitFor(fn, timeout=5000) { const end=Date.now()+timeout; while(Date.now()<end) {const value=await fn(); if(value) return value; await sleep(40);} throw new Error('Timed out waiting for observed native audio activity'); }
const audit = () => {
  const obs = {contexts:[],gains:[],decodes:[],starts:[],tones:[],connections:[],nodes:[],failures:[],targets:[],cues:[]}; window.__nativeAudioAudit=obs;
  let AudioClass;
  Object.defineProperty(window,'GameAudio',{configurable:true,get(){return AudioClass;},set(Class){
    const original=Class.prototype.playClip;
    Class.prototype.playClip=function(id,cue,...args){const entry={id,cue,done:false};obs.cues.push(entry);const result=original.call(this,id,cue,...args);
      Promise.resolve(result).then(value=>{entry.done=true;entry.played=value;},error=>{entry.done=true;entry.error=String(error);});return result;};
    AudioClass=Class;
  }});
  const identity = node => {let id=obs.nodes.indexOf(node);if(id<0){id=obs.nodes.length;obs.nodes.push(node);}return id;};
  const Native = window.AudioContext || window.webkitAudioContext;
  const proxy = new Proxy(Native,{construct(Target,args){const context=Reflect.construct(Target,args);obs.contexts.push(context);return context;}});
  if(window.AudioContext) window.AudioContext=proxy; else window.webkitAudioContext=proxy;
  const gain = BaseAudioContext.prototype.createGain;
  BaseAudioContext.prototype.createGain=function(...args){const node=gain.apply(this,args);obs.gains.push({node,context:this,id:identity(node)});return node;};
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){obs.connections.push({from:identity(this),to:identity(destination)});return connect.call(this,destination,...args);};
  const disconnect=AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect=function(...args){const from=identity(this);obs.connections=obs.connections.filter(c=>c.from!==from||(args[0]&&c.to!==identity(args[0])));return disconnect.apply(this,args);};
  const reaches=(from,to,seen=new Set())=>from===to||(!seen.has(from)&&(seen.add(from),obs.connections.filter(c=>c.from===from).some(c=>reaches(c.to,to,seen))));
  const target=AudioParam.prototype.setTargetAtTime;
  AudioParam.prototype.setTargetAtTime=function(value,time,constant){const gain=obs.gains.find(g=>g.node.gain===this);obs.targets.push({gainId:gain?.id,value,time,constant});return target.call(this,value,time,constant);};
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData=function(...args){const result=decode.apply(this,args);if(result?.then)result.then(buffer=>obs.decodes.push({length:buffer.length,duration:buffer.duration,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels}),error=>obs.failures.push(String(error)));return result;};
  const start=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args){const result=start.apply(this,args);const id=identity(this);obs.starts.push({id,isVoice:reaches(id,obs.gains[2]?.id),isSfx:reaches(id,obs.gains[1]?.id),length:this.buffer?.length,duration:this.buffer?.duration,channels:this.buffer?.numberOfChannels});return result;};
  const toneStart=OscillatorNode.prototype.start;
  OscillatorNode.prototype.start=function(...args){const result=toneStart.apply(this,args);const id=identity(this);obs.tones.push({id,isSfx:reaches(id,obs.gains[1]?.id),frequency:this.frequency.value});return result;};
};
async function pageFor(name, savedSettings=null) {
  const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});contexts.push(context);
  await context.addInitScript(()=>localStorage.setItem('ave-theatre-help-seen-v2','true'));
  if(savedSettings) await context.addInitScript(settings=>{
    if(!sessionStorage.getItem('audio-test-settings-seeded')){
      localStorage.setItem('ave-theatre-settings-v2',JSON.stringify(settings));sessionStorage.setItem('audio-test-settings-seeded','true');
    }
  },savedSettings);
  await context.addInitScript(audit);const page=await context.newPage();page.setDefaultTimeout(8000);
  page.on('pageerror',error=>report.errors.push({name,error:String(error)}));
  page.on('response',response=>{if(response.url().includes('/assets/audio/'))report.requests.push({name,url:response.url(),status:response.status()});});
  await page.goto(`http://127.0.0.1:${process.env.UI_PORT}`,{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>window.__nativeAudioAudit.contexts.length),0,'audio must wait for a real first gesture');
  // Close onboarding without consuming the first gesture that the audio checks exercise.
  await page.locator('#install-dialog').evaluate(el=>el.close());
  return page;
}
async function inspect(page) {return page.evaluate(()=>{
  const o=window.__nativeAudioAudit, context=o.contexts[0];const gains=o.gains.filter(g=>g.context===context);
  const reaches=(from,to,seen=new Set())=>from===to||(!seen.has(from)&&(seen.add(from),o.connections.filter(c=>c.from===from).some(c=>reaches(c.to,to,seen))));
  const voices=o.starts.filter(s=>s.isVoice);
  return {contextCount:o.contexts.length,state:context?.state,currentTime:context?.currentTime,visible:!document.hidden,focused:document.hasFocus(),gains:gains.slice(0,3).map(g=>g.node.gain.value),busIds:gains.slice(0,3).map(g=>g.id),targets:o.targets.slice(-12),
    busesReachOutput:gains.slice(0,3).map(g=>reaches(g.id,o.nodes.indexOf(context.destination))),sfxBoost:gains.find(g=>g.node.gain.value>1)?.node.gain.value,
    sfxStarts:o.starts.filter(s=>s.isSfx),sfxTones:o.tones.filter(t=>t.isSfx),decodes:o.decodes,voiceStarts:voices,failures:o.failures,cues:o.cues};
});}
async function slider(page,key,value) {
  const el=page.locator('#'+key+'-volume');await el.focus();await page.keyboard.press('Home');
  for(let i=0;i<value;i++) await page.keyboard.press('ArrowRight');
  assert.equal(await el.inputValue(),String(value));await sleep(250);
}
async function selectVoiceFromSettings(page,id) {
  await page.locator('#settings-dialog .dialog-close').tap();
  await sleep(200);const before=(await inspect(page)).cues.length;
  await page.locator(`#character-roster [data-character="${id}"]`).tap();
  await waitFor(async()=> (await inspect(page)).cues.slice(before).some(c=>c.id===id&&c.cue==='select'&&c.played));
  await sleep(250);await page.locator('#settings-btn').tap();
}
(async()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/audio/manifest.json'),'utf8'));
  assert.equal(manifest.available,true,'wait for final available=true manifest before running');
  const roleFiles=[...new Set(Object.values(manifest.clips).flatMap(cues=>Object.values(cues).flat()))];
  const files=[...roleFiles,...new Set(Object.values(manifest.systemClips).flat())];
  assert.equal(roleFiles.length,15);assert.equal(files.length,17);assert.deepEqual(Object.keys(manifest.systemClips),['round1','fight']);assert.ok(files.every(file=>/^assets\/audio\/[a-z0-9_/-]+\.wav$/i.test(file)));
  for(const id of ['gale','iron','shadow','pyro','bastion']){
    const clips=manifest.clips[id];assert.deepEqual(Object.keys(clips),['select','ult','ko']);
    for(const cue of ['select','ult','ko'])assert.ok(Array.isArray(clips[cue])&&clips[cue].length,`${id} missing ${cue}`);
    assert.equal(new Set(Object.values(clips).flat()).size,3,`${id} shares unrelated cue files`);
  }
  report.manifest={available:manifest.available,files,status:manifest.status};
  app=createGameServer({host:'127.0.0.1',port:Number(process.env.UI_PORT)});await app.listen();
  // No autoplay bypass: the first actual touch must unlock the native context.
  browser=await chromium.launch({headless:true,executablePath:process.env.UI_EDGE});
  report.runtime={edge:process.env.UI_EDGE,playwright:require(path.join(process.env.UI_PLAYWRIGHT,'package.json')).version};
  let selectionPage;
  await check('existing saves start at full volume once and later adjustments persist',async()=>{
    const page=await pageFor('volume-migration',{music:.20,sfx:.50,voice:.85,audioRev:2});
    for(const key of ['music','sfx','voice'])assert.equal(await page.locator('#'+key+'-volume').inputValue(),'100');
    await page.locator('#settings-btn').tap();assert.equal(await page.locator('#reset-volumes').count(),0);
    await slider(page,'music',67);await slider(page,'voice',39);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ave-theatre-settings-v2')));
    assert.equal(saved.audioRev,3);assert.equal(saved.music,.67);assert.equal(saved.voice,.39);
    await page.reload({waitUntil:'networkidle'});
    await page.locator('#install-dialog').evaluate(el=>el.close());
    assert.equal(await page.locator('#music-volume').inputValue(),'67');
    assert.equal(await page.locator('#voice-volume').inputValue(),'39');
    assert.equal(await page.locator('#sfx-volume').inputValue(),'100');
    pass('full default migration runs once; subsequent slider choices survive reopening');await page.context().close();
  });
  await check('cold first character selection fetches, decodes and starts original voice',async()=>{
    selectionPage=await pageFor('cold-select');await selectionPage.locator('#character-roster [data-character="shadow"]').tap();
    await waitFor(async()=>{const o=await inspect(selectionPage);return o.state==='running'&&o.voiceStarts.length>0&&o.decodes.length>0;});
    const o=await inspect(selectionPage);assert.equal(o.failures.length,0);pass('cold first selection unlocks and plays native decoded voice',o);
  });
  await check('cold direct battle start plays Round 1 and Fight exactly once',async()=>{
    const page=await pageFor('cold-start');await page.locator('#start-btn').tap();
    await waitFor(async()=>{const o=await inspect(page);return o.state==='running'&&o.voiceStarts.length>0&&o.decodes.length>0;});
    const o=await inspect(page);assert.equal(o.failures.length,0);assert.equal((await page.evaluate(()=>AveGame.getState())).screen,'battle');
    await page.waitForFunction(()=>AveGame.getState().snapshot.intro===0);
    await waitFor(async()=> (await inspect(page)).cues.some(c=>c.id==='@announcer'&&c.cue==='fight'&&c.played));
    const intro=(await inspect(page)).cues.filter(c=>c.id==='@announcer');assert.deepEqual(intro.map(c=>c.cue),['round1','fight']);assert.ok(intro.every(c=>c.played));
    pass('Round 1 and Fight play once at the real intro boundaries',{cues:intro});
    await page.locator('#pause-btn').tap();await page.locator('#quit-btn').tap();await page.context().close();
  });
  if(!selectionPage) selectionPage=await pageFor('asset-check');
  await selectionPage.bringToFront();
  await check('all final manifest WAV files independently decode to nonempty signal',async()=>{
    await selectionPage.locator('#settings-btn').tap();await waitFor(async()=> (await inspect(selectionPage)).state==='running');
    const results=await selectionPage.evaluate(async files=>{
      const context=window.__nativeAudioAudit.contexts[0],results=[];
      for(const file of files){const response=await fetch(file);if(!response.ok)throw new Error(file+': HTTP '+response.status);
        const bytes=await response.arrayBuffer();const byteLength=bytes.byteLength;const buffer=await context.decodeAudioData(bytes);let peak=0,energy=0;
        for(let channel=0;channel<buffer.numberOfChannels;channel++){const samples=buffer.getChannelData(channel);for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));energy+=samples[i]*samples[i];}}
        results.push({file,bytes:byteLength,length:buffer.length,duration:buffer.duration,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels,peak,rms:Math.sqrt(energy/(buffer.length*buffer.numberOfChannels))});}
      return results;
    },files);
    for(const r of results){assert.ok(r.bytes>44&&r.length>0&&r.duration>0&&r.channels>0,r.file);assert.ok(r.peak>0&&r.peak<.86&&r.rms>0,r.file+' is silent or clipped');}
    report.assets=results;pass('all actual manifest WAVs decode with nonzero samples',{files:results.length,totalSeconds:results.reduce((sum,r)=>sum+r.duration,0)});
  });
  await check('music sfx and voice sliders independently mute native output buses',async()=>{
    if(!await selectionPage.locator('#settings-dialog').evaluate(el=>el.open))await selectionPage.locator('#settings-btn').tap();
    const baseline=(await inspect(selectionPage)).gains;assert.equal(baseline.length,3);assert.ok(baseline.every(g=>g>0));
    [1,1,1].forEach((v,i)=>assert.ok(Math.abs(baseline[i]-v)<.01,'full default volume '+i));
    assert.equal(await selectionPage.locator('#reset-volumes').count(),0);
    assert.ok(Math.abs((await inspect(selectionPage)).sfxBoost-3.6)<.01,'SFX must have the added loudness stage');
    assert.equal(new Set((await inspect(selectionPage)).busIds).size,3);
    assert.ok((await inspect(selectionPage)).busesReachOutput.every(Boolean));
    for(const [index,key] of ['music','sfx','voice'].entries()){
      await slider(selectionPage,key,0);
      // A disconnected, inactive voice node can retain a stale AudioParam.value.
      // Start an actual selected-character voice through normal UI so the native
      // graph processes the mute automation before observing its gain.
      await selectVoiceFromSettings(selectionPage,'iron');
      const inspection=await inspect(selectionPage), muted=inspection.gains;assert.ok(Math.abs(muted[index])<.002,`${key} gain ${muted[index]}: ${JSON.stringify(inspection)}`);
      muted.forEach((gain,other)=>{if(other!==index)assert.ok(Math.abs(gain-baseline[other])<.01,`${key} changed bus ${other}`);});
      await slider(selectionPage,key,Math.round(baseline[index]*100));
      await selectVoiceFromSettings(selectionPage,'pyro');
      const restored=(await inspect(selectionPage)).gains;assert.ok(Math.abs(restored[index]-baseline[index])<.01,`${key} restored ${restored[index]}: ${JSON.stringify(await inspect(selectionPage))}`);
      pass(key+' independently mutes and restores its actual GainNode',{muted,restored});
    }
    await waitFor(async()=> (await selectionPage.locator('#voice-status').textContent()).includes('已加载'));
    await selectionPage.screenshot({path:output('settings.png')});report.settingsStatus=await selectionPage.locator('#voice-status').textContent();
    await selectionPage.locator('#settings-dialog .dialog-close').tap();
  });
  await check('actual ordinary skills have no character speech and ultimate uses its native clip',async()=>{
    const page=await pageFor('four-skills');await page.locator('#character-roster [data-character="shadow"]').tap();
    await page.locator('#opponent-roster [data-character="bastion"]').tap();await page.locator('#start-btn').tap();
    await page.waitForFunction(()=>AveGame.getState().snapshot.intro===0);
    for(const [action,cue] of [['special','s0'],['ult','ult'],['skill1','s1'],['skill2','s2']]){
      const before=(await inspect(page)).cues.length;let played=false;
      for(let attempt=0;attempt<30&&!played;attempt++){
        const snapshot=await page.evaluate(()=>AveGame.getState().snapshot);
        if(!['skill','punch','stun','dead'].includes(snapshot.fighters[0].state))await page.locator(`[data-action="${action}"]`).tap();
        await sleep(120);played=cue==='ult'?(await inspect(page)).cues.slice(before).some(r=>r.id==='shadow'&&r.cue===cue&&r.played===true):(await page.evaluate(()=>AveGame.getState().snapshot.events)).some(e=>e.kind==='skill'&&e.actor===0&&e.slot===cue);
      }
      assert.equal(played,true,`${cue} did not run through actual combat`);
      if(cue!=='ult')assert.equal((await inspect(page)).cues.slice(before).filter(r=>r.id==='shadow').length,0,'ordinary skill spoke a role cue');
      pass('real '+cue+' event follows the three-cue speech policy',{roleVoice:cue==='ult'});
    }
    const observed=await inspect(page);assert.equal(observed.failures.length,0);report.combatVoiceCues=observed.cues;
    await page.locator('#pause-btn').tap();await page.locator('#quit-btn').tap();await page.context().close();
  });
  await check('buttons use native click SFX without speech; role previews use their real clips',async()=>{
    await selectionPage.bringToFront();
    if(await selectionPage.locator('#settings-dialog').evaluate(el=>el.open))await selectionPage.locator('#settings-dialog .dialog-close').tap();
    await selectionPage.locator('#character-roster [data-character="pyro"]').tap();
    await sleep(200);const beforeSettings=await inspect(selectionPage);await selectionPage.locator('#settings-btn').tap();
    await waitFor(async()=> (await inspect(selectionPage)).sfxTones.length>beforeSettings.sfxTones.length);
    const afterSettings=await inspect(selectionPage);assert.equal(afterSettings.cues.length,beforeSettings.cues.length,'a button must never request spoken control labels');
    assert.equal(afterSettings.voiceStarts.length,beforeSettings.voiceStarts.length);assert.ok(afterSettings.sfxStarts.length>beforeSettings.sfxStarts.length);
    for(const cue of ['select','ult','ko']){
      const before=(await inspect(selectionPage)).cues.length;await selectionPage.locator(`[data-voice-cue="${cue}"]`).tap();
      await waitFor(async()=> (await inspect(selectionPage)).cues.slice(before).some(c=>c.id==='pyro'&&c.cue===cue&&c.played));
    }
    assert.ok((await inspect(selectionPage)).cues.every(c=>c.id!=='@ui'));
    pass('button uses the SFX bus without narration; three previews play their role WAVs');
    await selectionPage.screenshot({path:output('settings.png')});
  });
  await check('audio resources have no HTTP or browser decode errors',async()=>{
    assert.equal(report.errors.length,0,JSON.stringify(report.errors));assert.ok(report.requests.length>=files.length+2);
    assert.ok(report.requests.every(r=>r.status===200),JSON.stringify(report.requests));assert.equal((await inspect(selectionPage)).failures.length,0);
    pass('audio HTTP loads and native decode chain complete without errors',{requests:report.requests.length,statusText:report.settingsStatus});
  });
})().catch(error=>{report.checks.push({name:'harness',passed:false,error:error.stack||String(error)});console.error(error);}).finally(async()=>{
  for(const context of contexts){try{await context.close();}catch{}}if(browser)await browser.close();if(app)await app.close();
  report.finished=new Date().toISOString();fs.writeFileSync(output('report.json'),JSON.stringify(report,null,2));
  const failures=report.checks.filter(c=>!c.passed);console.log(`REPORT ${report.checks.length-failures.length} passed, ${failures.length} failed: ${output('report.json')}`);process.exitCode=failures.length?1:0;
});
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--playwright', default='C:/Users/ruofa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
    parser.add_argument('--edge', default='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    parser.add_argument('--port', type=int, default=18082)
    args = parser.parse_args()
    if not args.node or not Path(args.playwright).is_dir() or not Path(args.edge).is_file():
        parser.error('installed Node, Playwright module and Edge executable are required')
    root = Path(__file__).resolve().parents[1]
    scratch = root / '.scratch'
    scratch.mkdir(exist_ok=True)
    script = scratch / 'ui-audio-smoke.cjs'
    script.write_text(SCRIPT, encoding='utf-8')
    env = dict(os.environ, UI_PLAYWRIGHT=args.playwright, UI_EDGE=args.edge, UI_PORT=str(args.port))
    return subprocess.call([args.node, str(script)], cwd=root, env=env)


if __name__ == '__main__':
    raise SystemExit(main())
