'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');

require(path.resolve(__dirname, '../src/98-teacher-workflow-p2-services.js'));
const Parser = global.KGTeacherWorkflowP2;

test('plain-text import preserves multiple-choice answer arrays and analysis', () => {
  const parsed = Parser.parseQuestion(`题型：多选题
以下哪些做法正确？
A. 先识别风险
B. 跳过评估
C. 记录应对措施
D. 隐瞒风险
答案：A，C
解析：A、C 构成完整的风险处理动作。`);

  assert.equal(parsed.type, 'multiple_choice');
  assert.deepEqual(parsed.correctOptionIds, ['A', 'C']);
  assert.equal(parsed.answer, 'A,C');
  assert.equal(parsed.analysis, 'A、C 构成完整的风险处理动作。');
  assert.deepEqual(parsed.errors, []);
});

test('multiple-choice import rejects fewer than two correct choices', () => {
  const parsed = Parser.parseQuestion(`题型：多选题
以下哪些做法正确？
A. 识别风险
B. 跳过评估
C. 记录风险
答案：A
解析：示例。`);
  assert.match(parsed.errors.join('\n'), /至少.*2.*正确/);
});

test('structured multiple-choice import accepts A-H options', () => {
  const parsed = Parser.parseQuestion(`【题型】
多选题
【题干-中文】
请选择正确做法。
【A-中文】
做法 A
【B-中文】
做法 B
【C-中文】
做法 C
【D-中文】
做法 D
【E-中文】
做法 E
【F-中文】
做法 F
【答案】
A，E
【解析-中文】
A、E 正确。`);

  assert.deepEqual(parsed.options.map(item => item.id), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(parsed.correctOptionIds, ['A', 'E']);
  assert.equal(parsed.analysis, 'A、E 正确。');
  assert.deepEqual(parsed.errors, []);
});

test('downloaded JSON template includes a multiple-choice analysis field', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/65-question-bank-admin.js'), 'utf8');
  assert.match(source, /function multipleChoiceTemplateQuestion\(\)/);
  assert.match(source, /correctOptionIds:\['A','C'\]/);
  assert.match(source, /analysis:'A、C/);
});
