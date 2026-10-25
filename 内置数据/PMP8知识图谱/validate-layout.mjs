// Validate the generated content with the editor's real edge path functions.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
await import('../../new-legacy/src/graph/graph-model.js');
await import('../../new-legacy/src/graph/edge-geometry.js');
const root=path.dirname(fileURLToPath(import.meta.url)),model=globalThis.KGGraphModel,geometry=globalThis.KGGraphEdgeGeometry;
const editor=readFileSync(path.join(root,'../../new-legacy/src/10-graph-editor.js'),'utf8');
const functions=editor.slice(editor.indexOf('function pathStyleForLink('),editor.indexOf('function dashArrayForLineStyle('));
const ctx=vm.createContext({window:{KGGraphEdgeGeometry:geometry},LINE_PATH_STYLES:new Set(['curve','straight','elbow']),DEFAULTS:{linkPathStyle:'curve'},formatSvgNumber:v=>String(Math.round(v*10)/10)});
vm.runInContext(functions,ctx);
function endpoint(n,side,opposite){return geometry.portPoint(model.geometryOf(n),side,opposite)}
function cross(a,b,c){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
function crossing(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<-1e-5&&cross(c,d,a)*cross(c,d,b)<-1e-5}
function sampleRoute(link,nodes){
 const a=nodes.get(link.from),b=nodes.get(link.to),A=model.geometryOf(a),B=model.geometryOf(b);
 const ca={x:A.x+A.width/2,y:A.y+A.height/2},cb={x:B.x+B.width/2,y:B.y+B.height/2};
 const rendered=ctx.linkPathGeometry(link,endpoint(a,link.fromPort,cb),endpoint(b,link.toPort,ca),{aNode:a,bNode:b,ca,cb});
 if(rendered.curveControls){const [start,end]=rendered.endpoints,[c1,c2]=rendered.curveControls;return Array.from({length:201},(_,i)=>ctx.cubicEdgePoint(start,c1,c2,end,i/200))}
 return rendered.samples;
}
const catalog=JSON.parse(readFileSync(path.join(root,'catalog.json'))),report=[];
for(const item of catalog.graphs){
 const graph=JSON.parse(readFileSync(path.join(root,item.file))),nodes=new Map(graph.nodes.map(n=>[n.id,n]));
 const routes=graph.links.map(link=>({link,samples:sampleRoute(link,nodes)}));
 const obstacles=[],intersections=[];
 for(const {link,samples} of routes)for(const n of graph.nodes){
  if(n.id===link.from||n.id===link.to)continue;
  const box=model.geometryOf(n),pad=8;
  if(samples.some(p=>p.x>box.x-pad&&p.x<box.x+box.width+pad&&p.y>box.y-pad&&p.y<box.y+box.height+pad))obstacles.push({link:link.id,node:n.id});
 }
 for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
  const a=routes[i],b=routes[j];let found=false;
  for(let m=1;m<a.samples.length&&!found;m++)for(let n=1;n<b.samples.length;n++)if(crossing(a.samples[m-1],a.samples[m],b.samples[n-1],b.samples[n])){found=true;break}
  if(found)intersections.push([a.link.id,b.link.id]);
 }
 const grayIcons=graph.nodes.filter(n=>model.appearanceOf(n).headerIconColor==='#64748b').length;
 const palette=[...new Set(graph.nodes.map(n=>model.appearanceOf(n).headerIconColor))];
 report.push({id:item.id,name:item.name,nodes:graph.nodes.length,links:graph.links.length,cardObstructions:obstacles,edgeCrossings:intersections,grayIcons,palette});
}
const issues=report.filter(r=>r.cardObstructions.length||r.edgeCrossings.length||r.grayIcons);
const output={graphs:report,totalGraphs:report.length,totalNodes:catalog.nodeCount,totalLinks:catalog.linkCount,cardObstructions:report.reduce((n,r)=>n+r.cardObstructions.length,0),edgeCrossings:report.reduce((n,r)=>n+r.edgeCrossings.length,0)};
writeFileSync(path.join(root,'layout-validation.json'),JSON.stringify(output,null,2)+'\n');
if(issues.length)console.log(JSON.stringify(issues,null,2));
assert.equal(issues.length,0,'Generated diagrams have visual geometry or palette defects');
console.log(JSON.stringify({graphs:report.length,cardObstructions:0,edgeCrossings:0,grayIcons:0}));
