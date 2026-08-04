'use strict';

(function(global){
  const MAX_DEPTH=9;
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const clean=value=>String(value??'').trim();
  function readLocal(key){try{const raw=global.localStorage?.getItem(key);return raw?JSON.parse(raw):null}catch(error){return null}}
  const SUBJECTS=[
    {id:'subject-pmp',code:'PMP',name:'PMP 项目管理',defaultTaxonomyId:'taxonomy-pmp-main'},
    {id:'subject-cspm',code:'CSPM',name:'CSPM 项目管理能力',defaultTaxonomyId:'taxonomy-cspm-main'},
    {id:'subject-p2',code:'P2',name:'P2 / PRINCE2',defaultTaxonomyId:'taxonomy-p2-main'},
    {id:'subject-acp',code:'ACP',name:'ACP 敏捷项目管理',defaultTaxonomyId:'taxonomy-acp-main'},
    {id:'subject-npdp',code:'NPDP',name:'NPDP 产品开发',defaultTaxonomyId:'taxonomy-npdp-main'}
  ];
  const root=(id,taxonomyId,title)=>({id,taxonomyId,parentId:null,level:1,title});
  const TAXONOMIES=[
    {id:'taxonomy-pmp-main',subjectId:'subject-pmp',name:'PMP 主知识树',version:1,maxDepth:9,nodes:[
      root('kp-pmp','taxonomy-pmp-main','PMP'),
      {id:'kp-pmp-environment',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:'项目环境'},
      {id:'kp-pmp-principles',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:'项目管理原则'},
      {id:'kp-pmp-domains',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:'项目绩效域'},
      {id:'kp-pmp-requirements',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:'项目需求管理'},
      {id:'kp-pmp-plan-requirements',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-requirements',level:3,title:'规划需求管理'},
      {id:'kp-pmp-plan-requirements-output',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-plan-requirements',level:4,title:'输出'},
      {id:'kp-pmp-rtm',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-plan-requirements-output',level:5,title:'需求跟踪矩阵'},
      {id:'kp-pmp-rtm-bidirectional',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-rtm',level:6,title:'双向可追溯特点'},
      {id:'kp-pmp-predictive',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:'预测型方法'},
      {id:'kp-pmp-agile',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:'敏捷方法'},
      {id:'kp-pmp-hybrid',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:'混合型方法'}
    ]},
    {id:'taxonomy-cspm-main',subjectId:'subject-cspm',name:'CSPM 主知识树',version:1,maxDepth:9,nodes:[root('kp-cspm','taxonomy-cspm-main','CSPM')]},
    {id:'taxonomy-p2-main',subjectId:'subject-p2',name:'P2 / PRINCE2 主知识树',version:1,maxDepth:9,nodes:[root('kp-p2','taxonomy-p2-main','P2 / PRINCE2')]},
    {id:'taxonomy-acp-main',subjectId:'subject-acp',name:'ACP 主知识树',version:1,maxDepth:9,nodes:[root('kp-acp','taxonomy-acp-main','ACP')]},
    {id:'taxonomy-npdp-main',subjectId:'subject-npdp',name:'NPDP 主知识树',version:1,maxDepth:9,nodes:[root('kp-npdp','taxonomy-npdp-main','NPDP')]}
  ];
  function subjects(){
    if(global.KGLearningContent?.getSubjects)return global.KGLearningContent.getSubjects().map(item=>({id:item.id,code:item.code,name:item.name.zh,defaultTaxonomyId:item.defaultTaxonomyId}));
    const stored=readLocal('kg_content_subjects_v1');if(Array.isArray(stored)&&stored.length)return stored.map(item=>({id:clean(item.id),code:clean(item.code),name:clean(item.name?.zh||item.name||item.code),defaultTaxonomyId:clean(item.defaultTaxonomyId)}));
    return clone(SUBJECTS);
  }
  function taxonomies(subjectId){
    if(global.KGLearningContent?.getTaxonomies)return global.KGLearningContent.getTaxonomies(subjectId).map(item=>({id:item.id,subjectId:item.subjectId,name:item.name.zh,version:item.version,maxDepth:item.maxDepth,nodes:item.nodes.map(node=>({...node,title:node.title.zh}))}));
    const stored=readLocal('kg_content_taxonomies_v1');if(Array.isArray(stored)&&stored.length)return stored.filter(item=>!subjectId||item.subjectId===String(subjectId)).map(item=>({id:clean(item.id),subjectId:clean(item.subjectId),name:clean(item.name?.zh||item.name),version:Number(item.version)||1,maxDepth:Number(item.maxDepth)||9,nodes:(item.nodes||[]).map(node=>({...node,title:clean(node.title?.zh||node.title),titleEn:clean(node.title?.en),aliases:Array.isArray(node.aliases)?node.aliases:[],code:clean(node.code)}))}));
    return clone(TAXONOMIES.filter(item=>!subjectId||item.subjectId===String(subjectId)));
  }
  function taxonomy(taxonomyId){return taxonomies().find(item=>item.id===String(taxonomyId||''))||null}
  function defaultTaxonomy(subjectId){const subject=subjects().find(item=>item.id===String(subjectId||''));const list=taxonomies(subjectId);return list.find(item=>item.id===subject?.defaultTaxonomyId)||list[0]||null}
  function path(taxonomyId,nodeId){const t=taxonomy(taxonomyId);if(!t)return [];const map=new Map(t.nodes.map(node=>[node.id,node]));const result=[];let current=map.get(String(nodeId||''));const seen=new Set();while(current&&!seen.has(current.id)){seen.add(current.id);result.unshift(current);current=current.parentId?map.get(current.parentId):null}return clone(result)}
  function pathLabel(taxonomyId,nodeId){return path(taxonomyId,nodeId).map(node=>node.title).join(' > ')}
  function nodes(taxonomyId){const t=taxonomy(taxonomyId);return t?clone(t.nodes).sort((a,b)=>a.level-b.level||String(a.title).localeCompare(String(b.title),'zh-CN')):[]}
  function validMapping(subjectId,taxonomyId,nodeId){const t=taxonomy(taxonomyId);return !!(subjects().some(item=>item.id===subjectId)&&t&&t.subjectId===subjectId&&t.nodes.some(node=>node.id===nodeId)&&Number(t.maxDepth)<=MAX_DEPTH)}
  function search(taxonomyId,query){const q=clean(query).toLowerCase();if(!q)return nodes(taxonomyId);return nodes(taxonomyId).filter(node=>[node.id,node.title,node.titleEn,node.code,...(node.aliases||[]),pathLabel(taxonomyId,node.id)].join(' ').toLowerCase().includes(q))}
  function children(taxonomyId,parentId=null){return nodes(taxonomyId).filter(node=>(node.parentId||null)===(parentId||null)).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||String(a.title).localeCompare(String(b.title),'zh-CN'))}
  global.QuestionStudioKnowledgeTaxonomy=Object.freeze({MAX_DEPTH,subjects,taxonomies,taxonomy,defaultTaxonomy,nodes,path,pathLabel,validMapping,search,children,clean});
})(window);
