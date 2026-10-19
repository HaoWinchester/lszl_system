'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=path.join(__dirname,'../src/graph/template-deep-link.js');
test('template discovery module exists',()=>assert.ok(fs.existsSync(source)));
function api(){return require(source)}
test('deep links validate template identity and keep login separate from loading',()=>{
  assert.equal(api().templateTarget('?templateId=builtin-adult-logic-v1'),'builtin-adult-logic-v1');
  assert.equal(api().templateTarget('?templateId=%3Cscript%3E'),'');
  let owner='',opened=[],states=[];
  const controller=api().createController({target:'builtin-adult-logic-v1',getUser:()=>owner,openCenter:o=>opened.push(o),onState:s=>states.push(s)});
  controller.refresh();assert.equal(states.at(-1),'guest');assert.deepEqual(opened,[]);
  owner='student';controller.refresh();assert.deepEqual(opened,[{templateId:'builtin-adult-logic-v1'}]);
  controller.refresh();assert.equal(opened.length,1);
});
test('template deep link can recover across a real account change without auto-copy',()=>{
  let owner='A',opened=[];
  const controller=api().createController({target:'builtin-adult-classics-v1',getUser:()=>owner,openCenter:o=>opened.push(o),onState:()=>{}});
  controller.refresh();owner='';controller.refresh();owner='B';controller.refresh();
  assert.equal(opened.length,2);assert.deepEqual(Object.keys(opened[0]),['templateId']);
});
test('template center target selector never substitutes an unavailable template',()=>{
  const center=require('../src/graph/template-center-controller.js');
  const rows=[{id:'published'},{id:'other'}];
  assert.deepEqual(center.selectTemplates(rows,'published'),[rows[0]]);
  assert.deepEqual(center.selectTemplates(rows,'withdrawn'),[]);
  assert.deepEqual(center.selectTemplates(rows,''),rows);
});
