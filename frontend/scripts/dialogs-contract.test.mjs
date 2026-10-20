import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),source=resolve(repo,'new-legacy')
const read=file=>readFileSync(file,'utf8')
const walk=root=>readdirSync(root,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(resolve(root,item.name)):item.name.endsWith('.js')?[resolve(root,item.name)]:[])

test('every source entry loads the shared application dialogs before page controllers',()=>{
  for(const name of readdirSync(source).filter(name=>name.endsWith('.html')&&!name.startsWith('baidu_verify_')&&!['learning-path.html','guided-learning-node.html','guided-learning-placement-test.html','question-training.html'].includes(name))){
    const html=read(resolve(source,name)),script=html.indexOf('src="src/00-dialogs.js"')
    assert.ok(script>=0,`${name} needs early shared dialogs`)
    assert.ok(html.includes('href="styles/dialogs.css"'),name)
    assert.ok(script<html.indexOf('</head>'),name)
  }
  const plan=JSON.parse(read(resolve(repo,'frontend/scripts/homepage-bundles.json')))
  assert.ok(plan.groups.find(g=>g.name==='home-prelude').scripts.includes('src/00-dialogs.js'))
  assert.ok(plan.groups.flatMap(g=>g.styles).includes('styles/dialogs.css'))
  const prep=read(resolve(source,'content-prep-studio/build.py'))
  assert.ok(prep.includes('"00-dialogs.js"')&&prep.includes('"dialogs.css"'))
})

test('native dialog globals are absent from production controllers and adapters',()=>{
  for(const file of [...walk(resolve(source,'src')),...walk(resolve(source,'content-prep-studio/src/js')),...walk(resolve(source,'question-studio')),...walk(resolve(repo,'frontend/scripts/new-legacy-assets'))]){
    const js=read(file)
    assert.doesNotMatch(js,/\b(?:window|globalThis|global)\s*\.\s*(?:alert|confirm|prompt)\b/,file)
    for(const name of ['alert','confirm','prompt']){
      if(new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(js))continue // controller methods are local, not browser APIs
      assert.doesNotMatch(js,new RegExp(`(?<![\\w.])${name}\\s*(?:\\?\\.)?\\(`),file)
    }
  }
})
