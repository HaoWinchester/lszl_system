import test from 'node:test';
import assert from 'node:assert/strict';
import {runNodeTestProcess} from './node-test-process.mjs';
import {fileURLToPath} from 'node:url';
test('shared TableV1 model: normalize, merge, split, paste and limits',()=>{
 const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-table-model.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});

test('spreadsheet clipboard: TSV quoting and Excel sample parity',()=>{
 const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-table-clipboard.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});

test('table persistence adapters: sanitizeCollection, store and recall adapter',()=>{
 const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-table-adapters.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});

test('table UI controller: selection/scaling pure logic and three-page registration',()=>{
 const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-table-ui.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});
