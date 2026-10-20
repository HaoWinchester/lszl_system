import {runNodeTestProcess} from './node-test-process.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
for(const name of ['practice-own-selection','learning-theme-owner','dialog-migrations']){
 test(`interaction feedback: ${name}`,()=>{
  const result=runNodeTestProcess(['--test',fileURLToPath(new URL(`../../new-legacy/tests/${name}.test.js`,import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 });
}
