'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

assert.equal(read('VERSION').trim(),'v9.0-p4.1.1');
const training=read('question-training.html');
const workspace=read('question-workspace.html');
const recall=read('knowledge-recall.html');
for(const source of [training,workspace,recall])assert(source.includes('src/59-published-paper-repository.js'));
assert(!training.includes("location.replace('practice-mode.html"));
assert(recall.includes('href="index.html" id="krBackBtn"'));
assert(recall.includes('aria-label="选择已发布试卷"'));

const source=read('src/96-recall-question-source.js');
assert(source.includes("mode:'deep_recall'"));
assert(source.includes('只读取不可变发布版本'));
assert(!source.includes('kg_question_banks_v1__'));
assert(!source.includes('kg_question_banks_published_v1'));
assert(!source.includes('demoBank'));

const multi=read('src/77-multi-question-workspace.js');
assert(multi.includes("repository.listPublishedPapers({respectRole:true,mode:'multi_question_canvas'})"));
assert(multi.includes("url.searchParams.set('releaseId'"));
const single=read('src/72-question-training-page.js');
assert(single.includes("mode:'single_deep_study'"));
assert(single.includes('ensureSingleDeepPublishedSelection'));
assert(single.includes("params.get('releaseId')"));
const navigator=read('src/66-question-navigator.js');
assert(navigator.includes("params.get('releaseId')"));
assert(navigator.includes("sourceReleaseId:String(item.paper?.releaseId"));

const toolbar=read('src/19-home-toolbar-registry.js');
const graph=read('src/10-graph-editor.js');
assert(toolbar.includes('hideTransientMenus:()=>closeFloatingSubmenus()'));
assert(graph.includes('function hideGraphTransientMenus()'));
assert(graph.includes('if(panRequested)hideGraphTransientMenus()'));
assert(graph.includes("stage.addEventListener('wheel',e=>{\n  if(isTextEditingTarget(e.target))return;\n  hideGraphTransientMenus();"));

const storage={
  value:JSON.stringify([
    {
      id:'release-2',paperId:'paper-1',version:2,name:'统一发布试卷',status:'published',
      enabledModes:['deep_recall','multi_question_canvas','single_deep_study'],
      questions:[
        {bankId:'bank-a',questionId:'q-1',order:2},
        {bankId:'bank-a',questionId:'q-2',order:1}
      ],
      questionSnapshots:[
        {bankId:'bank-a',bankName:'来源题库',questionId:'q-1',question:{id:'q-1',title:'冻结题目',stemParts:[{text:'冻结题干'}],options:[]}}
      ]
    },
    {
      id:'release-other',paperId:'paper-other',version:1,name:'仅做题',status:'published',
      enabledModes:['practice'],questions:[],questionSnapshots:[]
    }
  ]),
  getItem(key){return key==='kg_exam_papers_published_v1'?this.value:''}
};
global.localStorage=storage;
delete global.KGPublishedPaperRepository;
const modulePath=path.join(root,'src/59-published-paper-repository.js');
delete require.cache[require.resolve(modulePath)];
const repository=require(modulePath);
const rows=repository.listPublishedPapers({mode:'deep_recall',respectRole:false});
assert.equal(rows.length,1);
assert.equal(rows[0].paper.releaseId,'release-2');
assert.equal(rows[0].configuredCount,2);
assert.equal(rows[0].availableCount,1);
assert.equal(rows[0].missingCount,1);
assert.equal(rows[0].items[0].question.title,'冻结题目');
assert.equal(rows[0].items[0].question.sourceReleaseId,'release-2');
assert.equal(repository.findQuestion({releaseId:'release-2',questionId:'q-1'},{respectRole:false}).question.title,'冻结题目');
assert.equal(repository.findQuestion({releaseId:'release-2',questionId:'q-2'},{respectRole:false}),null);
const collections=repository.listCollections({mode:'deep_recall',respectRole:false});
assert.equal(collections[0].id,'paper-release:release-2');
assert.equal(collections[0].questions.length,1);
console.log('v90-p403-published-paper-learning-pages-ok');
