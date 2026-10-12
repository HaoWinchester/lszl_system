import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
test('versioned graph template center',()=>{const result=spawnSync(process.execPath,['--test',fileURLToPath(new URL('../../new-legacy/tests/graph-template-center.test.js',import.meta.url))],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+'\n'+result.stderr)});
