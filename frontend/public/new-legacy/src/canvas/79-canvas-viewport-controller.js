'use strict';

/*
 * CanvasViewportController v1
 * 单一实现：视口平移、图谱式缩放、动画、坐标转换、自适应点阵与持久化节流。
 */
(function(global){
  const MIN_ZOOM=.01;
  const MAX_ZOOM=4;
  const BUTTON_ZOOM_LEVELS=Object.freeze([.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.50,2,2.50,3,4]);
  const WHEEL_ZOOM_LEVELS=Object.freeze([.01,.02,.03,.04,.05,.07,.09,.11,.13,.17,.21,.26,.33,.41,.51,.64,.80,1,1.20,1.44,1.73,2.07,2.49,2.99,3.58,4]);

  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clone=value=>({x:Number(value.x)||0,y:Number(value.y)||0,zoom:Number(value.zoom)||1});

  function isCoarseSmallScreen(maxWidth=1100){
    const width=global.innerWidth||document.documentElement?.clientWidth||1024;
    const query=global.matchMedia?.('(pointer: coarse)');
    const coarse=query?!!query.matches:Number(global.navigator?.maxTouchPoints||0)>0;
    return coarse&&width<=Number(maxWidth||1100);
  }
  function reduceMotion(){
    return !!global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  }
  function normalizeLevels(levels,min=MIN_ZOOM,max=MAX_ZOOM){
    return [...new Set((Array.isArray(levels)?levels:[]).map(Number).filter(Number.isFinite))]
      .map(value=>clamp(value,min,max))
      .sort((a,b)=>a-b);
  }
  function nextZoomLevel(current,direction,levels=BUTTON_ZOOM_LEVELS,min=MIN_ZOOM,max=MAX_ZOOM){
    const list=normalizeLevels(levels,min,max);
    const value=clamp(finite(current,1),min,max);
    if(direction>0){
      return list.find(item=>item>value+.000001)??max;
    }
    for(let index=list.length-1;index>=0;index--){
      if(list[index]<value-.000001)return list[index];
    }
    return min;
  }
  function ease(value){return 1-Math.pow(1-value,4)}
  function positiveModulo(value,size){return ((value%size)+size)%size}

  function create(options={}){
    const viewport=options.viewport;
    const world=options.world;
    if(!viewport||!world)throw new Error('CanvasViewportController requires viewport and world elements');

    const minZoom=finite(options.minZoom,MIN_ZOOM);
    const maxZoom=finite(options.maxZoom,MAX_ZOOM);
    const gridPrefix=String(options.gridPrefix||'--canvas-grid');
    const gridLodAttribute=String(options.gridLodAttribute||'gridLod');
    const smoothClass=String(options.smoothClass||'is-smooth-zooming');
    const persistDelay=Math.max(0,finite(options.persistDelay,380));
    const onApply=typeof options.onApply==='function'?options.onApply:()=>{};
    const onPersist=typeof options.onPersist==='function'?options.onPersist:()=>{};
    const afterApply=typeof options.afterApply==='function'?options.afterApply:()=>{};
    const policyApi=options.policy&&typeof options.policy.can==='function'
      ?options.policy
      :global.KGCanvasPolicy?.create?.(options.policy||{})||{can:()=>true};

    let state={
      x:finite(options.initial?.x,0),
      y:finite(options.initial?.y,0),
      zoom:clamp(finite(options.initial?.zoom,1),minZoom,maxZoom),
      mobile:!!options.mobile
    };
    let animationFrame=0;
    let animationToken=0;
    let animationTarget=null;
    let persistTimer=null;
    let panGesture=null;

    function canPanZoom(){
      return !state.mobile&&policyApi.can('panZoom')!==false;
    }
    function snapshot(){
      return {...state};
    }
    function updateGrid(){
      if(state.mobile)return;
      let worldGrid=Math.max(1,finite(options.baseWorldGrid,24));
      let screenGrid=worldGrid*state.zoom;
      const minScreen=Math.max(4,finite(options.minGridScreen,12));
      const maxScreen=Math.max(minScreen,finite(options.maxGridScreen,42));
      while(screenGrid<minScreen){
        worldGrid*=2;
        screenGrid=worldGrid*state.zoom;
      }
      while(screenGrid>maxScreen&&worldGrid>3){
        worldGrid/=2;
        screenGrid=worldGrid*state.zoom;
      }
      const major=screenGrid*Math.max(2,finite(options.majorGridMultiple,4));
      viewport.style.setProperty(gridPrefix+'-size',screenGrid.toFixed(3)+'px');
      viewport.style.setProperty(gridPrefix+'-major-size',major.toFixed(3)+'px');
      viewport.style.setProperty(gridPrefix+'-x',positiveModulo(state.x,screenGrid).toFixed(3)+'px');
      viewport.style.setProperty(gridPrefix+'-y',positiveModulo(state.y,screenGrid).toFixed(3)+'px');
      viewport.style.setProperty(gridPrefix+'-major-x',positiveModulo(state.x,major).toFixed(3)+'px');
      viewport.style.setProperty(gridPrefix+'-major-y',positiveModulo(state.y,major).toFixed(3)+'px');
      viewport.dataset[gridLodAttribute]=state.zoom<.2?'far':state.zoom>1.8?'near':'normal';
    }
    function apply(){
      if(state.mobile){
        world.style.transform='none';
      }else{
        world.style.transform='translate3d('+state.x.toFixed(3)+'px,'+state.y.toFixed(3)+'px,0) scale('+state.zoom.toFixed(5)+')';
        updateGrid();
      }
      onApply(snapshot());
      afterApply(snapshot());
      return snapshot();
    }
    function cancelAnimation(){
      if(animationFrame)cancelAnimationFrame(animationFrame);
      animationFrame=0;
      animationTarget=null;
      animationToken+=1;
      viewport.classList.remove(smoothClass);
    }
    function schedulePersist(){
      clearTimeout(persistTimer);
      persistTimer=setTimeout(()=>{
        persistTimer=null;
        onPersist(snapshot());
      },persistDelay);
    }
    function cancelPersist(){
      clearTimeout(persistTimer);
      persistTimer=null;
    }
    function setMobile(mobile){
      const next=!!mobile;
      if(next===state.mobile)return snapshot();
      cancelAnimation();
      panGesture=null;
      state.mobile=next;
      apply();
      return snapshot();
    }
    function set(next={},setOptions={}){
      cancelAnimation();
      if(Number.isFinite(Number(next.x)))state.x=Number(next.x);
      if(Number.isFinite(Number(next.y)))state.y=Number(next.y);
      if(Number.isFinite(Number(next.zoom)))state.zoom=clamp(Number(next.zoom),minZoom,maxZoom);
      apply();
      if(setOptions.persist!==false)schedulePersist();
      return snapshot();
    }
    function sync(next={}){
      if(Number.isFinite(Number(next.x)))state.x=Number(next.x);
      if(Number.isFinite(Number(next.y)))state.y=Number(next.y);
      if(Number.isFinite(Number(next.zoom)))state.zoom=clamp(Number(next.zoom),minZoom,maxZoom);
      if(next.mobile!==undefined)state.mobile=!!next.mobile;
      apply();
      return snapshot();
    }
    function targetForScale(scale,clientX,clientY){
      const rect=viewport.getBoundingClientRect();
      const cx=Number.isFinite(Number(clientX))?Number(clientX)-rect.left:rect.width/2;
      const cy=Number.isFinite(Number(clientY))?Number(clientY)-rect.top:rect.height/2;
      const worldX=(cx-state.x)/Math.max(minZoom,state.zoom);
      const worldY=(cy-state.y)/Math.max(minZoom,state.zoom);
      const zoom=clamp(finite(scale,1),minZoom,maxZoom);
      return {
        x:cx-worldX*zoom,
        y:cy-worldY*zoom,
        zoom
      };
    }
    function animateTo(target={},animationOptions={}){
      if(!canPanZoom())return false;
      const persist=animationOptions.persist!==false;
      const duration=Math.max(0,finite(animationOptions.duration,180));
      const start=clone(state);
      const end={
        x:Number.isFinite(Number(target.x))?Number(target.x):start.x,
        y:Number.isFinite(Number(target.y))?Number(target.y):start.y,
        zoom:clamp(finite(target.zoom,start.zoom),minZoom,maxZoom)
      };
      const distance=Math.hypot(end.x-start.x,end.y-start.y)+Math.abs(end.zoom-start.zoom)*220;
      cancelAnimation();
      const token=++animationToken;
      animationTarget={...end,source:String(animationOptions.source||'viewport')};
      if(animationOptions.instant||reduceMotion()||duration<=0||distance<.35){
        state={...state,...end};
        animationTarget=null;
        apply();
        if(persist)schedulePersist();
        return true;
      }
      viewport.classList.add(smoothClass);
      const started=performance.now();
      const step=now=>{
        if(token!==animationToken)return;
        const progress=clamp((now-started)/duration,0,1);
        const eased=ease(progress);
        state.x=start.x+(end.x-start.x)*eased;
        state.y=start.y+(end.y-start.y)*eased;
        state.zoom=start.zoom+(end.zoom-start.zoom)*eased;
        apply();
        if(progress<1){
          animationFrame=requestAnimationFrame(step);
          return;
        }
        animationFrame=0;
        state={...state,...end};
        animationTarget=null;
        viewport.classList.remove(smoothClass);
        apply();
        if(persist)schedulePersist();
      };
      animationFrame=requestAnimationFrame(step);
      return true;
    }
    function zoomAt(scale,clientX,clientY,zoomOptions={}){
      if(!canPanZoom())return false;
      return animateTo(targetForScale(scale,clientX,clientY),{
        duration:finite(zoomOptions.duration,180),
        persist:zoomOptions.persist,
        instant:zoomOptions.instant,
        source:zoomOptions.source||'zoom'
      });
    }
    function zoomByLevel(direction,levels,clientX,clientY,zoomOptions={}){
      const sameSource=animationTarget&&animationTarget.source===(zoomOptions.source||'zoom');
      const base=sameSource?animationTarget.zoom:state.zoom;
      return zoomAt(
        nextZoomLevel(base,direction,levels,minZoom,maxZoom),
        clientX,
        clientY,
        zoomOptions
      );
    }
    function clientToWorld(clientX,clientY){
      const rect=viewport.getBoundingClientRect();
      if(state.mobile){
        return {x:Number(clientX)-rect.left,y:Number(clientY)-rect.top};
      }
      return {
        x:(Number(clientX)-rect.left-state.x)/state.zoom,
        y:(Number(clientY)-rect.top-state.y)/state.zoom
      };
    }
    function worldToClient(worldX,worldY){
      const rect=viewport.getBoundingClientRect();
      if(state.mobile){
        return {x:rect.left+Number(worldX),y:rect.top+Number(worldY)};
      }
      return {
        x:rect.left+state.x+Number(worldX)*state.zoom,
        y:rect.top+state.y+Number(worldY)*state.zoom
      };
    }
    function fitBounds(bounds={},fitOptions={}){
      if(!canPanZoom())return false;
      const rect=viewport.getBoundingClientRect();
      const padding=Math.max(0,finite(fitOptions.padding,100));
      const width=Math.max(1,finite(bounds.width,finite(bounds.right)-finite(bounds.left)));
      const height=Math.max(1,finite(bounds.height,finite(bounds.bottom)-finite(bounds.top)));
      const left=finite(bounds.left,0);
      const top=finite(bounds.top,0);
      const zoom=clamp(Math.min(
        (rect.width-padding)/width,
        (rect.height-padding)/height,
        finite(fitOptions.maxZoom,1)
      ),minZoom,maxZoom);
      return animateTo({
        zoom,
        x:rect.width/2-(left+width/2)*zoom,
        y:rect.height/2-(top+height/2)*zoom
      },{
        duration:finite(fitOptions.duration,260),
        persist:fitOptions.persist,
        instant:fitOptions.instant,
        source:fitOptions.source||'fit'
      });
    }
    function focusBounds(bounds={},focusOptions={}){
      if(state.mobile)return false;
      const rect=viewport.getBoundingClientRect();
      const width=Math.max(1,finite(bounds.width,finite(bounds.right)-finite(bounds.left)));
      const height=Math.max(1,finite(bounds.height,finite(bounds.bottom)-finite(bounds.top)));
      const left=finite(bounds.left,0);
      const top=finite(bounds.top,0);
      const zoom=clamp(
        Number.isFinite(Number(focusOptions.zoom))
          ?Number(focusOptions.zoom)
          :Math.min(
            finite(focusOptions.maxZoom,1),
            Math.max(
              finite(focusOptions.minZoom,.5),
              Math.min((rect.width-100)/width,(rect.height-90)/height)
            )
          ),
        minZoom,
        maxZoom
      );
      return animateTo({
        zoom,
        x:rect.width/2-(left+width/2)*zoom,
        y:rect.height/2-(top+height/2)*zoom
      },{
        duration:finite(focusOptions.duration,230),
        persist:focusOptions.persist,
        instant:focusOptions.instant,
        source:focusOptions.source||'focus'
      });
    }
    function beginPan(event,panOptions={}){
      const allowedButtons=Array.isArray(panOptions.allowedButtons)&&panOptions.allowedButtons.length
        ?panOptions.allowedButtons.map(Number)
        :[0];
      if(!canPanZoom()||!allowedButtons.includes(Number(event.button)))return false;
      if(typeof panOptions.shouldStart==='function'&&!panOptions.shouldStart(event))return false;
      cancelAnimation();
      panGesture={
        pointerId:event.pointerId,
        startX:event.clientX,
        startY:event.clientY,
        originX:state.x,
        originY:state.y
      };
      viewport.classList.add(String(panOptions.activeClass||'is-panning'));
      viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
      return true;
    }
    function movePan(event){
      if(!panGesture||panGesture.pointerId!==event.pointerId)return false;
      state.x=panGesture.originX+(event.clientX-panGesture.startX);
      state.y=panGesture.originY+(event.clientY-panGesture.startY);
      apply();
      return true;
    }
    function endPan(event,endOptions={}){
      if(!panGesture||panGesture.pointerId!==event.pointerId)return false;
      panGesture=null;
      viewport.classList.remove(String(endOptions.activeClass||'is-panning'));
      if(endOptions.persist!==false)schedulePersist();
      return true;
    }
    function destroy(){
      cancelAnimation();
      cancelPersist();
      panGesture=null;
    }

    apply();

    return Object.freeze({
      MIN_ZOOM:minZoom,
      MAX_ZOOM:maxZoom,
      BUTTON_ZOOM_LEVELS,
      WHEEL_ZOOM_LEVELS,
      getState:snapshot,
      getAnimationTarget:()=>animationTarget?{...animationTarget}:null,
      canPanZoom,
      setMobile,
      set,
      sync,
      apply,
      updateGrid,
      cancelAnimation,
      schedulePersist,
      cancelPersist,
      targetForScale,
      animateTo,
      zoomAt,
      zoomByLevel,
      clientToWorld,
      worldToClient,
      fitBounds,
      focusBounds,
      beginPan,
      movePan,
      endPan,
      hasPanGesture:()=>!!panGesture,
      nextZoomLevel:(current,direction,levels)=>nextZoomLevel(current,direction,levels,minZoom,maxZoom),
      destroy
    });
  }

  global.KGCanvasViewportController=Object.freeze({
    MIN_ZOOM,
    MAX_ZOOM,
    BUTTON_ZOOM_LEVELS,
    WHEEL_ZOOM_LEVELS,
    isCoarseSmallScreen,
    reduceMotion,
    normalizeLevels,
    nextZoomLevel,
    create
  });
})(window);
