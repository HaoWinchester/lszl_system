const legacyToSemantic={
  'usage/stage/0':'usage/stage/basic','usage/stage/1':'usage/stage/phase-test',
  'usage/stage/2':'usage/stage/mock-exam','usage/stage/3':'usage/stage/sprint-review',
  'usage/stage/4':'usage/stage/preview','usage/stage/5':'usage/stage/intensive',
  'usage/stage/6':'usage/stage/mistake-review'
};
const semanticToLegacy=Object.fromEntries(Object.entries(legacyToSemantic).map(([a,b])=>[b,a]));
const semantic=s=>legacyToSemantic[s]||s;
const formal=s=>semanticToLegacy[s]||s;

const old={
  names:{'usage/stage/0':'入门练习','usage/stage/4':'预习'},
  slotAliases:{'usage/stage/0':['基础题'],'usage/stage/6':['复盘题']}
};
const migrated={
  names:Object.fromEntries(Object.entries(old.names).map(([k,v])=>[semantic(k),v])),
  slotAliases:Object.fromEntries(Object.entries(old.slotAliases).map(([k,v])=>[semantic(k),v]))
};
if(migrated.names['usage/stage/basic']!=='入门练习')throw new Error('legacy name migration failed');
if(migrated.slotAliases['usage/stage/mistake-review'][0]!=='复盘题')throw new Error('alias migration failed');
const exported=Object.fromEntries(Object.entries(migrated.names).map(([k,v])=>[formal(k),v]));
if(exported['usage/stage/0']!=='入门练习'||exported['usage/stage/4']!=='预习')throw new Error('formal export round-trip failed');
console.log('tag migration round-trip: passed');
