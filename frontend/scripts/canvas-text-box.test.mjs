import test from 'node:test';
import assert from 'node:assert/strict';
import {runNodeTestProcess} from './node-test-process.mjs';
import {fileURLToPath} from 'node:url';
test('shared text area geometry and asynchronous editing sessions',()=>{
 const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-text-box.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});

test('ink wire format normalization preserves text styles and bounded points',()=>{
 const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-ink.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});
