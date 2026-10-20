import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('../../new-legacy/assets/emoji/fluent/',import.meta.url));
test('approved Fluent artwork is pinned, complete, local and unmodified',()=>{
 const manifest=JSON.parse(readFileSync(directory+'manifest.json','utf8'));
 assert.equal(manifest.source,'https://github.com/microsoft/fluentui-emoji');
 assert.match(manifest.commit,/^[a-f0-9]{40}$/);assert.equal(manifest.license,'MIT');
 assert.equal(manifest.assets.length,48);
 assert.match(readFileSync(directory+'LICENSE','utf8'),/MIT License/);
 const unique=new Set();
 for(const asset of manifest.assets){
  assert.match(asset.file,/^[a-f0-9-]+\.svg$/);assert.ok(!unique.has(asset.emoji));unique.add(asset.emoji);
  assert.ok(existsSync(directory+asset.file));const svg=readFileSync(directory+asset.file);
  assert.equal(createHash('sha256').update(svg).digest('hex'),asset.sha256,asset.file);
  assert.equal(svg.length,asset.bytes);assert.match(svg.toString(),/<svg\b/);
  assert.doesNotMatch(svg.toString(),/<(?:script|foreignObject)\b|\bon\w+=|(?:href|src)=["'](?:https?:|\/\/)/i);
 }
});
