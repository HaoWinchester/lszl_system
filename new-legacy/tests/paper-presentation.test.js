const assert=require('node:assert/strict');
const presentation=require('../src/paper-presentation.js');
const now=Date.UTC(2026,8,6,12),day=86400000;
for(const publishedAt of [now,now-day,now-3*day+1])assert.equal(presentation.isRecentPublication({publishedAt},now),true);
for(const publishedAt of [0,null,undefined,'bad',now+1,now-3*day,now-4*day])assert.equal(presentation.isRecentPublication({publishedAt},now),false);
assert.equal(presentation.isRecentPublication({publishedAt:String(now)},now),true);
console.log('paper-presentation-ok');

const fs=require('node:fs'),path=require('node:path');
const controller=fs.readFileSync(path.join(__dirname,'../src/100-practice-mode.js'),'utf8');
const vm=require('node:vm');
const context={global:{KGPaperPresentation:presentation},state:{selectedPaperId:''},paperAccess:()=>({allowed:true}),escapeHTML:String,vipBadge:()=>'',Number};
vm.createContext(context);
vm.runInContext(controller.slice(controller.indexOf('  function paperCardMarkup('),controller.indexOf('  function syncSelectedPaperCards(')),context);
assert.match(context.paperCardMarkup({id:'new',publishedAt:Date.now(),name:'新卷'}),/practice-paper-latest/);
assert.doesNotMatch(context.paperCardMarkup({id:'old',publishedAt:Date.now()-4*day,name:'旧卷'}),/practice-paper-latest/);

const prompts=[];
global.KGAuthCore={currentUser:()=>null};
global.KGSharedAuthDialog={open:message=>prompts.push(message)};
require('../src/100-practice-mode.js');
Promise.all(['challenge','scholar','revenge'].map(mode=>global.KGPracticeMode.startPractice(mode))).then(results=>{
  assert.deepEqual(results,[false,false,false]);
  assert.equal(prompts.length,3);
  assert(prompts.every(message=>message.includes('登录')));
});
