import {runNodeTestProcess} from './node-test-process.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
test('card question drawer shared media and homepage integration',()=>{const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/graph-question-drawer.test.js',import.meta.url))],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);});
