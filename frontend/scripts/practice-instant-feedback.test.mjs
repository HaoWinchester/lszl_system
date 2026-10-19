import {runNodeTestProcess} from './node-test-process.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
test('ordinary practice feedback policy and answer-sheet neutral rendering',()=>{
  const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/practice-instant-feedback.test.js',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
