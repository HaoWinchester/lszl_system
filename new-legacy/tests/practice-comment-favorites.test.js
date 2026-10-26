const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(payload={comments:[]}){
 const calls=[],window={KGAuthCore:{currentUser:()=>({username:'alice'})},addEventListener(){},KGQuestionComments:{listFavorites:async()=>payload}};
 const document={addEventListener(){},dispatchEvent(){},querySelectorAll(){return []}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/120-question-favorites.js'),'utf8'),{window,document,URLSearchParams,fetch:async(url,options)=>{calls.push([url,options]);return {ok:true,status:200,json:async()=>payload}}});
 return {api:window.KGQuestionFavorites,calls,window};
}
test('comment category renders API comments and original question actions',async()=>{
 const {api}=setup({comments:[{id:'c1',questionId:'q1',content:'我的评论',questionTitle:'原题'}]});
 const list={addEventListener(){},innerHTML:''},empty={},summary={};
 await api.renderList(list,empty,summary,{kind:'comments'});
 assert.match(list.innerHTML,/我的评论/);assert.match(list.innerHTML,/原题/);assert.match(list.innerHTML,/data-comment-favorite-open="c1"/);assert.equal(empty.hidden,true);
});
test('comment empty state and retryable request failure are explicit',async()=>{
 const {api,window}=setup();const list={addEventListener(){}},empty={},summary={};
 await api.renderList(list,empty,summary,{kind:'comments'});assert.match(empty.textContent,/还没有收藏的评论/);
 window.KGQuestionComments.listFavorites=async()=>{throw Error('请求失败')};
 await assert.rejects(api.renderList(list,empty,summary,{kind:'comments'}));
 window.KGQuestionComments.listFavorites=async()=>({comments:[{id:'c2',content:'恢复'}]});
 await api.renderList(list,empty,summary,{kind:'comments'});assert.match(list.innerHTML,/恢复/);
});
test('shared comment API checks account boundary and uses existing list/remove routes',async()=>{
 let owner='alice';const calls=[];let resolve;
 const window={KGAuthCore:{currentUser:()=>({username:owner})},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/119-question-comments.js'),'utf8'),{window,document:{body:{},addEventListener(){},dispatchEvent(){}},MutationObserver:class{observe(){}},URLSearchParams,fetch:async(url,options)=>{calls.push([url,options]);return {ok:true,status:200,json:async()=>({comments:[]})}}});
 await window.KGQuestionComments.listFavorites('next');assert.match(calls[0][0],/question-comments\/favorites\?cursor=next/);
 await window.KGQuestionComments.removeFavorite({questionId:'q1',id:'c1'});assert.equal(calls[1][1].method,'DELETE');
 const pending=window.KGQuestionComments.listFavorites();owner='bob';await assert.rejects(pending,/UNAUTHENTICATED/);
});
