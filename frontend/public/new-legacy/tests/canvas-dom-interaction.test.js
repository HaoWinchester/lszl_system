'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../src/canvas/dom-interaction.js');
function element(tag='DIV',editable=null,parent=null){
  return {nodeType:1,tagName:tag,parentElement:parent,hasAttribute:name=>name==='contenteditable'&&editable!==null,getAttribute:name=>name==='contenteditable'?editable:null};
}
test('editable descendants, plaintext-only and form controls retain keyboard ownership',()=>{
  for(const el of [element('INPUT'),element('TEXTAREA'),element('SELECT'),element('SPAN',null,element('DIV','plaintext-only')),element('SPAN',null,element('DIV','')),element('DIV','TRUE')])assert.equal(api.isEditingTarget(el),true);
  assert.equal(api.isEditingTarget(element('DIV')),false);
  assert.equal(api.isEditingTarget(element('SPAN',null,element('DIV','false',element('DIV','true')))),false);
});
test('composing and shadow composed paths never become canvas shortcuts',()=>{
  assert.equal(api.isEditingTarget({isComposing:true,target:element()}),true);
  assert.equal(api.isEditingTarget({keyCode:229,target:element()}),true);
  assert.equal(api.isEditingTarget({target:element(),composedPath:()=>[element('INPUT'),element()]}),true);
  assert.equal(api.isEditingTarget({target:element(),composedPath:()=>[element()]}),false);
});
test('active editor is protected until focus leaves it',()=>{
  const doc={activeElement:element('TEXTAREA')};const target=element();target.ownerDocument=doc;
  assert.equal(api.isEditingTarget({target}),true);doc.activeElement=element('BODY');assert.equal(api.isEditingTarget({target}),false);
});
