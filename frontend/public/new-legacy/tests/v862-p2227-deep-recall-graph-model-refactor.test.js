'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const Graph=require('../src/98-recall-graph-model.js');

// Distinct built-in concepts may share a display title and must not be merged.
{
  const graph=Graph.normalizeGraph({
    nodes:[
      {instanceId:'root',dataId:'root',title:'根'},
      {instanceId:'a',dataId:'concept-a',title:'同名知识点'},
      {instanceId:'a-duplicate',dataId:'concept-a',title:'同名知识点'},
      {instanceId:'b',dataId:'concept-b',title:'同名知识点'}
    ],
    edges:[
      {id:'e1',from:'root',to:'a'},
      {id:'e2',from:'root',to:'a-duplicate'},
      {id:'e3',from:'root',to:'b'}
    ],
    activeNodeId:'a-duplicate'
  });
  assert.deepStrictEqual(graph.nodes.map(node=>node.dataId).sort(),['concept-a','concept-b','root']);
  assert.strictEqual(graph.edges.length,2,'重复实例应合并，但同名的不同 dataId 必须保留');
  assert.strictEqual(graph.activeNodeId,'a');
}

// User-created cards still deduplicate by normalized title.
{
  const graph=Graph.normalizeGraph({
    nodes:[
      {instanceId:'c1',dataId:'custom-1',title:' 我的想法 ',custom:true},
      {instanceId:'c2',dataId:'custom-2',title:'我的想法',custom:true}
    ],
    edges:[]
  });
  assert.strictEqual(graph.nodes.length,1);
}

// Normalization removes duplicates, cycles and redundant transitive edges.
{
  const graph=Graph.normalizeGraph({
    nodes:[
      {instanceId:'r',dataId:'r'},
      {instanceId:'a',dataId:'a'},
      {instanceId:'b',dataId:'b'}
    ],
    edges:[
      {id:'ra',from:'r',to:'a'},
      {id:'ab',from:'a',to:'b'},
      {id:'rb',from:'r',to:'b'},
      {id:'br',from:'b',to:'r'}
    ]
  });
  assert.deepStrictEqual(graph.edges.map(edge=>edge.id),['ra','ab']);
  assert.deepStrictEqual(graph.nodes.map(node=>node.depth),[0,1,2]);
  assert.strictEqual(Graph.canConnect(graph.nodes,graph.edges,'r','b'),false);
  assert.strictEqual(Graph.canConnect(graph.nodes,graph.edges,'b','r'),false);
}

// Removing an intermediate card promotes its descendants to roots and recalculates depth.
{
  const removed=Graph.removeNode({
    nodes:[
      {instanceId:'r',dataId:'r',depth:0},
      {instanceId:'a',dataId:'a',depth:1,parentId:'r'},
      {instanceId:'b',dataId:'b',depth:2,parentId:'a'}
    ],
    edges:[{id:'ra',from:'r',to:'a'},{id:'ab',from:'a',to:'b'}]
  },'a');
  assert.strictEqual(removed.removedNode.instanceId,'a');
  assert.deepStrictEqual(removed.edges,[]);
  assert.deepStrictEqual(removed.nodes.map(node=>({id:node.instanceId,depth:node.depth,parentId:node.parentId})),[
    {id:'r',depth:0,parentId:null},{id:'b',depth:0,parentId:null}
  ]);
}

// Progress persistence is server-only; the compatibility facade keeps only transient navigation hints.
{
  const map=new Map(),writes=[];
  const context={console,globalThis:null,window:null,CustomEvent:function(){},setTimeout,clearTimeout,
    addEventListener:()=>{},
    localStorage:{
      get length(){return map.size},key:i=>[...map.keys()][i]??null,
      getItem:key=>map.has(String(key))?map.get(String(key)):null,
      setItem:(key,value)=>{key=String(key);map.set(key,String(value));writes.push(key)},
      removeItem:key=>map.delete(String(key))
    },
    KGAuthCore:{currentUsername:()=> 'index-user',currentUser:()=>({username:'index-user'})}
  };
  context.globalThis=context;context.window=context;vm.createContext(context);
  vm.runInContext(read('src/97-recall-storage.js'),context,{filename:'97-recall-storage.js'});
  const storage=context.KGRecallStorage,q={id:'q1',sourceQuestionId:'q1',sourceBankId:'bank-1'};
  assert.throws(()=>storage.writeProgress(q,'bank-1',{nodes:[{instanceId:'n1'}],edges:[],activeKeywords:[]}),/KGDeepRecallServerAdapter/);
  assert.throws(()=>storage.readProgress(q,'bank-1'),/KGDeepRecallServerAdapter/);
  assert.throws(()=>storage.removeProgress(q,'bank-1'),/KGDeepRecallServerAdapter/);
  storage.markExplored(q,'bank-1',true);
  assert(storage.exploredSet('bank-1').has('q1'));
  assert.deepStrictEqual(writes,[],'兼容层不得把探索索引写入浏览器存储');
}

const html=read('knowledge-recall.html');
const controller=read('src/86-knowledge-recall.js');
assert(html.includes('src/98-recall-graph-model.js')&&html.indexOf('src/98-recall-graph-model.js')<html.indexOf('src/86-knowledge-recall.js'),'图模型必须在页面控制器前加载');
assert(controller.includes('const GraphModel=window.KGRecallGraphModel||{}')&&controller.includes('GraphModel.normalizeGraph?.'),'页面控制器应委托图规范化');
assert(controller.includes('GraphModel.removeNode?.')&&controller.includes('GraphModel.canConnect?.'),'删除和连接校验应委托图模型');
assert(controller.includes('function bindQuestionInteractions()')&&!controller.includes("questionCard.querySelectorAll('.kr-keyword').forEach"),'关键词点击应使用事件委托');
assert(controller.includes('let keywordMatchers=buildKeywordMatchers(rootMap)')&&controller.includes('keywordMatchers=buildKeywordMatchers(rootMap)'),'关键词匹配器应按题目缓存');
assert(controller.includes('openNodeGuide(active,button,{countOpen:false})'),'语言切换重绘不得重复累计打开次数');
console.log('v862-p2227-deep-recall-graph-model-refactor-ok');
