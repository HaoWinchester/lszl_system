'use strict';

/*
 * G3 · Question Family v1（P4.5.29 差异 12–17、19、28 部分）
 *
 * 覆盖：
 * 1. 归一：角色/关系/变体/等价等级/诊断目标/用途的中文与英文别名，difficultyLevel 1–4 收敛，
 *    qualityConfirmed 宽松布尔解析
 * 2. root/member/standalone 三角色与家族绑定（resolveQuestionFamilies）
 * 3. 从母题创建成员（makeQuestionFamilyMember，差异 17）
 * 4. 最低覆盖检查：Root-only 合法（warn 非 error）；补齐后 complete；人工确认后 ready（差异 19）
 * 5. 校验：member 未绑母题 error；关系非法 error；重复母题 error（差异 28）
 * 6. 外部导入强制 qualityConfirmed=false（差异 16）
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const document={getElementById:()=>null,body:{},createElement:()=>({})};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:()=>'11111111-1111-4111-8111-111111111111'},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
vm.runInContext(source('00-core-bootstrap.js'),context,{filename:'00-core-bootstrap.js'});
vm.runInContext(source('10-state-domain.js'),context,{filename:'10-state-domain.js'});
vm.runInContext(source('12-p45-authoring-domain.js'),context,{filename:'12-p45-authoring-domain.js'});

const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

/* ── 1. 归一（差异 12–15）────────────────────────────────── */

const fam=run(`normalizeQuestionFamily(${JSON.stringify({
  role:'母题',familyKey:'FAMILY-001',relationToRoot:'等价',variantType:'情境',
  equivalenceGrade:'强等价',diagnosticTarget:'案例迁移',difficultyLevel:9,
  purposes:['练习','错误确认','不存在用途'],qualityConfirmed:'是',notes:' x ',
})},'q-root','中等')`);
assert.equal(fam.role,'root','中文角色别名 母题→root');
assert.equal(fam.relationToRoot,'root','root 角色关系固定为 root');
assert.equal(fam.difficultyLevel,4,'difficultyLevel 收敛到 1–4');
assert.deepEqual(fam.purposes,['practice','error-confirmation'],'用途中文映射且过滤未知值');
assert.equal(fam.qualityConfirmed,true,"qualityConfirmed '是' 解析为 true");

const member=run(`normalizeQuestionFamily(${JSON.stringify({
  role:'成员',relationToRoot:'能力拆解',variantType:'题干',equivalenceGrade:'',
  diagnosticTarget:'概念',difficultyLevel:0,purposes:[],
})},'q-member','简单')`);
assert.equal(member.role,'member');
assert.equal(member.relationToRoot,'decomposed','能力拆解→decomposed');
assert.equal(member.variantType,'stem');
assert.equal(member.diagnosticTarget,'concept');
assert.equal(member.difficultyLevel,1,'difficultyLevel 下限 1');
assert.deepEqual(member.purposes,['practice'],'空用途默认 practice');

const standalone=run(`normalizeQuestionFamily({role:'bogus'},'q-x','中等')`);
assert.equal(standalone.role,'standalone','未知角色归一为独立题');

/* ── 2/3. 家族绑定与从母题创建成员 ─────────────────────────── */

// 三题进 state：root + 通过 familyKey 绑定的 member + 孤儿 member
vm.runInContext(`
    state.questionBank.questions=[
      {id:'q-root',title:'母题',subject:'PMP',options:[],metadata:{questionFamily:{role:'root',familyKey:'FAMILY-001'}}},
      {id:'q-member',title:'成员',subject:'PMP',options:[],metadata:{questionFamily:{role:'member',familyKey:'FAMILY-001',relationToRoot:'equivalent',equivalenceGrade:'A',variantType:'scenario',diagnosticTarget:'application',difficultyLevel:2}}},
      {id:'q-orphan',title:'孤儿',subject:'PMP',options:[],metadata:{questionFamily:{role:'member',familyKey:'FAMILY-404'}}},
    ];
    resolveQuestionFamilies();
  `,context);
const bound=run(`questionFamily(state.questionBank.questions[1])`);
assert.ok(bound.familyId,'成员解析后继承 familyId');
assert.equal(bound.rootQuestionId,'q-root','成员通过 familyKey 绑定到母题');
const rootFam=run(`questionFamily(state.questionBank.questions[0])`);
assert.equal(rootFam.role,'root');
assert.ok(rootFam.familyId,'母题自动生成系统 Family ID');

