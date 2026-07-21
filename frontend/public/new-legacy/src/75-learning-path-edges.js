'use strict';

/*
 * LearningPathEdges v1
 * 独立管理学习卡片之间的关系模型和 SVG 连线渲染。
 * v1 只包含不可删除的五步主干线，为后续扩展线编辑和路径跳过预留接口。
 */
(function(global){
  const SVG_NS='http://www.w3.org/2000/svg';
  const DEFAULT_EDGES=Object.freeze([
    Object.freeze({id:'edge-step-1-step-2',source:'step-1',target:'step-2',relation:'next',pathType:'core',editable:false}),
    Object.freeze({id:'edge-step-2-step-3',source:'step-2',target:'step-3',relation:'next',pathType:'core',editable:false}),
    Object.freeze({id:'edge-step-3-step-4',source:'step-3',target:'step-4',relation:'next',pathType:'core',editable:false}),
    Object.freeze({id:'edge-step-4-step-5',source:'step-4',target:'step-5',relation:'next',pathType:'core',editable:false})
  ]);

  function clone(value){
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }
  function createSvg(name,attributes={}){
    const element=document.createElementNS(SVG_NS,name);
    Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,String(value)));
    return element;
  }
  function cardStep(cardId){
    const match=String(cardId||'').match(/(\d+)$/);
    return match?Number(match[1]):0;
  }
  function ensureMarkers(defs){
    if(!defs||defs.querySelector('#qtPathArrowDefault'))return;
    const markers=[
      {id:'qtPathArrowDefault',color:'#aab4c4'},
      {id:'qtPathArrowActive',color:'#6d5dfc'},
      {id:'qtPathArrowDone',color:'#16a34a'}
    ];
    markers.forEach(item=>{
      const marker=createSvg('marker',{
        id:item.id,
        markerWidth:10,
        markerHeight:10,
        refX:8,
        refY:5,
        orient:'auto-start-reverse',
        markerUnits:'strokeWidth'
      });
      marker.appendChild(createSvg('path',{
        d:'M 0 0 L 10 5 L 0 10 z',
        fill:item.color
      }));
      defs.appendChild(marker);
    });
  }
  function normalizedBounds(record){
    const layout=record?.layout||{};
    const x=Number(layout.x||0);
    const y=Number(layout.y||0);
    const width=Math.max(1,Number(layout.width||1));
    const height=Math.max(1,Number(layout.height||1));
    return {
      x,y,width,height,
      left:x,right:x+width,top:y,bottom:y+height,
      centerX:x+width/2,centerY:y+height/2
    };
  }
  function anchors(sourceRecord,targetRecord){
    const source=normalizedBounds(sourceRecord);
    const target=normalizedBounds(targetRecord);
    const dx=target.centerX-source.centerX;
    const dy=target.centerY-source.centerY;
    const horizontal=Math.abs(dx)>=Math.abs(dy);

    if(horizontal){
      const direction=dx>=0?1:-1;
      return {
        source:{x:direction>0?source.right:source.left,y:source.centerY},
        target:{x:direction>0?target.left:target.right,y:target.centerY},
        axis:'horizontal',
        direction
      };
    }
    const direction=dy>=0?1:-1;
    return {
      source:{x:source.centerX,y:direction>0?source.bottom:source.top},
      target:{x:target.centerX,y:direction>0?target.top:target.bottom},
      axis:'vertical',
      direction
    };
  }
  function pathFor(sourceRecord,targetRecord){
    const anchor=anchors(sourceRecord,targetRecord);
    const source=anchor.source;
    const target=anchor.target;
    if(anchor.axis==='horizontal'){
      const distance=Math.abs(target.x-source.x);
      const control=Math.max(90,Math.min(360,distance*.46));
      return [
        'M',source.x.toFixed(1),source.y.toFixed(1),
        'C',(source.x+anchor.direction*control).toFixed(1),source.y.toFixed(1),
        (target.x-anchor.direction*control).toFixed(1),target.y.toFixed(1),
        target.x.toFixed(1),target.y.toFixed(1)
      ].join(' ');
    }
    const distance=Math.abs(target.y-source.y);
    const control=Math.max(90,Math.min(330,distance*.46));
    return [
      'M',source.x.toFixed(1),source.y.toFixed(1),
      'C',source.x.toFixed(1),(source.y+anchor.direction*control).toFixed(1),
      target.x.toFixed(1),(target.y-anchor.direction*control).toFixed(1),
      target.x.toFixed(1),target.y.toFixed(1)
    ].join(' ');
  }

  function create(options={}){
    const svg=options.svg||null;
    const defs=options.defs||svg?.querySelector?.('defs')||null;
    const group=options.group||svg?.querySelector?.('#qtCanvasEdges')||null;
    const getCard=typeof options.getCard==='function'?options.getCard:()=>null;
    let edges=(options.edges||DEFAULT_EDGES).map(edge=>({...edge}));
    let selectedCardId='';
    let lastState={mode:'guided',currentStep:1,maxVisited:1,completed:false};

    if(!svg||!group)throw new Error('LearningPathEdges 缺少 SVG 宿主。');
    ensureMarkers(defs);

    function edgeState(edge,state){
      const sourceStep=cardStep(edge.source);
      const targetStep=cardStep(edge.target);
      const incident=!!selectedCardId&&(edge.source===selectedCardId||edge.target===selectedCardId);
      const dimmed=!!selectedCardId&&!incident;
      const done=!!state.completed||targetStep<=Number(state.currentStep||1);
      const current=!state.completed&&(
        sourceStep===Number(state.currentStep||1)||
        targetStep===Number(state.currentStep||1)
      );
      return {incident,dimmed,done,current};
    }
    function markerFor(status){
      if(status.incident||status.current)return 'url(#qtPathArrowActive)';
      if(status.done)return 'url(#qtPathArrowDone)';
      return 'url(#qtPathArrowDefault)';
    }
    function render(state={}){
      lastState={...lastState,...state};
      group.innerHTML='';
      edges.forEach(edge=>{
        const source=getCard(edge.source);
        const target=getCard(edge.target);
        if(!source||!target)return;
        const d=pathFor(source,target);
        const anchor=anchors(source,target);
        const status=edgeState(edge,lastState);
        const wrapper=createSvg('g',{
          class:[
            'qt-canvas-edge',
            'path-'+String(edge.pathType||'optional'),
            status.incident?'is-active':'',
            status.dimmed?'is-dimmed':'',
            status.done?'is-done':'',
            status.current?'is-current':''
          ].filter(Boolean).join(' '),
          'data-edge-id':edge.id,
          'data-source':edge.source,
          'data-target':edge.target
        });
        wrapper.appendChild(createSvg('path',{
          class:'qt-canvas-edge-glow',
          d
        }));
        wrapper.appendChild(createSvg('path',{
          class:'qt-canvas-edge-line',
          d,
          'marker-end':markerFor(status)
        }));
        wrapper.appendChild(createSvg('circle',{
          class:'qt-canvas-edge-port qt-canvas-edge-port-source',
          cx:anchor.source.x.toFixed(1),
          cy:anchor.source.y.toFixed(1),
          r:4
        }));
        wrapper.appendChild(createSvg('circle',{
          class:'qt-canvas-edge-port qt-canvas-edge-port-target',
          cx:anchor.target.x.toFixed(1),
          cy:anchor.target.y.toFixed(1),
          r:4
        }));
        group.appendChild(wrapper);
      });
      svg.dataset.selectedCard=selectedCardId;
      return group.childElementCount;
    }
    function setSelectedCard(cardId){
      selectedCardId=edges.some(edge=>edge.source===cardId||edge.target===cardId)?String(cardId||''):'';
      render(lastState);
      return selectedCardId;
    }
    function clearSelection(){
      selectedCardId='';
      render(lastState);
    }
    function connectedCardIds(cardId){
      const result=new Set();
      edges.forEach(edge=>{
        if(edge.source===cardId)result.add(edge.target);
        if(edge.target===cardId)result.add(edge.source);
      });
      return [...result];
    }
    function incoming(cardId){
      return edges.filter(edge=>edge.target===cardId).map(clone);
    }
    function outgoing(cardId){
      return edges.filter(edge=>edge.source===cardId).map(clone);
    }
    function reachableFrom(cardId){
      const visited=new Set();
      const queue=[String(cardId||'')];
      while(queue.length){
        const current=queue.shift();
        if(!current||visited.has(current))continue;
        visited.add(current);
        outgoing(current).forEach(edge=>{
          if(!visited.has(edge.target))queue.push(edge.target);
        });
      }
      visited.delete(String(cardId||''));
      return [...visited];
    }
    function replaceEdges(nextEdges=[]){
      edges=nextEdges.map(edge=>({
        relation:'next',
        pathType:'optional',
        editable:true,
        ...clone(edge)
      })).filter(edge=>edge.id&&edge.source&&edge.target);
      if(selectedCardId&&!edges.some(edge=>edge.source===selectedCardId||edge.target===selectedCardId)){
        selectedCardId='';
      }
      render(lastState);
      return getEdges();
    }
    function getEdges(){return edges.map(clone)}
    function getSelectedCard(){return selectedCardId}

    return Object.freeze({
      render,
      setSelectedCard,
      clearSelection,
      connectedCardIds,
      incoming,
      outgoing,
      reachableFrom,
      replaceEdges,
      getEdges,
      getSelectedCard
    });
  }

  global.KGLearningPathEdges=Object.freeze({
    DEFAULT_EDGES,
    create,
    pathFor,
    anchors
  });
})(window);
