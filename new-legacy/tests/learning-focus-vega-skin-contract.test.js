'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function extractBalanced(html,marker,tag){
  const markerAt=html.indexOf(marker);
  assert.notEqual(markerAt,-1,marker);
  const start=html.lastIndexOf(`<${tag}`,markerAt);
  let depth=0;
  const source=html.slice(start);
  const pattern=new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi');
  for(const match of source.matchAll(pattern)){
    depth+=match[0].startsWith('</')?-1:1;
    if(depth===0)return source.slice(0,match.index+match[0].length);
  }
  throw new Error(`unbalanced ${marker}`);
}

function splitSelectorList(prelude){
  const selectors=[];
  let start=0,round=0,square=0;
  for(let index=0;index<prelude.length;index+=1){
    const char=prelude[index];
    if(char==='(')round+=1;
    else if(char===')')round-=1;
    else if(char==='[')square+=1;
    else if(char===']')square-=1;
    else if(char===','&&round===0&&square===0){selectors.push(prelude.slice(start,index).trim());start=index+1}
  }
  selectors.push(prelude.slice(start).trim());
  return selectors.filter(Boolean);
}

function declarationMap(source){
  const result={};
  for(const declaration of source.split(';')){
    const separator=declaration.indexOf(':');
    if(separator<0)continue;
    const property=declaration.slice(0,separator).trim().toLowerCase();
    const value=declaration.slice(separator+1).trim();
    if(property)result[property]=value;
  }
  return result;
}

function parseCSS(source,{scoped=false}={}){
  const rules=[];
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'');
  function walk(block,atRules=[]){
    let cursor=0;
    while(cursor<block.length){
      while(/\s/.test(block[cursor]||''))cursor+=1;
      if(cursor>=block.length)return;
      const open=block.indexOf('{',cursor);
      assert.notEqual(open,-1,`missing CSS block for ${block.slice(cursor).trim()}`);
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
        if(scoped)assert.match(prelude,/^@media\b/,`unsupported skin at-rule ${prelude}`);
        walk(body,[...atRules,prelude]);
      }else{
        const selectors=splitSelectorList(prelude);
        if(scoped){
          for(const selector of selectors){
            const prefixes=['body[data-learning-skin="focus-vega"]','body.practice-mode-page[data-learning-skin="focus-vega"]'];
            const inScope=prefixes.some(prefix=>{
              if(!selector.startsWith(prefix))return false;
              const remainder=selector.slice(prefix.length);
              return !remainder||/^[\s.#:\[>+~*]/.test(remainder);
            });
            assert.equal(inScope,true,`unscoped skin selector: ${selector}`);
          }
        }
        assert.equal(body.includes('{'),false,`nested declarations in ${prelude}`);
        rules.push({selectors,declarations:declarationMap(body),atRules});
      }
      cursor=close;
    }
  }
  walk(clean);
  return rules;
}

