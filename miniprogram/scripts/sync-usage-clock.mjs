import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('../../new-legacy/src/feature-usage-clock.js',import.meta.url),'utf8');
const target=new URL('../domain/feature-usage-clock.js',import.meta.url);
if(process.argv.includes('--check')){
  if(readFileSync(target,'utf8')!==source)throw new Error('Run node scripts/sync-usage-clock.mjs to synchronize the shared usage clock');
}else writeFileSync(target,source);
