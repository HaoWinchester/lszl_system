const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
  const c={KGActivitySchemaV1:{normalizeStudentLanguageMode:v=>v,getLanguageMode:()=>'zh'},console};
  c.window=c;c.globalThis=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src','86-free-mode-language.js'),'utf8'),c);
  return c.KGFreeModeLanguage;
}
test('stripSourceNotes removes inline source note with URL from analysis',()=>{
  const KG=setup();
  const analysis='通过协作制定章程，包括愿景板、电梯演讲和工作协议，可以从第一天起建立共同愿景。 来源: PMP 2026 Study Hub https://github.com/Sviless/pmp-2026-study-hub/blob/501eb3426d243e40bec08a08ebd84b413bc076cb/js/data/questions-people.js#L56';
  const out=KG.stripSourceNotes(analysis);
  assert.match(out,/通过协作制定章程/);
  assert.doesNotMatch(out,/来源|PMP 2026 Study Hub|github\.com/);
});
test('stripSourceNotes removes standalone 来源/Source lines and keeps body text',()=>{
  const KG=setup();
  const analysis='关键路径上的活动延迟会直接推迟项目完成日期。\n来源：PMP 题库 v3\nCollaborative chartering builds a shared vision.\nSource: https://example.com/list';
  const out=KG.stripSourceNotes(analysis);
  assert.match(out,/关键路径上的活动延迟/);
  assert.match(out,/Collaborative chartering/);
  assert.doesNotMatch(out,/来源|Source|example\.com/);
});
test('stripSourceNotes keeps body text that merely mentions 来源 without a link',()=>{
  const KG=setup();
  const analysis='评估需求来源的可靠性，再决定变更流程。';
  assert.equal(KG.stripSourceNotes(analysis),analysis);
});
test('questionView applies stripSourceNotes to zh and en explanations',()=>{
  const KG=setup();
  const view=KG.questionView({analysis:'共同愿景来自协作章程。 来源: Study Hub https://x.example/a#L1',translations:{en:{analysis:'Shared vision. Source: https://x.example/b#L2'}}},'zh');
  assert.equal(view.explanation.zh,'共同愿景来自协作章程。');
  assert.equal(view.explanation.en,'Shared vision.');
  assert.equal(KG.questionView({analysis:'正文不变。'},'zh').explanation.zh,'正文不变。');
});
