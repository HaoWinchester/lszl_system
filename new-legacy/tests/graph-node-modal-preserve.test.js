'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/10-graph-editor.js'),'utf8');
const modal=source.slice(source.indexOf('let editingNodeId='),source.indexOf("$('deleteNodeBtn').onclick="));
const clone=value=>JSON.parse(JSON.stringify(value));

function setup(mode='professional'){
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id))elements.set(id,{value:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){}});
    return elements.get(id);
  };
  const context={console,$,setTimeout:fn=>fn(),NODE_SIZES:new Set(['','small','big']),LEVELS:new Set(['基础','重点','难点']),
    graphModeAllows:()=>true,isNodeFullyLocked:()=>false,resetGraphPointerInteractions(){},showStatus(){},render(){},
    safeColor:(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():fallback,
    KGHomeInteractionModes:{getMode:()=>mode},selectedNodeIds:new Set()};
  context.window=context;vm.createContext(context);
  for(const file of ['graph-model.js','history-controller.js'])vm.runInContext(fs.readFileSync(path.join(root,'src/graph',file),'utf8'),context);
  context.state={nodes:[context.KGGraphModel.normalizeNode({id:'card',title:'Original',summary:'Description',category:'  Category  ',level:'基础',keywords:'  key  ',notes:'  note  ',x:81,y:93,color:'#123456',size:'big'})],links:[]};
  const node=context.state.nodes[0];
  context.KGGraphModel.updateAppearance(node,{cardStyle:'rounded',fillColor:'#abcdef',fillOpacity:.4,borderColor:'#654321',borderWidth:3,borderStyle:'dashed',fontSize:24,fontFamily:'serif',textAlign:'right',headerFillColor:'#112233',bodyFillColor:'#445566'});
  context.KGGraphModel.updateGeometry(node,{width:333,height:247});
  context.nodeById=id=>context.state.nodes.find(item=>item.id===id);
  const history=context.KGGraphHistoryController.create({capture:()=>context.state,restore:snapshot=>{context.state=snapshot}});
  context.ensureGraphHistoryController=()=>history;
  vm.runInContext(modal,context);
  return {context,$,history,node:()=>context.state.nodes[0],open:()=>context.openNodeModal('card'),save:()=>$('saveNodeBtn').onclick()};
}

for(const [field,value,property] of [['nTitle','Edited','title'],['nSummary','Edited description','description'],['nLevel','重点','level']]){
  test(`${field} saves only its change and preserves custom geometry and appearance`,()=>{
    const env=setup(),before=clone(env.node());env.open();env.$(field).value=value;env.save();
    assert.deepEqual(clone(env.node().geometry),before.geometry,'editing content must not reset manually resized dimensions');
    assert.deepEqual(clone(env.node().appearance),before.appearance,'editing content must not replace manual fill colors');
    assert.deepEqual(clone(env.node().content),{...before.content,[property]:value},'untouched text must retain whitespace');
  });
}

test('save without edits leaves the complete card and history unchanged',()=>{
  const env=setup(),before=clone(env.node());env.open();env.save();
  assert.deepEqual(clone(env.node()),before);assert.equal(env.history.getState().undoCount,0);
});

test('color edit preserves geometry and unrelated manual styles',()=>{
  const env=setup(),before=clone(env.node());env.open();env.$('nColor').value='#dd8844';env.save();
  assert.deepEqual(clone(env.node().geometry),before.geometry);
  assert.deepEqual(clone(env.node().appearance),{...before.appearance,color:'#dd8844',fillColor:'#dd8844'});
  assert.deepEqual(clone(env.node().content),before.content);
});

test('explicit size preset edit changes dimensions only and undo/redo restores both states',()=>{
  const env=setup(),before=clone(env.node());env.open();env.$('nSize').value='small';env.save();
  assert.deepEqual(clone(env.node().geometry),{x:81,y:93,width:104,height:110});
  assert.deepEqual(clone(env.node().appearance),{...before.appearance,size:'small'});
  assert.deepEqual(clone(env.node().content),before.content);
  const after=clone(env.node());assert.equal(env.history.getState().undoCount,1);
  env.history.undo();assert.deepEqual(clone(env.node()),before);
  env.history.redo();assert.deepEqual(clone(env.node()),after);
});

test('content save undo/redo preserves manual styles and dimensions',()=>{
  const env=setup(),before=clone(env.node());env.open();env.$('nTitle').value='Changed';env.$('nLevel').value='难点';env.save();
  const after=clone(env.node());assert.equal(env.history.getState().undoCount,1);
  env.history.undo();assert.deepEqual(clone(env.node()),before);
  env.history.redo();assert.deepEqual(clone(env.node()),after);
  assert.deepEqual(after.geometry,before.geometry);assert.deepEqual(after.appearance,before.appearance);
});

test('cancel discards field edits and reopening refreshes the comparison baseline',()=>{
  const env=setup(),before=clone(env.node());env.open();env.$('nTitle').value='Discard';env.$('nSize').value='small';env.$('cancelNodeBtn').onclick();
  assert.deepEqual(clone(env.node()),before);assert.equal(env.history.getState().undoCount,0);
  env.open();env.$('nLevel').value='重点';env.save();
  assert.equal(env.node().title,'Original');assert.deepEqual(clone(env.node().geometry),before.geometry);
});

test('efficient mode saves content without modifying hidden advanced values',()=>{
  const env=setup('efficient'),before=clone(env.node());env.open();env.$('nTitle').value='Simple';env.$('nSize').value='small';env.save();
  assert.equal(env.node().title,'Simple');assert.deepEqual(clone(env.node().geometry),before.geometry);assert.deepEqual(clone(env.node().appearance),before.appearance);
});
