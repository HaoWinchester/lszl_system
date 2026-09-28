import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const path=new URL('../../new-legacy/src/feature-usage-clock.js',import.meta.url);
function setup(){let now=Date.UTC(2026,8,28);const sent=[];let id=0;const g={};vm.runInNewContext(readFileSync(path,'utf8'),{globalThis:g});const clock=g.KGUsageClock.create({now:()=>now,uuid:()=>`id-${++id}`,emit:e=>sent.push(e)});clock.select('practice','A');clock.visibility(true);return {clock,sent,step:s=>now+=s*1000};}
test('delta segments count one hour without the old 30 minute cap',()=>{const x=setup();for(let i=0;i<240;i++){x.step(15);x.clock.touch();}assert.equal(x.sent.reduce((n,e)=>n+e.activeSeconds,0),3600);assert.equal(new Set(x.sent.map(e=>e.eventId)).size,240);});
test('idle keeps foreground separate from estimated active use',()=>{const x=setup();for(let i=0;i<40;i++){x.step(15);x.clock.tick();}assert.equal(x.sent.reduce((n,e)=>n+e.foregroundSeconds,0),600);assert.equal(x.sent.reduce((n,e)=>n+e.activeSeconds,0),120);});
test('hidden time excluded, return never resends previous duration',()=>{const x=setup();x.step(15);x.clock.visibility(false);x.step(600);x.clock.tick();x.clock.visibility(true);x.step(15);x.clock.visibility(false);assert.deepEqual(x.sent.map(e=>e.foregroundSeconds),[15,15]);});
test('account change drops pending interval and creates new visit',()=>{const x=setup();x.step(10);x.clock.select('practice','B');x.step(15);x.clock.tick();assert.equal(x.sent.length,1);assert.equal(x.sent[0].identity,'B');assert.equal(x.sent[0].foregroundSeconds,15);});
test('feature change settles old feature and starts a new visit',()=>{const x=setup();x.step(12);x.clock.select('analysis','A');x.step(13);x.clock.tick();assert.deepEqual(x.sent.map(e=>[e.featureKey,e.activeSeconds]),[['practice',12],['analysis',13]]);assert.notEqual(x.sent[0].visitId,x.sent[1].visitId);});
test('suspension gap is not misreported as focused use',()=>{const x=setup();x.step(3600);x.clock.tick();assert.equal(x.sent.length,0);});
test('Shanghai midnight splits a heartbeat into separate days',()=>{
 let now=Date.UTC(2026,8,28,15,59,50),id=0;const sent=[],g={};vm.runInNewContext(readFileSync(path,'utf8'),{globalThis:g});
 const c=g.KGUsageClock.create({now:()=>now,uuid:()=>String(++id),emit:x=>sent.push(x)});c.select('practice','A');c.visibility(true);now+=15000;c.tick();assert.deepEqual(sent.map(x=>x.foregroundSeconds),[10,5]);
});
