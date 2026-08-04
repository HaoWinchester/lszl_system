'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const practice=read('practice-mode.html'),script=read('src/100-practice-mode.js'),style=read('styles/practice-mode.css');
for(const count of [10,20,60,180])assert(practice.includes(`value="${count}"`),`missing count ${count}`);
assert(practice.includes('data-practice-start="challenge"'));
assert(practice.includes('data-practice-start="scholar"'));
assert(practice.includes('class="practice-mode-switch"')&&practice.includes('href="index.html"'));
assert(!practice.includes('只读取教师已经发布的固定版本。练习不会修改题目或试卷。'));
assert(!practice.includes('practiceScholarStreak'));
assert(practice.includes('class="practice-time-icon"'));
assert(practice.includes('practiceDangerVignette'));
assert(practice.includes('practiceCheckpointStreak')&&practice.includes('practiceCheckpointExperience')&&practice.includes('practiceCheckpointDuration'));
assert(!practice.includes('题目导航'));
assert(script.includes("const SCHOLAR_MAX_SECONDS=80"));
assert(script.includes('state.experience+=10+bonus'));
assert(script.includes("CHECKPOINT_INTERVAL=5"));
assert(script.includes("showFeedback('错误 · -20 秒 · -1 ♥'"));
assert(script.includes("showFeedback('正确'+(state.mode==='scholar'?' · +20 秒':'')"));
assert(script.includes("saveRecord('abandoned')"));
assert(style.includes('.practice-game-topbar')&&style.includes('.practice-option.is-correct')&&style.includes('.practice-option.is-wrong'));
assert(style.includes('.practice-danger-vignette')&&style.includes('@keyframes practiceDangerBreath')&&style.includes('--practice-danger-strength'));
assert(script.includes('function dangerStrength()')&&script.includes('setDangerVignette(dangerStrength())'));
assert(script.includes('dom.streakPop.hidden=false')&&!script.includes('global.setTimeout(hideStreakPop,1600)'));
assert(script.includes('hideStreakPop();state.health=Math.max(0,state.health-1)'));
for(const file of ['learning-path.html','guided-learning-node.html','guided-learning-placement-test.html']){
  assert(read(file).includes('practice-mode.html?from=learning-upgrade'),`${file} not gated`);
}
for(const file of ['index.html','question-workspace.html','knowledge-recall.html','question-training.html']){
  assert(!read(file).includes('practice-mode.html?from=learning-upgrade')&&!read(file).includes("location.replace('practice-mode.html')"),`${file} should retain its original page`);
}
assert(read('index.html').includes('>做题模式</a>'));
const api=require(path.join(root,'src/100-practice-mode.js'));
assert.strictEqual(api.streakBonus(2),0);assert.strictEqual(api.streakBonus(3),2);assert.strictEqual(api.streakBonus(5),5);assert.strictEqual(api.streakBonus(8),10);
assert.strictEqual(api.formatDuration(65000),'01:05');
const release=api.resolveRelease({id:'release-1',paperId:'paper-1',version:2,status:'published',questions:[{bankId:'b1',questionId:'q1',order:1}],questionSnapshots:[{bankId:'b1',questionId:'q1',question:{id:'q1',stemParts:[{text:'题干'}],options:[{id:'A',text:'正确',correct:true},{id:'B',text:'错误'}],correctAnswer:'A'}}]});
assert.strictEqual(release.questions.length,1);assert.strictEqual(release.questions[0].correctAnswer,'A');
console.log('v90-p40-practice-mode-static-ok');
