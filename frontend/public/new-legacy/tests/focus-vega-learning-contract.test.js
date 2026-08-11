'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const pages=[
  'learning-path.html',
  'guided-learning-node.html',
  'guided-learning-placement-test.html',
  'question-training.html',
  'question-workspace.html',
  'knowledge-recall.html',
];
const iconAdapter='src/109-focus-vega-ui-icons.js';
const anchors={
  'learning-path.html':['gl-app','gl-topbar','gl-main'],
  'guided-learning-node.html':['guided-node-page','gln-topbar','gln-main','gln-action-bar'],
  'guided-learning-placement-test.html':['guided-placement-page','glp-topbar','glp-main','glp-action-bar'],
  'question-training.html':['question-training-app','qt-topbar','q-tabs','qt-canvas-shell'],
  'question-workspace.html':['qw-app','qw-topbar','qw-workspace-tabbar','qw-canvas-shell'],
  'knowledge-recall.html':['kr-app','kr-topbar','kr-viewport'],
};
const scriptDigests={
  'learning-path.html':'bc7fe0f47cb727ddb16782e52c0c116a1c0e4568935333b86d6e0f5b8ea79aa5',
  'guided-learning-node.html':'c8285eb6e1999a606b6661d9b0058299f3a927843819ead460375e75e775b28b',
  'guided-learning-placement-test.html':'19cd280e236d9ae06f72e76996b0ea79988a9f362bd80d0d5f2477820b653e02',
  'question-training.html':'551307bc342f83229b5af778e8622a216d75b03e6f0d09aade390a5ddc23f06c',
  'question-workspace.html':'bdc891115c993b3fe1864839f83130fd9b9f4e06628da08bcea9243c49bf0ff9',
  'knowledge-recall.html':'f67c945a21acee7fa62f848cd69938385d2f9856cf1feaab1cd6ec6a88fcc769',
};
const inlineScriptDigests={
  'learning-path.html':[],
  'guided-learning-node.html':[],
  'guided-learning-placement-test.html':[],
  'question-training.html':['766f0ed03782cb7eb745dc855278b29ad6cafcf80fe865e69d00fe18a6fddbb0'],
  'question-workspace.html':[],
  'knowledge-recall.html':[],
};

function stylesheetHrefs(html){
  return [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)]
    .map(match=>/\bhref=["']([^"']+)["']/i.exec(match[0])?.[1])
    .filter(Boolean);
}

function scriptSrcs(html){
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi)]
    .map(match=>match[1]);
}

function inlineDigests(html){
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match=>crypto.createHash('sha256').update(match[1]).digest('hex'));
}

function classTokenCount(html,className){
  if(className.endsWith('-page')){
    const body=/<body\b[^>]*\bclass=["']([^"']+)["']/i.exec(html);
    return body&&body[1].split(/\s+/).includes(className)?1:0;
  }
  return [...html.matchAll(/\bclass=["']([^"']+)["']/gi)]
    .filter(match=>match[1].split(/\s+/).includes(className)).length;
}

function digest(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function splitSelectorList(prelude){
  const result=[];
  let start=0,round=0,square=0;
  for(let index=0;index<prelude.length;index+=1){
    const char=prelude[index];
    if(char==='(')round+=1;
    else if(char===')')round-=1;
    else if(char==='[')square+=1;
    else if(char===']')square-=1;
    else if(char===','&&round===0&&square===0){
      result.push(prelude.slice(start,index).trim());
      start=index+1;
    }
  }
  result.push(prelude.slice(start).trim());
  return result.filter(Boolean);
}

function assertScopedPcCss(source){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'');
  function walk(block,insidePcMedia=false){
    let cursor=0;
    while(cursor<block.length){
      while(/\s/.test(block[cursor]||''))cursor+=1;
      if(cursor>=block.length)return;
      const open=block.indexOf('{',cursor);
      assert.notEqual(open,-1,'missing CSS block');
      const prelude=block.slice(cursor,open).trim();
      let depth=1,close=open+1;
      while(close<block.length&&depth){
        if(block[close]==='{')depth+=1;
        else if(block[close]==='}')depth-=1;
        close+=1;
      }
      assert.equal(depth,0,`unbalanced CSS block ${prelude}`);
      const body=block.slice(open+1,close-1);
      if(prelude.startsWith('@')){
        const media=prelude.match(/^@media\s*\(min-width\s*:\s*(\d+)px\)$/);
        assert.ok(media,`unsupported responsive rule: ${prelude}`);
        assert.ok(Number(media[1])>=901,`mobile rule is outside approved scope: ${prelude}`);
        walk(body,true);
      }else{
        assert.equal(insidePcMedia,true,`selector outside PC scope: ${prelude}`);
        for(const selector of splitSelectorList(prelude)){
          assert.match(selector,/^body\[data-ui-skin=["']focus-vega["']\]/,`unscoped: ${selector}`);
        }
        assert.equal(body.includes('{'),false,`nested declaration: ${prelude}`);
      }
      cursor=close;
    }
  }
  walk(clean);
}

test('six learning pages opt into typography and the final learning adapter',()=>{
  for(const file of pages){
    const html=read(file);
    assert.match(html,/<body\b[^>]*data-ui-skin=["']focus-vega["']/i,file);
    assert.deepEqual(
      stylesheetHrefs(html).slice(-2),
      ['styles/focus-vega-typography.css','styles/focus-vega-learning.css'],
      `${file}: final stylesheet order`,
    );
  }
});

test('learning opt-in preserves script order, inline behavior, and layout anchors',()=>{
  for(const file of pages){
    const html=read(file);
    assert.equal(digest(scriptSrcs(html).filter(source=>source!==iconAdapter)),scriptDigests[file],`${file}: business scripts changed`);
    assert.equal(scriptSrcs(html).filter(source=>source===iconAdapter).length,1,`${file}: icon adapter count`);
    assert.equal(scriptSrcs(html).at(-1),iconAdapter,`${file}: icon adapter must load last`);
    assert.match(html,/data-ui-icon=["'][^"']+["']/,`${file}: declarative icon slot missing`);
    assert.deepEqual(inlineDigests(html),inlineScriptDigests[file],`${file}: inline behavior changed`);
    for(const anchor of anchors[file]){
      assert.equal(classTokenCount(html,anchor),1,`${file}: expected one native .${anchor}`);
    }
  }
});

test('learning adapter is PC-only, locally scoped, and cannot enter frozen surfaces',()=>{
  const adapterPath=path.join(root,'styles/focus-vega-learning.css');
  assert.equal(fs.existsSync(adapterPath),true,'missing styles/focus-vega-learning.css');
  const css=fs.readFileSync(adapterPath,'utf8');
  assert.match(css,/@media\s*\(min-width\s*:\s*901px\)/);
  assert.doesNotMatch(css,/:root\b|https?:\/\/|@import/);
  assert.doesNotMatch(css,/\.qt-canvas-shell|\.qw-canvas-shell|\.kr-viewport/);
  assert.doesNotMatch(
    css,
    /#authModal|#authDialogRoot|#authStatus|\.auth-(?:backdrop|modal)|\.account-menu|\.account-menu-shell|#userCenterModal|\.user-center|\.uc-|#userSubscriptionDetailModal|\.kg-subscription-|\.subscription-|\.membership-|\.payment-|\.wechat(?:-pay)?-/,
  );
  assertScopedPcCss(css);
});

console.log('focus-vega-learning-contract-ok');
