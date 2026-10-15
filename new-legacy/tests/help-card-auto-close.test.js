'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('help card auto-closes after 10 seconds; manual close cancels; tour defers',()=>{
  const source=read('src/20-flashcards-toolbar.js');
  assert.match(source,/helpAutoCloseTimer=setTimeout\(function helpAutoCloseTick\(\)\{/,);
  assert.match(source,/if\(help\.classList\.contains\('guided-tour-temporary-hidden'\)\|\|document\.body\.classList\.contains\('guided-tour-active'\)\)\{helpAutoCloseTimer=setTimeout\(helpAutoCloseTick,10000\);return\}/);
  assert.match(source,/\$\('hideHelpBtn'\)\.onclick=\(\)=>\{clearHelpAutoClose\(\);\$\('helpCard'\)\.classList\.add\('hide'\)\}/);
  assert.match(source,/\},10000\);/);
});
