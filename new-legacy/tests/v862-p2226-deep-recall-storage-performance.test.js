'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function makeContext(){
  const map=new Map();let user='alice';
  const localStorage={
    get length(){return map.size},
    key(index){return [...map.keys()][index]??null},
    getItem:key=>map.has(String(key))?map.get(String(key)):null,
    setItem:(key,value)=>map.set(String(key),String(value)),
    removeItem:key=>map.delete(String(key)),
    clear:()=>map.clear()
  };
  const context={console,localStorage,globalThis:null,window:null,CustomEvent:function(){},setTimeout,clearTimeout};
  context.globalThis=context;context.window=context;
  context.KGAuthCore={currentUsername:()=>user,currentUser:()=>({username:user})};
  context.__setUser=next=>{user=String(next)};
  vm.createContext(context);
  vm.runInContext(read('src/97-recall-storage.js'),context,{filename:'97-recall-storage.js'});
  return {context,map,setUser:context.__setUser,storage:context.KGRecallStorage};
}

const {context,map,setUser,storage}=makeContext();
const sameA={id:'same-id',sourceQuestionId:'same-id',sourceBankId:'bank-a'};
const sameB={id:'same-id',sourceQuestionId:'same-id',sourceBankId:'bank-b'};

assert(storage.writeCurrent({question:sameA,sourceBankId:'bank-a',sourceQuestionId:'same-id',savedAt:1}));
assert(storage.writeProgress(sameA,'bank-a',{nodes:[{instanceId:'a'}],edges:[],activeKeywords:['a']}));
const aliceKey=storage.progressKey(sameA,'bank-a');
assert(aliceKey.includes('user__alice')&&aliceKey.includes('bank__bank-a')&&aliceKey.includes('question__same-id'));
assert.strictEqual(storage.readProgress(sameA,'bank-a').nodes.length,1);
assert.strictEqual(storage.readProgress(sameB,'bank-b'),null,'同题号不同题库不得共用进度');
assert(storage.exploredSet('bank-a').has('same-id'));

setUser('bob');
assert.strictEqual(storage.readCurrent(),null,'新账号不得读取旧账号当前题目');
assert.strictEqual(storage.readProgress(sameA,'bank-a'),null,'新账号不得读取旧账号进度');
assert(storage.writeProgress(sameB,'bank-b',{nodes:[{instanceId:'b'}],edges:[],activeKeywords:[]}));
const bobKey=storage.progressKey(sameB,'bank-b');
assert(bobKey.includes('user__bob')&&bobKey!==aliceKey);
assert.strictEqual(JSON.parse(map.get(aliceKey)).nodes[0].instanceId,'a');
assert.strictEqual(JSON.parse(map.get(bobKey)).nodes[0].instanceId,'b');


// The published-paper question source should reuse its normalized list until the release JSON changes.
{
  const store=new Map();
  const ctx={console,globalThis:null,window:null,localStorage:{
    getItem:key=>store.has(String(key))?store.get(String(key)):null,
    setItem:(key,value)=>store.set(String(key),String(value)),removeItem:key=>store.delete(String(key))
  },KGAuthCore:{currentUsername:()=> 'cache-user'}};
  ctx.globalThis=ctx;ctx.window=ctx;vm.createContext(ctx);
  const release=questions=>JSON.stringify([{
    releaseId:'release-cache',paperId:'paper-cache',name:'缓存试卷',version:1,enabledModes:['deep_recall'],
    questions:questions.map((id,index)=>({bankId:'cache-bank',questionId:id,order:index+1})),
    questionSnapshots:questions.map(id=>({bankId:'cache-bank',questionId:id,question:{id,title:'题'+id,stemParts:[{text:'题干'}],options:[]}}))
  }]);
  store.set('kg_exam_papers_published_v1',release(['q1']));
  vm.runInContext(read('src/59-published-paper-repository.js'),ctx,{filename:'59-published-paper-repository.js'});
  vm.runInContext(read('src/96-recall-question-source.js'),ctx,{filename:'96-recall-question-source.js'});
  const first=ctx.KGRecallQuestionSource.list(),second=ctx.KGRecallQuestionSource.list();
  assert.strictEqual(first,second,'发布版本未变化时应复用解析后的列表');
  store.set('kg_exam_papers_published_v1',release(['q1','q2']));
  const third=ctx.KGRecallQuestionSource.list();
  assert.notStrictEqual(third,first,'发布版本内容变化后应自动刷新缓存');
  assert.strictEqual(third[0].questions.length,2);
}

const recall=read('src/86-knowledge-recall.js');
const source=read('src/96-recall-question-source.js');
const html=read('knowledge-recall.html');
const css25=read('styles/knowledge-recall-p2225.css');
const css23=read('styles/knowledge-recall-p2223.css');
assert(html.includes('src/97-recall-storage.js')&&html.indexOf('src/97-recall-storage.js')<html.indexOf('src/86-knowledge-recall.js'),'页面应在主控制器前加载存储服务');
assert(recall.includes('const map={};')&&!recall.includes('const map={...(DATA.roots||{})}'),'关键词根映射不得全局注入 PMP 示例词');
assert(recall.includes("nodeLayer.addEventListener('dblclick'")&&recall.includes("if(event.detail>1){clearCardClick();return}"),'双击删除应取消待执行的单击动作');
assert(recall.includes('const nodeById=new Map(state.nodes.map'),'连线渲染应使用 Map，避免逐边线性查找');
assert(recall.includes('searchTimer=setTimeout(renderQuestionList,130)'),'题目搜索应防抖');
assert(recall.includes("$('krQuestionList')?.addEventListener('click'"),'题目列表应使用事件委托');
assert(recall.includes("window.addEventListener('pagehide',flushProgress)")&&recall.includes('progressSaveTimer=setTimeout'),'进度保存应防抖并在离开页面时刷新');
assert(!recall.includes('最长链')&&!recall.includes('maxDepth'),'最长链计算与展示应完全移除');
assert(source.includes('cache.signature===raw')&&source.includes('cache.list'),'发布试卷读取服务应缓存未变化的解析结果');
assert(css25.includes('.knowledge-recall-page .account-menu{')&&css25.includes('background:var(--kr-surface-glass)'),'账号菜单应跟随主题变量');
assert(!/\.knowledge-recall-page \.kr-scene-menu\{display:none\}/.test(css25),'移动端不应隐藏场景入口');
assert(!css23.includes('color:#334155!important')&&!css23.includes('background:#fff!important'),'旧补丁不得继续强制白色账号菜单');
console.log('v862-p2226-deep-recall-storage-performance-static-ok');
