'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const allowed=['arrow-left','chevron-down','circle-help','circle-user-round','diamond','heart','library','log-in','log-out','palette','plus','sparkles','timer','x','zap'];
const sprite=fs.readFileSync(path.join(root,'assets/icons/lucide-learning.svg'),'utf8');
for(const name of allowed)assert.match(sprite,new RegExp(`<symbol id="${name}"(?=\\s|>)`),`missing ${name}`);
assert.deepEqual([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map(match=>match[1]),allowed);
assert.doesNotMatch(sprite,/<script|onload=|\b(?:href|src|xlink:href)=["']https?:\/\//i);
const source=fs.readFileSync(path.join(root,'src/107-learning-ui-icons.js'),'utf8');
const warnings=[];
const contextConsole={warn:(...values)=>warnings.push(values.join(' '))};
const context={window:{location:{hostname:'localhost',protocol:'http:'}},console:contextConsole};
context.window.window=context.window;context.window.console=contextConsole;
vm.runInNewContext(source,context,{filename:'107-learning-ui-icons.js'});
const icons=context.window.KGLearningIcons;
assert.deepEqual([...icons.names],allowed);
const decorative=icons.render('zap');
assert.match(decorative,/class="kg-icon"/);
assert.match(decorative,/aria-hidden="true"/);
assert.match(decorative,/href="[^"]*lucide-learning\.svg#zap"/);
assert.match(decorative,/fill="none"/);
assert.match(decorative,/stroke="currentColor"/);
assert.match(decorative,/stroke-width="2"/);
const labelled=icons.render('circle-help',{label:'帮助中心',size:18});
assert.match(labelled,/role="img"/);
assert.match(labelled,/aria-label="帮助中心"/);
assert.match(labelled,/width="18" height="18"/);
assert.match(icons.render('not-registered'),/lucide-learning\.svg#circle-help/);
assert.equal(warnings.length,1);
assert.match(warnings[0],/not-registered/);
icons.render('not-registered');
assert.equal(warnings.length,1);

function iconSlot(dataset,descendants=[]){
  let markup='',writes=0;
  return{
    dataset:{...dataset},
    matches(selector){
      return (selector.includes('[data-kg-icon]')&&Object.hasOwn(this.dataset,'kgIcon'))
        ||(selector.includes('[data-account-session-icon]')&&Object.hasOwn(this.dataset,'accountSessionIcon'));
    },
    querySelectorAll:selector=>selector==='[data-kg-icon]'?descendants:[],
    get innerHTML(){return markup},
    set innerHTML(value){markup=value;writes+=1},
    get textContent(){return markup},
    set textContent(value){markup=value;writes+=1},
    get writes(){return writes},
  };
}
const childSlot=iconSlot({kgIcon:'zap',kgIconSize:'16'});
const rootSlot=iconSlot({kgIcon:'heart',kgIconLabel:'生命值',kgIconSize:'20'},[childSlot]);
assert.equal(icons.hydrate(rootSlot),2);
assert.match(rootSlot.innerHTML,/lucide-learning\.svg#heart/);
assert.match(rootSlot.innerHTML,/aria-label="生命值"/);
assert.match(rootSlot.innerHTML,/width="20" height="20"/);
assert.match(childSlot.innerHTML,/lucide-learning\.svg#zap/);
const writesAfterFirstHydration=[rootSlot.writes,childSlot.writes];
assert.equal(icons.hydrate(rootSlot),2);
assert.deepEqual([rootSlot.writes,childSlot.writes],writesAfterFirstHydration);
rootSlot.dataset.kgIconLabel='剩余生命';
rootSlot.dataset.kgIconSize='16';
assert.equal(icons.hydrate(rootSlot),2);
assert.match(rootSlot.innerHTML,/aria-label="剩余生命"/);
assert.match(rootSlot.innerHTML,/width="16" height="16"/);

function classList(){
  const values=new Set();
  return{
    toggle(name,force){if(force)values.add(name);else values.delete(name)},
    contains:name=>values.has(name),
  };
}
function control(){
  const attributes={};
  return{
    dataset:{},classList:classList(),hidden:false,title:'',
    addEventListener(){},focus(){},contains(){return false},
    setAttribute(name,value){attributes[name]=String(value)},
    getAttribute:name=>attributes[name],
  };
}
let loggedIn=false,ready;
const sessionIcon=iconSlot({accountSessionIcon:''});
const sessionLabel={dataset:{mobileLabel:'登录'},textContent:'登录',matches(){return false}};
const sessionBtn={...control(),
  querySelector(selector){
    if(selector==='[data-account-session-icon]')return sessionIcon;
    if(selector==='.account-menu-item-label,[data-account-session-label]')return null;
    return null;
  },
  querySelectorAll(selector){return selector==='span'?[sessionIcon,sessionLabel]:[]},
};
const elements={
  accountMenuShell:control(),authStatus:control(),accountMenu:control(),
  accountMenuUserCenterBtn:control(),accountMenuHelpBtn:control(),accountMenuUpgradeBtn:control(),accountMenuSessionBtn:sessionBtn,
};
const accountDocument={
  readyState:'loading',
  getElementById:id=>elements[id]||null,
  addEventListener(type,listener){if(type==='DOMContentLoaded')ready=listener},
};
const accountWindow={
  document:accountDocument,KGLearningIcons:icons,
  KGAuthRuntime:{isLoggedIn:()=>loggedIn},
  addEventListener(){},
};
const accountSource=fs.readFileSync(path.join(root,'src/41-account-menu.js'),'utf8');
vm.runInNewContext(accountSource,{window:accountWindow,document:accountDocument,console,getComputedStyle:()=>({display:'block'}),requestAnimationFrame:fn=>fn()},{filename:'41-account-menu.js'});
ready();
assert.equal(sessionLabel.textContent,'登录');
assert.match(sessionIcon.innerHTML,/lucide-learning\.svg#log-in/);
loggedIn=true;
accountWindow.KGAccountMenu.refresh();
assert.equal(sessionLabel.textContent,'退出登录');
assert.equal(sessionLabel.dataset.mobileLabel,'退出');
assert.match(sessionIcon.innerHTML,/lucide-learning\.svg#log-out/);
assert.equal(sessionBtn.getAttribute('aria-label'),'退出登录');
console.log('learning-focus-vega-icons-ok');
