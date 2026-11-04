import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runNodeTestProcess } from './node-test-process.mjs'
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
test('shared feature loader coalesces demand and retries failures without eager loads',()=>{
 const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/feature-assets.test.js',import.meta.url))],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
})
test('practice initial page contains only two scripts and declarative optional features',()=>{
 const html=read('../public/new-legacy/practice-mode.html');const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(x=>x[1]);assert.equal(scripts.length,2);assert.ok(scripts.every(x=>/bundles\/practice-(prelude|lobby)\.js\?v=/.test(x)))
 assert.match(html,/data-practice-view="lobby"/);const config=JSON.parse(html.match(/id="kg-page-features">([^<]+)<\/script>/)[1]);for(const name of ['auth','account','answer','community','report','knowledge'])assert.ok(config[name]);assert.ok(config.account.depends.includes('auth'));assert.ok(config.answer.depends.includes('community'))
 const plan=JSON.parse(read('./practice-bundles.json'));const initial=plan.groups.filter(g=>g.initial).flatMap(g=>g.scripts);for(const name of ['src/113-practice-result-report.js','src/119-question-comments.js','src/33-user-center.js','src/32-wechat-login.js','src/practice/knowledge-space-scene.js'])assert.ok(!initial.includes(name),name);assert.ok(!plan.groups.flatMap(g=>g.scripts).includes('question-catalog-adapter.js'))
})
test('practice keeps the approved stylesheet cascade while deferring scripts',()=>{
 const approved=['dialogs','main','user-center','membership-ui','subscription','account-menu','support-center','practice-mode','question-comments','knowledge-dashboard','focus-vega-typography','learning-skin','learning-loading','learning-weekly-open-gate','close-button','answer-page','question-materials'].map(name=>`styles/${name}.css`)
 const plan=JSON.parse(read('./practice-bundles.json'))
 assert.deepEqual(plan.groups.filter(g=>g.initial).flatMap(g=>g.styles),approved)
 assert.ok(plan.groups.filter(g=>g.feature).every(g=>g.styles.length===0),'optional scripts must not reorder the approved CSS cascade')
 const css=read('../public/new-legacy/bundles/practice-lobby.css')
 assert.deepEqual([...css.matchAll(/\/\* style: ([^ ]+) \*\//g)].map(match=>match[1]),approved)
})
