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
assert(script.includes("const SCHOLAR_MAX_SECONDS=60"));
assert(script.includes('state.experience+=10+bonus'));
assert(script.includes("CHECKPOINT_INTERVAL=5"));
assert(script.includes("showFeedback('错误 · -20 秒 · -1 ♥'"));
assert(script.includes("gainedSeconds?' · +'+gainedSeconds+' 秒'"));
assert(style.includes('.practice-game-topbar')&&style.includes('.practice-option.is-correct')&&style.includes('.practice-option.is-wrong'));
assert(style.includes('.practice-danger-vignette')&&style.includes('@keyframes practiceDangerBreath')&&style.includes('--practice-danger-strength'));
assert(script.includes('function dangerStrength()')&&script.includes('setDangerVignette(dangerStrength())'));
assert(script.includes('dom.streakPop.hidden=false')&&!script.includes('global.setTimeout(hideStreakPop,1600)'));
assert(script.includes('hideStreakPop();state.health=Math.max(0,state.health-1)'));
for(const file of ['index.html','question-workspace.html','knowledge-recall.html','question-training.html']){
  assert(!read(file).includes('practice-mode.html?from=learning-upgrade')&&!read(file).includes("location.replace('practice-mode.html')"),`${file} should retain its original page`);
}
const api=require(path.join(root,'src/100-practice-mode.js'));
assert.strictEqual(api.streakBonus(2),0);assert.strictEqual(api.streakBonus(3),2);assert.strictEqual(api.streakBonus(5),5);assert.strictEqual(api.streakBonus(8),10);
assert.strictEqual(api.formatDuration(65000),'01:05');
const release=api.resolveRelease({id:'release-1',paperId:'paper-1',version:2,status:'published',questions:[{bankId:'b1',questionId:'q1',order:1}],questionSnapshots:[{bankId:'b1',questionId:'q1',question:{id:'q1',stemParts:[{text:'题干'}],options:[{id:'A',text:'正确',correct:true},{id:'B',text:'错误'}],correctAnswer:'A'}}]});
assert.strictEqual(release.questions.length,1);assert.strictEqual(release.questions[0].correctAnswer,'A');
for(const id of ['practiceAnswerSheet','practiceAnswerSheetMobileBtn','practiceAnswerSheetDrawer','practiceSubmitConfirm','practiceSaveExitBtn','practiceAbandonBtn'])assert(practice.includes(`id="${id}"`),`missing ${id}`);
assert(practice.includes('src/111-practice-session-core.js'));
assert(practice.includes('src/112-practice-answer-sheet.js'));
assert(practice.includes('src/114-practice-draft-state.js'));

// ---- 本地即时判题与显式持久化契约（Task 5） ----
// 开始/恢复会话必须创建内存草稿控制器
assert(script.includes('KGPracticeDraftState?.create(')||script.includes('KGPracticeDraftState.create('), 'draft controller must be created');
assert(script.includes('state.draft=')||script.includes('createDraft('), 'draft controller helper must exist');
// 作答只走本地 draft.select，不再逐题请求
assert(script.includes('state.draft.select('), 'answering must go through draft.select');
assert(!script.includes('api.answerSession(')&&!script.includes('.answerSession('), 'per-question /answers route must be removed from answering flow');
assert(!script.includes('.updateState(')&&!script.includes('persistCurrentIndex'), 'navigation must not persist index/state writes');
assert(!script.includes('startAutosave')&&!script.includes('autosaveId'), 'short-interval autosave must be removed');
// 正常作答不写长期错题账本
assert(!script.includes('.answerRevenge('), 'revenge answers must stay local until submission');
assert(!script.includes('.upsertWrong('), 'mistake upserts must not fire during practice');
assert(!script.includes('recordMistake('), 'local timeout must not record mistakes over network');
// 显式保存与交卷载荷
assert(script.includes('function submissionPayload()'), 'explicit submission payload helper required');
assert(script.includes('api.pauseSession(')||script.includes('.pauseSession('), 'save-and-exit uses pauseSession');
assert(script.includes('.completeSession('), 'submit uses completeSession');
assert(script.includes('markSaved()'), 'successful save/submit clears dirty state');
assert(script.includes("event.returnValue=''"), 'beforeunload must expose native leave reminder');
// 复仇验证题派生不承诺"同知识点"
assert(!script.includes('同知识点验证题'), 'verification toast must not promise same-knowledge items');
assert(script.includes('当前没有可用的验证题'), 'neutral verification unavailable toast required');
// 无死代码：sessionAnswer 孤儿与 sessionWrite 残留必须清除
assert(!script.includes('function sessionAnswer('), 'unused sessionAnswer helper must be removed');
assert(!script.includes('state.sessionWrite'), 'orphaned sessionWrite queue references must be removed');
// 最后一题答完不自动交卷
assert(!script.includes('finishPractice:advanceAfterAnswer'), 'last question must not auto-submit via finish timer choice');
assert(script.includes('viewAnswers?.()')||script.includes('.viewAnswers()'), 'answer sheet renders from draft viewAnswers');

assert(script.includes('api.startSession('));
assert(script.includes('api.getActiveSessions('));
assert(script.includes('timedOut:true'));
assert(script.includes('state.session.runtimeState?.revengeState')||script.includes('state.revengeState'));
assert(script.includes('KGPracticeAnswerSheet.mount'));
assert(style.includes('.practice-answer-sheet'));
assert(style.includes('.practice-answer-sheet-drawer'));
assert(style.includes('@media (min-width:1024px)'));

// ---- 解析入口收口契约：挑战/学霸不再自动弹解析，看解析走答题卡 ----
// 挑战/学霸作答与超时后不得无条件自动渲染解析（autoExplain 旧开关路径已移除）
assert(!script.includes('autoExplainEnabled()renderPracticeExplanation')&&!script.includes('if(autoExplainEnabled())renderPracticeExplanation'), 'answering must not auto-render explanation via autoExplain switch');
assert(!script.includes('renderPracticeExplanation(question,false);renderAnswerSheet()'), 'scholar timeout must not auto-render explanation');
// 导航行不再保留"自动解析"开关 DOM
assert(!practice.includes('practiceAutoExplain'), 'auto-explain toggle must be removed from nav row');
assert(!style.includes('.practice-explanation-toggle'), 'auto-explain toggle styles must be removed');
// 解析入口收口：答题卡跳已答题展开；其他切题路径给"查看解析"按钮
assert(script.includes('explanationRevealRequested'), 'answer-sheet navigation must set explanation reveal marker');
assert(script.includes('查看解析'), 'manual reveal button required for answered questions');
console.log('v90-p40-practice-mode-static-ok');