// 从母题创建成员（差异 17）
const created=run(`(function(){
    const copy=JSON.parse(JSON.stringify(state.questionBank.questions[0]));
    copy.id='q-created';
    makeQuestionFamilyMember(copy,state.questionBank.questions[0]);
    questionFamily(copy).qualityConfirmed=false;
    return questionFamily(copy);
  })()`);
assert.equal(created.role,'member');
assert.equal(created.rootQuestionId,'q-root');
assert.equal(created.familyKey,'FAMILY-001');
assert.equal(created.relationToRoot,'equivalent','默认等价变体');
assert.equal(created.variantType,'stem','默认题干变体');
assert.equal(created.equivalenceGrade,'A','等价默认 A 级');
assert.equal(created.qualityConfirmed,false,'新建成员质量未确认');

/* ── 4. 最低覆盖（差异 19：Root-only 合法，只 warn）────────── */

let issues=run(`validateQuestionFamily(state.questionBank.questions[0])`);
const rootOnly=issues.filter(x=>x.message.includes('最低配置未达标'));
assert.equal(rootOnly.length,1);
assert.equal(rootOnly[0].level,'warn','覆盖不足只是未诊断就绪提示，不是导入错误');
assert.ok(!issues.some(x=>x.level==='error'),'Root-only 不产生 error');

// 补齐最低覆盖：2 强等价 + 1 概念 + 1 理解 + 1 高阶
vm.runInContext(`
    const mk=(id,relation,grade,target,purposes,level)=>({id,title:id,subject:'PMP',options:[],metadata:{questionFamily:{role:'member',familyKey:'FAMILY-001',relationToRoot:relation,equivalenceGrade:grade,variantType:'scenario',diagnosticTarget:target,difficultyLevel:level||2,purposes,qualityConfirmed:true}}});
    state.questionBank.questions=[
      state.questionBank.questions[0],state.questionBank.questions[1],
      mk('m1','equivalent','A','application',['practice'],2),
      mk('m2','equivalent','A','application',['practice'],2),
      mk('m3','decomposed','','concept',['diagnosis'],1),
      mk('m4','decomposed','','understanding',['diagnosis'],1),
      mk('m5','extension','','case-transfer',['post-remediation-verification'],3),
    ];
    resolveQuestionFamilies();
  `,context);
const coverage=run(`familyCoverageFor(state.questionBank.questions[0])`);
assert.equal(coverage.strong,3,'含 q-member 共 3 道强等价');
assert.equal(coverage.coverage,5);
assert.equal(coverage.complete,true,'最低覆盖达成');
assert.equal(coverage.ready,true,'全部人工确认后诊断就绪');

/* ── 5. 校验（差异 28）────────────────────────────────────── */

// 孤儿成员 → error
issues=run(`(function(){
    const orphan={id:'q-lonely',title:'孤儿成员',subject:'PMP',options:[],metadata:{questionFamily:{role:'member',familyKey:'FAMILY-NOPE',relationToRoot:'equivalent'}}};
    state.questionBank.questions.push(orphan);resolveQuestionFamilies();
    return validateQuestionFamily(orphan);
  })()`);
assert.ok(issues.some(x=>x.level==='error'&&x.message.includes('母题')&&x.message.includes('FAMILY-NOPE')),JSON.stringify(issues));

// 重复母题同 familyKey → error（结构级校验）
vm.runInContext(`
    state.questionBank.questions.push({id:'q-root2',title:'重复母题',subject:'PMP',options:[],metadata:{questionFamily:{role:'root',familyKey:'FAMILY-001'}}});
    resolveQuestionFamilies();
  `,context);
const struct=run(`validateFamilyStructure(state.questionBank.questions)`);
assert.ok(struct.some(x=>x.level==='error'&&x.message.includes('家族代号重复')),JSON.stringify(struct));

/* ── 6. 外部导入强制 qualityConfirmed=false（差异 16）────── */

vm.runInContext(`
    state.questionBank.questions=[
      {id:'q-ext',title:'外部题',subject:'PMP',options:[],metadata:{questionFamily:{role:'root',familyKey:'FAMILY-EXT',qualityConfirmed:true}}},
    ];
    forceExternalFamilyUnconfirmed(state.questionBank.questions);
  `,context);
const ext=run(`questionFamily(state.questionBank.questions[0])`);
assert.equal(ext.qualityConfirmed,false,'外部导入一律强制 false，由教师人工确认');

console.log('p45-family: passed');