function containsSelectorToken(selector,token){
  let index=selector.indexOf(token);
  while(index>=0){
    const after=selector[index+token.length]||'';
    if(!after||/[\s.#:\[>+~*),]/.test(after))return true;
    index=selector.indexOf(token,index+1);
  }
  return false;
}

function declarationsFor(rules,token){
  const result={};
  for(const rule of rules){
    if(rule.selectors.some(selector=>containsSelectorToken(selector,token)))Object.assign(result,rule.declarations);
  }
  return result;
}

function exactDeclarations(rules,selector,atRulePattern=null){
  const result={};
  for(const rule of rules){
    const contextMatches=!atRulePattern||rule.atRules.some(atRule=>atRulePattern.test(atRule));
    if(contextMatches&&rule.selectors.includes(selector))Object.assign(result,rule.declarations);
  }
  return result;
}

const frozen=[
  ['question-training.html','class="qt-canvas-shell"','div','3dc3850b0ee841ffe7a984e212e0f46a191e46baa15e69b44d5cc2766198580f'],
  ['question-workspace.html','class="qw-canvas-shell"','main','ec7d0d07b46c874c1e1a9fab37de3a2c5a438556f8ddc4b610d8c6ee12dbbf9e'],
  ['knowledge-recall.html','class="kr-viewport"','main','bb4d9370d470798895b2d6f72ebda388933b15b31685610b659cb73e431cc7a8'],
];

for(const [file,marker,tag,expected] of frozen){
  const actual=crypto.createHash('sha256').update(extractBalanced(read(file),marker,tag)).digest('hex');
  assert.equal(actual,expected,`${file} frozen DOM changed`);
}

const css=read('styles/learning-skin.css');
assert.match(css,/body\[data-learning-skin="focus-vega"\]/);
assert.doesNotMatch(css,/:root\b|https?:\/\/|@import/);
for(const forbidden of ['.qt-canvas-shell','.qw-canvas-shell','.kr-viewport','.lp-canvas-zoom-dock','.qt-minimap-dock','.qw-minimap','.qt-canvas-','.qw-canvas-','.kr-world']){
  assert.equal(css.includes(forbidden),false,`frozen selector ${forbidden}`);
}

assert.throws(
  ()=>parseCSS('body[data-learning-skin="focus-vega"],\n.unscoped-on-another-line\n{color:red}',{scoped:true}),
  /unscoped skin selector/,
  'multiline selector lists must not bypass skin scoping',
);
const skinRules=parseCSS(css,{scoped:true});
const accountRules=parseCSS(read('styles/account-menu.css'));
const practiceRules=parseCSS(read('styles/practice-mode.css'));
for(const rule of skinRules){
  for(const [property,value] of Object.entries(rule.declarations)){
    if(!/^(?:display|grid(?:-.+)?|flex(?:-.+)?|width|min-width|max-width|height|min-height|max-height|position|inset(?:-.+)?|top|right|bottom|left|margin(?:-.+)?|padding(?:-.+)?|gap|row-gap|column-gap)$/.test(property))continue;
    const isIconRule=rule.selectors.length===1&&rule.selectors[0]==='body[data-learning-skin="focus-vega"] .kg-icon';
    const allowed=isIconRule&&((property==='display'&&value==='block')||(property==='flex'&&value==='0 0 auto'));
    assert.equal(allowed,true,`layout declaration ${property}:${value} in ${rule.selectors.join(',')}`);
  }
}

const practice=read('practice-mode.html');
assert.match(practice,/<body class="practice-mode-page" data-learning-skin="focus-vega">/);
const stylesheetHrefs=[...practice.matchAll(/<link\b[^>]*>/g)]
  .map(match=>match[0])
  .filter(tag=>/\brel="stylesheet"/.test(tag))
  .map(tag=>/\bhref="([^"]+)"/.exec(tag)?.[1]);
assert.equal(stylesheetHrefs.at(-1),'styles/learning-skin.css','learning skin must be the final stylesheet');
assert.ok(practice.indexOf('src/107-learning-ui-icons.js')<practice.indexOf('src/41-account-menu.js'));
for(const name of ['diamond','zap','timer','x','chevron-down','circle-user-round','circle-help','log-in']){
  assert.match(practice,new RegExp(`data-kg-icon="${name}"`));
}
assert.match(practice,/data-account-session-icon/);
assert.equal((practice.match(/class="account-menu-item-label"/g)||[]).length,3);
assert.doesNotMatch(practice,/>\s*\u25c6\s*<|>\s*\u26a1\s*<|class="practice-exit-btn"[^>]*>\s*\u00d7\s*<|class="auth-close"[^>]*>\s*\u00d7\s*</);

const failures=[];
function check(name,run){
  try{run()}catch(error){failures.push(`${name}: ${error.message}`)}
}

check('floating feedback contrast stays readable',()=>{
  assert.equal(declarationsFor(skinRules,'.practice-feedback.success').color,'var(--learn-primary-foreground)');
  assert.equal(declarationsFor(skinRules,'.practice-feedback.danger').color,'var(--learn-primary-foreground)');
  assert.equal(declarationsFor(practiceRules,'.practice-feedback.success').background,'var(--practice-success)');
  assert.equal(declarationsFor(practiceRules,'.practice-feedback.danger').background,'var(--practice-danger)');
  assert.equal(declarationsFor(skinRules,'.auth-msg.ok').color,'var(--learn-success)');
  assert.equal(declarationsFor(skinRules,'[data-state="success"]').color,'var(--learn-success)');
  assert.equal(declarationsFor(skinRules,'[data-state="error"]').color,'var(--learn-destructive)');
});

check('hidden radio exposes a visible keyboard ring',()=>{
  const focus=declarationsFor(skinRules,'.practice-choice-group input:focus-visible+span');
  assert.equal(focus.outline,'2px solid var(--learn-ring)');
  assert.equal(focus['outline-offset'],'2px');
});

check('heart rendering survives a missing or failed adapter',()=>{
  const modulePath=path.join(root,'src/100-practice-mode.js');
  delete require.cache[require.resolve(modulePath)];
  const api=require(modulePath);
  assert.equal(typeof api.renderHeartIcon,'function');
  const hadIcons=Object.prototype.hasOwnProperty.call(globalThis,'KGLearningIcons');
  const previousIcons=globalThis.KGLearningIcons;
  try{
    delete globalThis.KGLearningIcons;
    assert.equal(api.renderHeartIcon(),'\u2665');
    globalThis.KGLearningIcons={render(){throw new Error('adapter failed')}};
    assert.equal(api.renderHeartIcon(),'\u2665');
    let received;
    globalThis.KGLearningIcons={render(...args){received=args;return '<svg data-heart="true"></svg>'}};
    assert.equal(api.renderHeartIcon(),'<svg data-heart="true"></svg>');
    assert.deepEqual(received,['heart',{size:18}]);
  }finally{
    if(hadIcons)globalThis.KGLearningIcons=previousIcons;
    else delete globalThis.KGLearningIcons;
  }
});

check('scholar accent and account surface remove legacy amber glass',()=>{
  const scholar=declarationsFor(skinRules,'.practice-mode-card.scholar .practice-mode-icon');
  assert.equal(scholar.background,'var(--learn-accent)');
  assert.equal(scholar.color,'var(--learn-accent-foreground)');
  const account=declarationsFor(skinRules,'.account-menu');
  assert.equal(account.background,'var(--learn-card)');
  assert.equal(account['backdrop-filter'],'none');
});

check('nested icons track responsive host dimensions',()=>{
  assert.deepEqual(exactDeclarations(accountRules,'.account-menu-chevron .kg-icon'),{width:'100%',height:'100%'});
  assert.deepEqual(exactDeclarations(practiceRules,'.practice-time-icon .kg-icon'),{width:'100%',height:'100%'});
  const mobileChevron=exactDeclarations(accountRules,'.account-menu-chevron',/@media[^\n]*(?:max-width:850px|pointer:coarse)/);
  const mobileTimer=exactDeclarations(practiceRules,'.practice-time-icon',/@media[^\n]*max-width:560px/);
  assert.equal(mobileChevron.width,'13px');
  assert.equal(mobileChevron.height,'13px');
  assert.equal(mobileTimer.width,'16px');
  assert.equal(mobileTimer.height,'16px');
});

assert.deepEqual(failures,[],failures.join('\n'));

console.log('learning-focus-vega-skin-contract-ok');
