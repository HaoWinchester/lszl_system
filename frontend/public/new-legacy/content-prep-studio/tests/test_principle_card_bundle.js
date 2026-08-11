'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const document={getElementById:()=>null,body:{},createElement:()=>({})};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
vm.runInContext(source('00-core-bootstrap.js'),context,{filename:'00-core-bootstrap.js'});
vm.runInContext(source('10-state-domain.js'),context,{filename:'10-state-domain.js'});

const bundle=vm.runInContext(`principleCardBundlePayload({
  schemaVersion:1,
  items:[{id:'principle-a',name:'先识别约束',status:'active'}]
},{schemaVersion:1,items:[{id:'preset-a',principleId:'principle-a',title:'原则：先识别约束',content:'识别限制，再比较方案。',status:'active'}]})`,context);
assert.equal(bundle.format,'kg-principle-card-bundle-v1');
assert.equal(bundle.principles.items.length,1);
assert.equal(bundle.synthesisPresets.items[0].principleId,'principle-a');

const normalized=vm.runInContext(`normalizeQuestion({
  correctAnswer:'B',options:[{id:'A'},{id:'B',correct:true}],
  metadata:{principleIds:['legacy-stem'],optionPrincipleMap:{A:['trap'],B:['answer'],Z:['stale']}}
},0,'PMP')`,context);
assert.deepEqual(JSON.parse(JSON.stringify(normalized.metadata)),{
  principleIds:['legacy-stem','trap','answer'],
  stemPrincipleIds:['legacy-stem'],
  optionPrincipleMap:{A:['trap'],B:['answer']},
  tagPaths:[],
  knowledge:{},
});

assert.throws(
  ()=>vm.runInContext(`principleCardBundlePayload({items:[{id:'principle-a',name:'先识别约束'}]},{items:[]})`,context),
  /缺少对应归纳卡/,
);
assert.throws(
  ()=>vm.runInContext(`principleCardBundlePayload({items:[{id:'principle-a',name:'先识别约束'}]},{items:[{id:'one',principleId:'principle-a'},{id:'two',principleId:'principle-a'}]})`,context),
  /重复归纳卡/,
);

console.log('principle-card-bundle: passed');
