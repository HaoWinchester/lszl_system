'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/100-practice-mode.js'), 'utf8');
const start = source.indexOf('  function navigateToQuestionId(');
const end = source.indexOf('  function renderFrozenReport(', start);
const state = { active: true, questions: [{id:'q1'},{id:'q2'},{id:'q3'}], index:0, feedbackTimer:17 };
const timers = new Map([[17, () => { state.index++; }]]);
const context = vm.createContext({state, dom:{feedback:{}}, text:String, shouldAutoComplete:()=>false,
  hideRemediation(){}, clearVerification(){}, renderQuestion(){},
  global:{clearTimeout:id=>timers.delete(id)},
});
vm.runInContext(source.slice(start,end),context);
assert.equal(context.navigateToQuestionId('q2'), true);
for(const callback of timers.values()) callback();
assert.equal(state.index, 1, 'explicit question navigation cancels the delayed answer advance');
assert.equal(state.feedbackTimer, 0);
console.log('practice-navigation-timer-ok');
