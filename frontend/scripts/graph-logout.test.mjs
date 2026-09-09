import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source=name=>fs.readFileSync(new URL('../../new-legacy/src/'+name,import.meta.url),'utf8')
function harness(){
 const c={console,Date,Promise,JSON,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},matchMedia:()=>({matches:false}),document:{getElementById:()=>null,documentElement:{dataset:{}}},CustomEvent:function(type,init){Object.assign(this,{type,...init})},addEventListener(){},dispatchEvent(){}}
 c.window=c;c.globalThis=c;vm.createContext(c)
 return {c,run:name=>vm.runInContext(source(name).split("const __authOpenNodeModal=")[0],c),eval:code=>vm.runInContext(code,c)}
}
test('view-only default graph can save/exit without creating a server file',async()=>{
 const h=harness();h.run('00-config-state.js');h.run('24-graph-file-autosave.js')
 let writes=0;h.c.KGGraphFileRemoteAdapter={active:()=>true,getLoadedGraph:()=>null,getCurrentFileMeta:()=>null,queueSave:()=>{writes++;return false},save:()=>{writes++;return Promise.resolve()}}
 h.eval('load();state.viewport.scale=0.5;KGGraphFileAutosave.markDirty()')
 assert.equal(await h.eval('saveNow({silent:true})'),true)
 assert.equal(writes,0)
 assert.equal(h.c.KGGraphFileAutosave.isDirty(),false)
})
test('logout waits for an asynchronous failed save and keeps session',async()=>{
 const h=harness();let loggedOut=0,finish
 h.c.KGAuthCore={currentUser:()=>({username:'member'}),providerStatus:()=>({remote:true}),logout:async()=>{loggedOut++}}
 h.c.saveNow=()=>new Promise(r=>finish=r);h.c.showStatus=()=>{};h.run('30-auth-guards.js');h.c.authRenderStatus=()=>{}
 const logout=h.c.authLogout();assert.equal(loggedOut,0);finish(false);assert.equal(await logout,false);assert.equal(loggedOut,0)
 h.c.saveNow=async()=>true;assert.equal(await h.c.authLogout(),true);assert.equal(loggedOut,1)
})
test('concurrent save callers await the same write, and newer edits stay dirty',async()=>{
 const h=harness();h.run('24-graph-file-autosave.js');const a=h.c.KGGraphFileAutosave;let finish
 h.c.persistCurrentGraphNow=()=>new Promise(r=>finish=r);a.markDirty();const first=a.saveNow();const second=a.saveNow()
 assert.equal(second,first);a.markDirty();finish(true);assert.equal(await first,true);assert.equal(a.isDirty(),true)
})
test('first edit creates one durable file; retry selection without duplicate creation',async()=>{
 const h=harness();let creates=0,selects=0,saves=0;const events=[];h.c.dispatchEvent=e=>events.push(e)
 h.c.KGGraphFileApi={isRemote:()=>true,getCurrent:async()=>({fileId:null}),create:async()=>{creates++;return{file:{id:'new',revision:1}}},setCurrent:async()=>{if(++selects===1)throw Error('offline')},save:async(id,p)=>{saves++;assert.equal(p.expectedRevision,saves);return{file:{id,revision:saves+1}}}}
 h.run('23-graph-file-remote-adapter.js');const a=h.c.KGGraphFileRemoteAdapter;await a.initializeCurrent();assert.equal(creates,0)
 const graph={meta:{title:'edited'},nodes:[{id:'n'}]}
 await assert.rejects(a.save(graph),/offline/);await a.save(graph);await a.save(graph)
 assert.equal(creates,1);assert.equal(selects,2);assert.equal(saves,2);assert.equal(events.filter(e=>e.type==='kg-graph-current-file-change').length,1)
})
test('title edit participates in pending autosave and prevents logout on failure',async()=>{
 const h=harness();let finish,loggedOut=0
 h.c.KGAuthCore={currentUser:()=>({username:'member'}),providerStatus:()=>({remote:true}),logout:async()=>{loggedOut++}}
 h.run('00-config-state.js');h.run('24-graph-file-autosave.js');h.run('30-auth-guards.js');h.c.authRenderStatus=()=>{}
 h.c.KGGraphFileStore={getCurrentFileMeta:()=>({id:'file',name:'old'})}
 h.c.persistCurrentGraphNow=()=>new Promise(r=>finish=r);h.c.showStatus=()=>{};h.c.renderHeader=()=>{};h.c.render=()=>{}
 const editor=source('10-graph-editor.js');vm.runInContext(editor.slice(editor.lastIndexOf('\n',editor.indexOf('function saveGraphTitle(')),editor.indexOf('function openGraphModal(')),h.c)
 const title=h.c.saveGraphTitle('new');const logout=h.c.authLogout();assert.equal(loggedOut,0)
 finish(false);assert.equal(await title,false);assert.equal(await logout,false);assert.equal(loggedOut,0);assert.equal(h.c.KGGraphFileAutosave.isDirty(),true)
})
test('overlapping title changes persist the latest filename with the latest content',async()=>{
 const h=harness();h.run('00-config-state.js');h.run('24-graph-file-autosave.js');let finish;const writes=[]
 h.c.persistCurrentGraphNow=options=>{writes.push({name:options.name,title:h.eval('state.meta.title')});return writes.length===1?new Promise(r=>finish=r):true}
 h.c.showStatus=()=>{};h.c.renderHeader=()=>{};h.c.render=()=>{}
 const editor=source('10-graph-editor.js');vm.runInContext(editor.slice(editor.lastIndexOf('\n',editor.indexOf('function saveGraphTitle(')),editor.indexOf('function openGraphModal(')),h.c)
 const first=h.c.saveGraphTitle('first'),second=h.c.saveGraphTitle('second');finish(true);await Promise.all([first,second])
 assert.deepEqual(writes,[{name:'first',title:'first'},{name:'second',title:'second'}]);assert.equal(h.c.KGGraphFileAutosave.isDirty(),false)
})
