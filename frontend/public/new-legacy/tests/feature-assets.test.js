const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function factory(){const context={window:{},Promise,Set,Map};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/feature-assets.js'),'utf8'),context);return context.window.KGFeatureAssets}
test('feature groups load only on demand, preserve dependencies and coalesce repeated clicks',async()=>{
 const api=factory(),calls=[];let release;const held=new Promise(resolve=>release=resolve);
 const loader=api.create({groups:{base:{scripts:['base.js']},answer:{depends:['base'],scripts:['answer.js'],styles:['answer.css']}},loadScript:async url=>{calls.push(url);if(url==='base.js')await held},loadStyle:async url=>calls.push(url)});
 assert.deepEqual(calls,[]);const a=loader.load('answer'),b=loader.load('answer');assert.equal(a,b);await Promise.resolve();release();await a;
 assert.deepEqual(calls,['base.js','answer.css','answer.js']);await loader.load('answer');assert.equal(calls.length,3);assert.equal(loader.state('answer'),'ready');
});
test('failed optional feature retries without reloading successful dependencies',async()=>{
 const api=factory(),calls=[];let fail=true;const loader=api.create({groups:{base:{scripts:['base.js']},account:{depends:['base'],scripts:['account.js']}},loadScript:async url=>{calls.push(url);if(url==='account.js'&&fail)throw Error('offline')}});
 await assert.rejects(loader.load('account'),/offline/);assert.equal(loader.state('account'),'error');fail=false;await loader.load('account');assert.deepEqual(calls,['base.js','account.js','account.js']);
});
