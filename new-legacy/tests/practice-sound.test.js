'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=path.join(__dirname,'../src/practice/practice-sound.js');

// Web Audio is an external browser resource; record scheduled nodes while running
// the actual preference helper and sound controller, with no fake business logic.
function harness({supported=true,resumeReject=false,suspended=false,storage=new Map()}={}){
  assert.ok(fs.existsSync(source),'shared sound module is required');
  const listeners=new Map(),buttonListeners=new Map(),contexts=[];
  const button={textContent:'',attrs:{},setAttribute(key,value){this.attrs[key]=value},
    addEventListener(key,fn){buttonListeners.set(key,fn)},removeEventListener(key){buttonListeners.delete(key)}};
  let owner='学员 A',feedback=true,releaseResume;
  class AudioContext {
    constructor(){this.state=suspended?'suspended':'running';this.currentTime=5;this.destination={};this.nodes=[];contexts.push(this)}
    resume(){if(resumeReject)return Promise.reject(new Error('autoplay denied'));if(suspended)return new Promise(resolve=>{releaseResume=()=>{this.state='running';resolve()}});this.state='running';return Promise.resolve()}
    close(){this.state='closed';return Promise.resolve()}
    createOscillator(){const node={frequency:{events:[],setValueAtTime(value,time){this.events.push([value,time])},exponentialRampToValueAtTime(value,time){this.events.push([value,time])}},connect(){},disconnect(){this.disconnected=true},start(time){this.started=time},stop(time){this.stopped=time}};this.nodes.push(node);return node}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){this.disconnected=true}}}
  }
  const win={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),
    setTimeout:()=>assert.fail('sound must not schedule JS timers'),setInterval:()=>assert.fail('sound must not schedule JS intervals')};
  if(supported)win.AudioContext=AudioContext;
  const context={window:win};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/28-device-preferences.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(source,'utf8'),context);
  const sound=win.KGPracticeSound.create({button,getOwner:()=>owner,getFeedbackEnabled:()=>feedback});
  sound.setActive(true);
  return {sound,button,storage,contexts,click:()=>buttonListeners.get('click')(),
    owner(value){owner=value;listeners.get('kg-auth-session-change')?.()},feedback(value){feedback=value},
    release:()=>releaseResume?.(),event:key=>listeners.get(key)?.()};
}

test('default is quiet and explicit toggle persists only approved owner preference',async()=>{
  const h=harness();
  assert.equal(h.button.textContent,'音效关');assert.equal(h.button.attrs['aria-pressed'],'false');
  assert.equal(await h.sound.play(true),false);assert.equal(h.contexts.length,0);
  h.click();assert.equal(h.button.textContent,'音效开');assert.equal(h.button.attrs['aria-pressed'],'true');
  assert.equal(h.storage.get('kg_practice_sound_v1__%E5%AD%A6%E5%91%98%20A'),'true');
  assert.equal(h.storage.size,1);assert.equal(h.contexts.flatMap(c=>c.nodes).length,0,'enabling must not preview an answer tone');
  const reloaded=harness({storage:h.storage});assert.equal(reloaded.button.textContent,'音效开');
  assert.equal(reloaded.contexts.length,0,'restoring enabled preference must not unlock/play');
});

test('new correct and wrong feedback schedule distinct short low-gain tones',async()=>{
  const h=harness();h.click();
  assert.equal(await h.sound.play(true),true);
  const good=h.contexts.at(-1).nodes.at(-1);
  assert.ok(good.stopped-good.started<=0.3);good.onended();assert.equal(good.disconnected,true);
  assert.equal(await h.sound.play(false),true);
  const bad=h.contexts.at(-1).nodes.at(-1);
  assert.notEqual(good.frequency.events[0][0],bad.frequency.events[0][0]);
  assert.ok(bad.stopped-bad.started<=0.3);
});

test('disabled real-time feedback never creates an answer tone even after unlock',async()=>{
  const h=harness();h.click();h.feedback(false);
  assert.equal(await h.sound.play(true),false);assert.equal(await h.sound.play(false),false);
  assert.equal(h.contexts.flatMap(c=>c.nodes).length,0);
});

test('muting immediately cancels playing nodes and pending resume',async()=>{
  const h=harness();h.click();await h.sound.play(true);
  const node=h.contexts.at(-1).nodes[0];h.click();
  assert.equal(node.stopped,undefined,'cancel uses immediate stop()');assert.equal(node.disconnected,true);
  assert.equal(await h.sound.play(false),false);
  const pending=harness({suspended:true});pending.click();const play=pending.sound.play(true);
  pending.click();pending.release();assert.equal(await play,false);assert.equal(pending.contexts.flatMap(c=>c.nodes).length,0);
});

test('leaving answer view cancels late resume and does not replay on returning',async()=>{
  const h=harness({suspended:true});h.click();const pending=h.sound.play(true);
  h.sound.setActive(false);h.release();assert.equal(await pending,false);
  h.sound.setActive(true);assert.equal(h.contexts.flatMap(c=>c.nodes).length,0);
});

test('owner change resets sound state, stops old audio, and isolates preferences',async()=>{
  const h=harness();h.click();await h.sound.play(true);const old=h.contexts[0];
  h.owner('B');assert.equal(h.button.textContent,'音效关');assert.equal(old.state,'closed');
  h.click();assert.equal(h.storage.get('kg_practice_sound_v1__B'),'true');
  assert.equal(await h.sound.play(false),false,'old active session must not sound for new owner');
  h.sound.setActive(true);assert.equal(await h.sound.play(false),true);
  h.owner('学员 A');assert.equal(h.button.textContent,'音效开');
  assert.equal(h.storage.size,2);
});

test('owner switch during pending resume cannot emit old answer to the new account',async()=>{
  const h=harness({suspended:true});h.click();const play=h.sound.play(true);
  h.owner('B');h.release();assert.equal(await play,false);assert.equal(h.contexts.flatMap(c=>c.nodes).length,0);
});

test('unsupported, rejected and closed audio contexts never reject the answer path',async()=>{
  const absent=harness({supported:false});absent.click();assert.equal(await absent.sound.play(true),false);
  const rejected=harness({resumeReject:true,suspended:true});rejected.click();assert.equal(await rejected.sound.play(true),false);
  const closed=harness();closed.click();closed.contexts[0].state='closed';
  await assert.doesNotReject(()=>closed.sound.play(false));
});

test('pagehide and disposal stop sound without timers, dispose removes listeners',async()=>{
  const h=harness();h.click();await h.sound.play(false);const context=h.contexts[0];
  h.event('pagehide');assert.equal(context.state,'closed');assert.equal(await h.sound.play(true),false);
  h.sound.dispose();h.click=()=>{};
  assert.equal(await h.sound.play(true),false);
});
