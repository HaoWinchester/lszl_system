const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function render(total, domains) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/113-practice-result-report.js'),'utf8'), {window});
  const root={classList:{add(){}},querySelector(){return null},querySelectorAll(){return []}};
  window.KGPracticeResultReport.render(root,{official:false,reportKind:'practice',counts:{total},domains,domainWeights:{people:42,process:50,'business-environment':8}});
  return root.innerHTML;
}
test('ordinary practice charts actual 2/3/5 counts instead of exam weights',()=>{
  const html=render(10,{people:{total:2},process:{total:3},'business-environment':{total:5}});
  assert.match(html,/人员 · 2 题 · 20%/);assert.match(html,/流程 · 3 题 · 30%/);assert.match(html,/商业环境 · 5 题 · 50%/);
  assert.match(html,/data-domain="people" data-count="2" data-ratio="0.2"/);
});
test('unlabelled questions are included and absent domains have no slice',()=>{
  const html=render(3,{people:{total:1}});
  assert.match(html,/未标注 · 2 题 · 66.67%/);assert.doesNotMatch(html,/data-domain="process"/);
  assert.match(html,/data-ratio="0.3333333333333333"/);
});
test('zero questions render an empty state without fabricated slices',()=>{
  const html=render(0,{});assert.match(html,/暂无题目领域分布/);assert.doesNotMatch(html,/practice-report-pie/);
});
