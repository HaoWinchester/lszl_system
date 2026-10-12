import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('shared text area geometry and asynchronous editing sessions',()=>{
 const result=spawnSync(process.execPath,['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-text-box.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});

test('ink wire format normalization preserves text styles and bounded points',()=>{
 const result=spawnSync(process.execPath,['--test',fileURLToPath(new URL('../../new-legacy/tests/canvas-ink.test.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});
