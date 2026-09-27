'use strict';

/* Capture the visible canvas, without requesting screen-sharing or changing live DOM. */
(function(global){
  const UI='[data-canvas-ui],[data-stage-ui],.canvas-ink-toolbar,.qw-overlay,.qw-question-drawer,.qw-canvas-summary-dock,.qw-bottom-right-dock,.qw-selection-toolbar,.qw-diagnostics-panel,.kr-canvas-overlay-left,.kr-canvas-overlay-right,.kr-canvas-summary-dock,.kr-question-drawer,.lp-canvas-zoom-dock,.uc-minimap,.uc-minimap-dock,.canvas-zoom-dock,.floating-toolbox,.canvas-toolbar-left,.canvas-toolbar-right,.help-card,.detail-panel,.status-chip,.home-node-toolbox,.qw-card-icon-action,.qw-card-width-resize,.qw-connector-handle,.kr-node-handle,script,style,link';
  const icon='<svg class="canvas-ink-entry-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></svg>';
  function blobData(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(blob)})}
  async function capture(viewport,options={}){
    if(!viewport?.isConnected)throw new Error('当前画布不可截图');
    const rect=viewport.getBoundingClientRect(),width=Math.round(rect.width),height=Math.round(rect.height);
    if(width<1||height<1)throw new Error('当前画布不可见');
    await document.fonts?.ready;
    const resources=new Map();
    function resource(url){
      if(url.startsWith('data:'))return Promise.resolve(url);
      if(!resources.has(url))resources.set(url,(async()=>{const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('画布图片载入失败，请重试');return blobData(await response.blob())})());
      return resources.get(url);
    }
    function style(source,target,pseudo){
      const css=getComputedStyle(source,pseudo);for(const name of css)target.style.setProperty(name,css.getPropertyValue(name));
      target.style.setProperty('animation','none','important');target.style.setProperty('transition','none','important');target.style.setProperty('caret-color','transparent');
      return css;
    }
    let count=0;
    async function clone(source,isRoot=false){
      if(source.nodeType===3)return source.cloneNode();
      if(source.nodeType!==1||(!isRoot&&source.matches(options.exclude?UI+','+options.exclude:UI)))return null;
      const css=getComputedStyle(source);if(css.display==='none'||css.visibility==='hidden')return null;
      const box=source.getBoundingClientRect(),outside=box.right<=rect.left||box.left>=rect.right||box.bottom<=rect.top||box.top>=rect.bottom;
      // Keep overflowing/transformed ancestors, but never fetch invisible pictures.
      if(!isRoot&&outside&&(source instanceof HTMLImageElement||source instanceof HTMLCanvasElement||box.width>0&&box.height>0&&['hidden','clip'].includes(css.overflow)))return null;
      if(++count>15000)throw new Error('当前画布内容过多，请缩小截图范围后重试');
      let target=source.cloneNode(false);style(source,target);
      for(const attribute of [...target.attributes])if(attribute.name.startsWith('on'))target.removeAttribute(attribute.name);
      if(source instanceof HTMLImageElement){target.removeAttribute('srcset');target.removeAttribute('loading');target.src=await resource(source.currentSrc||source.src)}
      if(source instanceof HTMLCanvasElement){target=document.createElement('img');style(source,target);target.src=source.toDataURL()}
      const background=css.backgroundImage;
      if(background.includes('url(')){
        let resolved=background;for(const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g))resolved=resolved.replace(match[0],'url("'+await resource(new URL(match[1],document.baseURI).href)+'")');target.style.backgroundImage=resolved;
      }
      const pseudo=(name)=>{if(source.namespaceURI!=='http://www.w3.org/1999/xhtml')return null;const pc=getComputedStyle(source,name);if(pc.content==='none'||pc.content==='normal'||pc.display==='none')return null;const el=document.createElement('span');style(source,el,name);el.textContent=pc.content.replace(/^["']|["']$/g,'');return el};
      const before=pseudo('::before');if(before)target.append(before);
      for(const child of source.childNodes){const copy=await clone(child);if(copy)target.append(copy)}
      const after=pseudo('::after');if(after)target.append(after);
      if(source instanceof HTMLInputElement)target.setAttribute('value',source.value);
      if(source instanceof HTMLTextAreaElement)target.textContent=source.value;
      if(source.scrollTop||source.scrollLeft){const wrapper=document.createElement('div');wrapper.style.transform=`translate(${-source.scrollLeft}px,${-source.scrollTop}px)`;wrapper.append(...target.childNodes);target.append(wrapper)}
      return target;
    }
    const copy=await clone(viewport,true);
    Object.assign(copy.style,{position:'relative',left:'0px',top:'0px',right:'auto',bottom:'auto',margin:'0px',transform:'none',width:width+'px',height:height+'px',overflow:'hidden'});
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',width);svg.setAttribute('height',height);const content=document.createElementNS(svg.namespaceURI,'foreignObject');content.setAttribute('width','100%');content.setAttribute('height','100%');content.append(copy);svg.append(content);
    const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await image.decode();
    const ratio=Math.min(global.devicePixelRatio||1,2,8192/Math.max(width,height),Math.sqrt(16000000/(width*height)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法生成截图');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('截图生成失败')),'image/png'));
    canvas.width=canvas.height=0;return blob;
  }
  function bind(button,viewport,options={}){
    if(!button||button.dataset.captureBound)return;button.dataset.captureBound='1';button.innerHTML=icon;
    let busy=false;
    button.addEventListener('click',async event=>{
      event.preventDefault();event.stopPropagation();if(busy)return;busy=true;button.disabled=true;button.setAttribute('aria-busy','true');
      try{
        const blob=await capture(viewport,options),name=typeof options.filename==='function'?options.filename():options.filename;
        const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=String(name||'画布').replace(/[\\/:*?"<>|]/g,'_')+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      }catch(error){options.onError?.('截图失败：'+(error.message||'请重试'))}
      finally{busy=false;button.disabled=false;button.removeAttribute('aria-busy')}
    });
  }
  global.KGCanvasCapture=Object.freeze({capture,bind,icon});
})(window);
