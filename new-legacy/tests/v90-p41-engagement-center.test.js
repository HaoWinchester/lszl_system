'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
assert.equal(read('VERSION').trim(),'v9.0-p4.1.1');
const index=read('index.html');
assert(index.includes('id="supportCenterBtn"'));
assert(index.includes('id="supportCenterBadge"'));
assert(index.includes('id="supportFeedbackMenuBadge"'));
assert(index.includes('src/101-engagement-repository.js'));
assert(index.includes('src/103-support-center.js'));
assert(index.includes('styles/support-center.css'));
const supportJs=read('src/103-support-center.js');
assert(supportJs.includes('class="engagement-close"'));
assert(supportJs.includes('M6 6l12 12M18 6 6 18'));
assert(supportJs.includes('unreadSummary'));
assert(read('styles/support-center.css').includes('.support-center-trigger,\n.engagement-close'));
assert(read('help-center.html').includes('id="helpContent"'));
assert(read('feedback-management.html').includes('data-admin-page="feedback"'));
assert(read('message-management.html').includes('data-admin-page="messages"'));
assert(read('admin-console.html').includes('feedback-management.html'));
assert(read('admin-console.html').includes('message-management.html'));
assert(read('src/01-runtime-config.js').includes("markFeedbackRead:'/api/feedback/{id}/read'"));
assert(read('SERVER_ENGAGEMENT_API_V1.md').includes('POST /api/feedback/:id/read'));

const storage=new Map();
global.localStorage={
  getItem:key=>storage.has(key)?storage.get(key):null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:key=>storage.delete(key),
  key:index=>[...storage.keys()][index]||null,
  get length(){return storage.size}
};
global.KG_APP_CONFIG={engagement:{mode:'local-demo'}};
let currentUser={username:'alice',displayName:'Alice',role:'student'};
global.KGAuthCore={currentUser:()=>currentUser};
delete global.KGEngagementRepository;
const modulePath=path.join(root,'src/101-engagement-repository.js');
delete require.cache[require.resolve(modulePath)];
const repo=require(modulePath);
(async()=>{
  const feedback=await repo.submitFeedback({type:'bug',title:'测试问题',detail:'详细描述',page:'index.html'});
  assert.equal(feedback.status,'pending');
  assert.equal(feedback.submittedBy.username,'alice');
  assert.equal((await repo.listMyFeedback()).length,1);
  assert.deepEqual(await repo.unreadSummary(),{messages:0,feedbackReplies:0,total:0});

  currentUser={username:'admin',displayName:'管理员',role:'admin'};
  await repo.updateFeedback(feedback.id,{status:'resolved'});
  await repo.replyFeedback(feedback.id,'已经修复');
  const resolved=(await repo.listFeedback())[0];
  assert.equal(resolved.status,'resolved');
  assert.equal(resolved.replies[0].message,'已经修复');

  currentUser={username:'alice',displayName:'Alice',role:'student'};
  const mine=(await repo.listMyFeedback())[0];
  assert.equal(mine.unreadReplyCount,1);
  assert.equal(await repo.unreadFeedbackReplyCount(),1);
  assert.deepEqual(await repo.unreadSummary(),{messages:0,feedbackReplies:1,total:1});
  await repo.markFeedbackRead(feedback.id);
  assert.equal((await repo.listMyFeedback())[0].unreadReplyCount,0);

  let message=await repo.saveAnnouncement({title:'系统通知',body:'欢迎使用',audience:{type:'roles',roles:['student']}});
  message=await repo.publishAnnouncement(message.id,{publishAt:Date.now()-1000});
  assert.equal((await repo.listUserMessages()).length,1);
  assert.equal(await repo.unreadCount(),1);
  assert.deepEqual(await repo.unreadSummary(),{messages:1,feedbackReplies:0,total:1});
  await repo.markMessageRead(message.id);
  assert.equal(await repo.unreadCount(),0);

  let hidden=await repo.saveAnnouncement({title:'管理员通知',body:'仅管理员',audience:{type:'roles',roles:['admin']}});
  await repo.publishAnnouncement(hidden.id,{publishAt:Date.now()-1000});
  assert.equal((await repo.listUserMessages()).length,1);

  let future=await repo.saveAnnouncement({title:'未来通知',body:'稍后显示',audience:{type:'all'}});
  await repo.publishAnnouncement(future.id,{publishAt:Date.now()+60000});
  assert.equal((await repo.listUserMessages()).length,1);
  console.log('v90-p41-engagement-center-ok');
})().catch(error=>{console.error(error);process.exit(1)});
