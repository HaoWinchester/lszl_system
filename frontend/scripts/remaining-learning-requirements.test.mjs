import {runNodeTestProcess} from './node-test-process.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

for (const file of ['practice-sound', 'knowledge-space-scene', 'knowledge-dashboard']) {
  test(`remaining learning: ${file}`, () => {
    const result = runNodeTestProcess(['--test', fileURLToPath(new URL(`../../new-legacy/tests/${file}.test.js`, import.meta.url))], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  });
}

const read=file=>readFileSync(new URL(`../../new-legacy/${file}`,import.meta.url),'utf8');
test('recall utility actions use compact icons and a search magnifier',()=>{
const js=read('src/86-knowledge-recall.js');
assert(js.includes("[$('krNodeSearchBtn'),'search','搜索']"),'knowledge search must use the shared magnifier');
for(const label of ['绘制','视图'])assert(new RegExp("ui\\.group\\(tools,'"+label+"',[^\\n]+\\{iconOnly:true\\}\\)").test(js),label+' toolbar must use icons with accessible names');
const toolbar=read('src/canvas/toolbar.js');
assert(/search:'[^']*[aA][^']*'/.test(toolbar),'shared search icon must contain a circular lens');
});
