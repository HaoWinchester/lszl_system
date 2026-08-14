'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadSchedule(role = 'student') {
  const context = {
    window: {
      KGRolePermissions: { currentRole: () => role },
      document: { readyState: 'complete' },
      setInterval: () => 1,
      clearInterval: () => {},
    },
  };
  context.global = context.window;
  vm.runInNewContext(read('src/31a-learning-weekly-open-schedule.js'), context);
  return context.window.KGLearningWeeklyOpen;
}

const schedule = loadSchedule();
const openAt = new Date(2026, 7, 17, 14, 0, 0, 0);
const beforeOpen = new Date(2026, 7, 17, 13, 30, 0, 0);
const afterOpen = new Date(2026, 7, 17, 14, 30, 0, 0);
const muchLater = new Date(2026, 8, 1, 10, 0, 0, 0);

assert.equal(schedule.OPEN_AT_MS, openAt.getTime());
assert.equal(schedule.isOpen(beforeOpen.getTime()), false, 'Before Aug 17 14:00 should stay closed');
assert.equal(schedule.isOpen(afterOpen.getTime()), true, 'After Aug 17 14:00 should open');
assert.equal(schedule.isOpen(muchLater.getTime()), true, 'After launch should stay open permanently');
assert.equal(schedule.nextOpenAt(beforeOpen.getTime()).getTime(), openAt.getTime());
assert.match(schedule.countdownLabel(beforeOpen.getTime()), /8月17日（周日）14:00 开放 · 倒计时/);
assert.equal(schedule.countdownLabel(afterOpen.getTime()), '');
assert.equal(schedule.isDestinationOpen('index.html', beforeOpen.getTime()), true);
assert.equal(schedule.isDestinationOpen('knowledge-recall.html', beforeOpen.getTime()), false);
assert.equal(schedule.isDestinationOpen('question-workspace.html', beforeOpen.getTime()), false);
assert.equal(schedule.isDestinationOpen('practice-mode.html', beforeOpen.getTime()), false);
assert.equal(schedule.isDestinationOpen('knowledge-recall.html', afterOpen.getTime()), true);

const teacher = loadSchedule('teacher');
assert.equal(teacher.isOpen(beforeOpen.getTime()), true, 'Teacher should bypass schedule');

assert.match(read('src/31-learning-entry-chooser.js'), /KGLearningWeeklyOpen\.isDestinationOpen/);
assert.match(read('index.html'), /31a-learning-weekly-open-schedule\.js/);
assert.match(read('knowledge-recall.html'), /31a-learning-weekly-open-schedule\.js/);
assert.match(read('question-workspace.html'), /31a-learning-weekly-open-schedule\.js/);
assert.match(read('practice-mode.html'), /31a-learning-weekly-open-schedule\.js/);

console.log('learning-weekly-open-schedule-ok');
