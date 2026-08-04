'use strict';
const path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const rows=[
 {id:'release-old',releaseId:'release-old',paperId:'paper-1',version:1,status:'published',publishedAt:10,name:'旧版',enabledModes:['deep_recall'],questions:[],questionSnapshots:[]},
 {id:'release-new',releaseId:'release-new',paperId:'paper-1',version:2,status:'published',publishedAt:20,name:'新版',enabledModes:['deep_recall'],questions:[],questionSnapshots:[]},
 {id:'release-draft',releaseId:'release-draft',paperId:'paper-2',version:1,status:'draft',name:'草稿',questions:[],questionSnapshots:[]}
];
global.localStorage={getItem:key=>key==='kg_exam_papers_published_v1'?JSON.stringify(rows):null};
delete global.KGPublishedPaperRepository;
const modulePath=path.join(root,'src/59-published-paper-repository.js');delete require.cache[require.resolve(modulePath)];
const repo=require(modulePath);
assert.equal(repo.getPublishedPaper('paper-1').releaseId,'release-new');
assert.equal(repo.listReleases().some(item=>item.releaseId==='release-draft'),false);
console.log('v90-p41-p403-bugfix-ok');
