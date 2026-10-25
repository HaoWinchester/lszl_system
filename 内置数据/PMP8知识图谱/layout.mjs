// Layout authored content with explicit ports/routes, using the editor's model.
// The diagram keeps content relations intact; routes never rely on auto ports.
const accents=['#7c3aed','#0f766e','#ea580c','#2563eb'];
const W=128,H=132;
const flowRelations={
  '03':['论证投资','明确价值假设','指导优先级','指导交付','验证收益','持续跟踪'],
  '04':['具体化','指导预防设计','融入过程','检查成果','分析根因','评估质量成本'],
  '09':['澄清','界定边界','分解成果','建立追踪','提供验收依据','反馈范围状态'],
  '10':['建立依赖','估算所需时间','计算路径','批准参照','比较实际','选择应对'],
  '11':['估算投入','制定预算','规划资金','测量绩效','更新预测','支持纠偏'],
  '14':['评估优先级','按需深化分析','选择响应','落实行动','跟踪效果','评估整体暴露'],
  '16':['表达需要','排序','映射成果','设计验证','保留证据','跟踪变化'],
  '18':['计算最早时间','计算最晚时间','计算总浮动','区分浮动口径','持续复核','关注近关键路径'],
  '25':['细化目标','准备规划','每日检查','协作交付','获取反馈','检视改进'],
  '26':['显露在制工作','支持拉动','观察周期','结合产出','识别约束','试验改进'],
  '28':['检查输入','确认使用权限','保留人工核验','检查偏差','开展试点','提供治理证据'],
  '30':['核对移交准备','保留接收证据','检查合同义务','衔接收益责任','沉淀经验','释放与归档']
};
function connectedGroups(topic){
  const adjacent=Array.from({length:7},()=>[]);
  for(const {pair:[a,b]} of topic.relations){adjacent[a].push(b);adjacent[b].push(a)}
  const seen=new Set(),groups=[];
  for(let i=0;i<7;i++){
    if(seen.has(i))continue;
    const component=[],queue=[i];seen.add(i);
    for(const v of queue){component.push(v);for(const n of adjacent[v])if(!seen.has(n)){seen.add(n);queue.push(n)}}
    // These authored topics have at most two cross-relations. A component is
    // a path: put its central concept between the two related concepts.
    const start=component.find(v=>adjacent[v].length<=1)??i,ordered=[];
    function visit(v,parent){ordered.push(v);for(const n of adjacent[v])if(n!==parent)visit(n,v)}
    visit(start,-1);groups.push(ordered);
  }
  return groups;
}
export function arrange(topic,nodes,model){
  const links=[];
  const move=(index,x,y)=>model.updateGeometry(nodes[index],{x,y});
  const style=(index,color)=>model.updateAppearance(nodes[index],{
    color,headerIconColor:color,headerFillColor:'#eef2ff',bodyFillColor:'#ffffff',headerTextColor:'#ffffff',bodyTextColor:'#0f172a',
    size:index===0?'big':'',regionColorsCustomized:true,borderVisible:true,borderColor:'#cbd5e1',borderWidth:1,surfaceCustomized:true,fontSize:index===0?18:15
  });
  nodes.forEach((n,i)=>{model.updateGeometry(n,{width:i===0?160:W,height:i===0?166:H});style(i,'#2563eb')});
  style(8,'#d97706');style(9,'#0f766e');style(10,'#be185d');
  function center(index){const g=model.geometryOf(nodes[index]);return{x:g.x+g.width/2,y:g.y+g.height/2}}
  function port(index,side){const g=model.geometryOf(nodes[index]);return side==='left'?{x:g.x,y:g.y+g.height/2}:side==='right'?{x:g.x+g.width,y:g.y+g.height/2}:side==='top'?{x:g.x+g.width/2,y:g.y}:{x:g.x+g.width/2,y:g.y+g.height}}
  function connect(a,b,type,note,{fromPort='right',toPort='left',color='#94a3b8',curveControls,waypoints,hierarchy=false}={}){
    const link={id:'pmp8-'+topic.id+'-l'+links.length,from:nodes[a].id,to:nodes[b].id,type,note,lineStyle:'solid',color,strokeWidth:2,pathStyle:'curve',fromPort,toPort,hierarchy,arrowStyle:topic.layout==='flow'?'end':'none'};
    const start=port(a,fromPort),end=port(b,toPort);
    if(waypoints)link.waypoints=waypoints;
    else if(curveControls)link.curveControls=curveControls;
    else if(fromPort==='left'||fromPort==='right'){
      const dx=end.x-start.x;link.curveControls=[{x:start.x+dx*.52,y:start.y},{x:end.x-dx*.52,y:end.y}];
    }else{const dy=end.y-start.y;link.curveControls=[{x:start.x,y:start.y+dy*.5},{x:end.x,y:end.y-dy*.5}]}
    links.push(link);return link;
  }
  if(topic.layout==='flow'){
    // A single readable lane; the next row continues in reverse direction.
    // This is a guided learning sequence, not an official process dependency map.
    move(0,20,20);
    [[300,37],[570,37],[840,37],[1110,37],[1110,300],[840,300],[570,300]].forEach(([x,y],i)=>move(i+1,x,y));
    [1,2,3,4,5,6,7].forEach((n,i)=>style(n,accents[Math.floor(i/2)%accents.length]));
    move(8,570,560);move(9,840,560);move(10,1110,560);
    connect(0,1,'学习入口','从主题目标开始，沿连线阅读概念与应用。',{color:'#2563eb',hierarchy:true});
    const labels=flowRelations[topic.id];if(!labels)throw new Error('Missing authored learning sequence: '+topic.id);
    for(let c=0;c<6;c++){
      const a=c+1,b=c+2,original=topic.relations.find(r=>r.pair[0]===c&&r.pair[1]===c+1);
      connect(a,b,original?.type||labels[c],original?.note||`建议学习顺序：${topic.concepts[c].title} → ${topic.concepts[c+1].title}。结合卡片理解关联；此线不声明官方过程的先后依赖。`,
        c<3?{color:'#64748b',hierarchy:true}:c===3?{fromPort:'bottom',toPort:'top',color:'#64748b',hierarchy:true}:{fromPort:'left',toPort:'right',color:'#64748b',hierarchy:true});
    }
    // Non-adjacent knowledge relations use the empty gutters or the perimeter.
    for(const r of topic.relations){
      const [a,b]=r.pair;if(b===a+1)continue;
      if(topic.id==='25'){
        const A=port(a+1,'top'),B=port(b+1,'bottom');
        connect(a+1,b+1,r.type,r.note,{fromPort:'top',toPort:'bottom',color:'#0f766e',curveControls:[{x:A.x,y:230},{x:B.x,y:230}]});
      }else if(a<=3&&b<=3){
        const A=port(a+1,'top'),B=port(b+1,'top');connect(a+1,b+1,r.type,r.note,{fromPort:'top',toPort:'top',color:'#0f766e',curveControls:[{x:A.x,y:-100},{x:B.x,y:-100}]});
      }else if(a<=3&&b>=4){
        const A=port(a+1,'bottom'),B=port(b+1,'left');
        connect(a+1,b+1,r.type,r.note,{fromPort:'bottom',toPort:'left',color:'#0f766e',waypoints:[{x:A.x,y:250},{x:B.x-58,y:250},{x:B.x-58,y:B.y}]});
      }else if(a>=4&&b>=4){
        const A=port(a+1,'bottom'),B=port(b+1,'bottom');
        connect(a+1,b+1,r.type,r.note,{fromPort:'bottom',toPort:'bottom',color:'#0f766e',curveControls:[{x:A.x,y:590},{x:B.x,y:590}]});
      }else throw new Error('Unrouted authored relation: '+topic.id+' '+r.pair);
    }
    connect(7,8,'情境应用','完成概念梳理后，用案例检查理解。',{fromPort:'bottom',toPort:'top',color:'#d97706'});
  }else{
    // Put related concepts on the same side, adjacent to one another.
    // Root branches use the inside lane; cross-relations use the outside lane.
    const groups=connectedGroups(topic);let chosen;
    for(let mask=1;mask<(1<<groups.length);mask++){
      if(groups.reduce((sum,g,i)=>sum+((mask>>i)&1?g.length:0),0)===3){chosen=mask;break}
    }
    if(chosen===undefined)throw new Error('Cannot balance authored groups: '+topic.id);
    const sides=[[],[]],groupColors=new Map();
    groups.forEach((group,i)=>{const side=(chosen>>i)&1?0:1;sides[side].push(...group);group.forEach(c=>groupColors.set(c,accents[i%accents.length]))});
    move(0,570,225);
    sides.forEach((side,index)=>side.forEach((concept,rank)=>{move(concept+1,index===0?160:1060,index===0?rank*210:rank*166);style(concept+1,groupColors.get(concept))}));
    for(let c=0;c<7;c++){
      const left=sides[0].includes(c);connect(0,c+1,'学习要点',`“${topic.concepts[c].title}”是本主题的学习切入点，不代表官方过程层级。`,{fromPort:left?'left':'right',toPort:left?'right':'left',color:'#94a3b8',hierarchy:true});
    }
    for(const r of topic.relations){
      const [a,b]=r.pair,left=sides[0].includes(a),side=left?'left':'right',A=port(a+1,side),B=port(b+1,side),x=left?55:1295;
      connect(a+1,b+1,r.type,r.note,{fromPort:side,toPort:side,color:groupColors.get(a),curveControls:[{x,y:A.y},{x,y:B.y}]});
    }
    move(8,330,620);move(9,600,620);move(10,870,620);
    // The centre lane stays separate from both sets of concept branches.
    const start=port(0,'bottom'),end=port(8,'top');
    connect(0,8,'情境应用','用案例检查概念理解与应用。',{fromPort:'bottom',toPort:'top',color:'#d97706',curveControls:[{x:start.x,y:500},{x:end.x,y:500}]});
  }
  connect(8,9,'处理思路','将已知事实与概念联系后提出处理思路。',{color:'#0f766e'});
  connect(9,10,'易错辨析','比较合理思路与常见误判。',{color:'#64748b'});
  return {links,layout:topic.layout==='flow'?'guided-flow':'bilateral-branches'};
}
