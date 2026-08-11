'use strict';
const fs=require('fs');
const assert=require('assert');
const vm=require('vm');
const read=file=>fs.readFileSync(file,'utf8');


for(const file of [
  'src/teacher/shared/difficulty-service.js',
  'src/principles/principle-repository.js',
  'src/principles/synthesis-preset-repository.js',
  'src/practice/practice-selection-service.js',
  'src/practice/practice-attempt-repository.js',
  'src/teacher/training-config/principle-preset-controller.js'
])assert(fs.existsSync(file),file);

const memory=new Map();
const storage={
  getItem:key=>memory.has(String(key))?memory.get(String(key)):null,
  setItem:(key,value)=>memory.set(String(key),String(value)),
  removeItem:key=>memory.delete(String(key)),clear:()=>memory.clear(),key:index=>[...memory.keys()][index]||null,
  get length(){return memory.size}
};
const math=Object.create(Math);math.random=()=>0.25;
const sandbox={console,Date,Math:math,JSON,URLSearchParams,setTimeout,clearTimeout,localStorage:storage,
  dispatchEvent:()=>true,CustomEvent:function(type,options){this.type=type;this.detail=options?.detail}};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
for(const file of ['src/teacher/shared/difficulty-service.js','src/principles/principle-repository.js','src/principles/synthesis-preset-repository.js','src/practice/practice-selection-service.js','src/practice/practice-attempt-repository.js']){
  vm.runInNewContext(read(file),sandbox,{filename:file});
}
const Difficulty=sandbox.KGDifficultyService;
assert.strictEqual(Difficulty.normalize('基础'),'easy');
assert.strictEqual(Difficulty.normalize('中等'),'medium');
assert.strictEqual(Difficulty.normalize('难点'),'hard');
let migrated=Difficulty.migrateQuestion({difficulty:'重点',tags:[]});
assert.strictEqual(migrated.difficulty,'');assert(migrated.tags.includes('重点'));
migrated=Difficulty.migrateQuestion({difficulty:'易错点',tags:[]});
assert.strictEqual(migrated.difficulty,'');assert(migrated.tags.includes('易错'));
assert.strictEqual(Difficulty.stars('hard'),'★★★');

const Principles=sandbox.KGPrincipleRepository,Presets=sandbox.KGSynthesisPresetRepository;
const primary=Principles.upsert({name:'先分析后行动'});
const confuse=Principles.upsert({name:'快速试错'});
Principles.upsert({...primary,confusablePrincipleIds:[confuse.id]});
const preset=Presets.upsert({principleId:primary.id,title:'原则：先分析后行动',content:'先明确目标、信息和约束，再决定行动方式。',status:'active'});
assert.strictEqual(Presets.getByPrincipleId(primary.id,{activeOnly:true}).id,preset.id);

const q=(id,difficulty,principleId)=>({question:{id,difficulty,metadata:{principleIds:[principleId]}},bank:{id:'bank'}});
const items=[
  q('e1','easy',primary.id),q('e2','easy',primary.id),q('e3','easy',primary.id),
  q('m1','medium',primary.id),q('m2','medium',primary.id),q('m3','medium',primary.id),
  q('h1','hard',primary.id),q('h2','hard',primary.id),q('h3','hard',primary.id),
  q('c1','hard',confuse.id),q('c2','medium',confuse.id)
];
const Select=sandbox.KGPracticeSelectionService;
assert(Select.legacyPrincipleNames({principleTag:'先分析后行动'}).includes('先分析后行动'));
assert(!Select.legacyPrincipleNames({tags:['先分析后行动']}).includes('先分析后行动'));
assert(Select.legacyPrincipleNames({tags:['原则：先分析后行动']}).includes('先分析后行动'));
const easy=Select.select({items,principleId:primary.id,level:1,count:3});
assert.strictEqual(easy.items.length,3);assert(easy.items.every(item=>item.question.difficulty==='easy'));
const medium=Select.select({items,principleId:primary.id,level:2,count:3});
assert.strictEqual(medium.items.length,3);assert(medium.items.every(item=>item.question.difficulty==='medium'));
const hard=Select.select({items,principleId:primary.id,level:3,count:3,confusablePrincipleIds:[confuse.id]});
assert.strictEqual(hard.items.length,3);
assert.strictEqual(hard.items.filter(item=>Select.matches(item,primary.id)).length,2);
assert.strictEqual(hard.items.filter(item=>Select.matches(item,confuse.id)).length,1);

const workspace=read('src/77-multi-question-workspace.js');
assert.match(workspace,/cardType:preset\?'system':'user'/);
assert.match(workspace,/data-qw-action="practice-cycle-level"/);
assert.match(workspace,/PracticeSelector\.select/);
assert.match(workspace,/系统预设归纳卡不可编辑/);
assert.match(workspace,/复制为我的归纳/);
const html=read('question-bank.html');
assert.match(html,/data-annotation-tab="principles"/);
assert.match(html,/id="questionDifficultyStars"/);
assert.match(html,/id="tqPresetContent"/);
assert.match(read('styles/teacher-question-workflow.css'),/body\.qb-training-step \.qb-annotation-tabs\{display:flex!important/);
console.log('v90-p4313-static-pass principle-preset-star-practice');
