'use strict';

(function(global){
  const DEFAULT_PRESETS=Object.freeze([
    '#ffffff','#f8fafc','#e2e8f0','#94a3b8','#475569','#0f172a',
    '#fee2e2','#fecaca','#fca5a5','#ef4444','#b91c1c',
    '#ffedd5','#fdba74','#f97316','#c2410c',
    '#fef3c7','#fde68a','#eab308','#a16207',
    '#dcfce7','#86efac','#22c55e','#15803d',
    '#cffafe','#67e8f9','#06b6d4','#0e7490',
    '#dbeafe','#93c5fd','#3b82f6','#1d4ed8',
    '#ede9fe','#c4b5fd','#8b5cf6','#6d28d9',
    '#fce7f3','#f9a8d4','#ec4899','#be185d'
  ]);
  const RECENT_KEY='kg_graph_recent_colors_v1';

  function clamp(value,min,max){const n=Number(value);return Math.min(max,Math.max(min,Number.isFinite(n)?n:min))}
  function normalizeHex(value,fallback='#000000'){
    let text=String(value||'').trim().toLowerCase();
    if(/^#[0-9a-f]{3}$/i.test(text))text='#'+text.slice(1).split('').map(char=>char+char).join('');
    return /^#[0-9a-f]{6}$/i.test(text)?text:fallback;
  }
  function hexToRgb(hex){const value=normalizeHex(hex),n=parseInt(value.slice(1),16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255}}
  function rgbToHex(r,g,b){return'#'+[r,g,b].map(value=>Math.round(clamp(value,0,255)).toString(16).padStart(2,'0')).join('')}
  function rgbToHsv(r,g,b){
    r=clamp(r,0,255)/255;g=clamp(g,0,255)/255;b=clamp(b,0,255)/255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;let h=0;
    if(delta){if(max===r)h=60*(((g-b)/delta)%6);else if(max===g)h=60*((b-r)/delta+2);else h=60*((r-g)/delta+4)}
    if(h<0)h+=360;
    return{h,s:max===0?0:delta/max,v:max};
  }
  function hsvToRgb(h,s,v){
    h=((Number(h)||0)%360+360)%360;s=clamp(s,0,1);v=clamp(v,0,1);
    const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r=0,g=0,b=0;
    if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
    return{r:(r+m)*255,g:(g+m)*255,b:(b+m)*255};
  }
  function hexToHsv(hex){const rgb=hexToRgb(hex);return rgbToHsv(rgb.r,rgb.g,rgb.b)}
  function hsvToHex(h,s,v){const rgb=hsvToRgb(h,s,v);return rgbToHex(rgb.r,rgb.g,rgb.b)}
  function uniqueColors(colors=[]){const out=[];for(const value of colors){const color=normalizeHex(value,'');if(color&&!out.includes(color))out.push(color)}return out}
  function readRecent(){try{return uniqueColors(JSON.parse(localStorage.getItem(RECENT_KEY)||'[]')).slice(0,12)}catch(error){return[]}}
  function rememberColor(color){
    color=normalizeHex(color,'');if(!color)return[];
    const next=[color,...readRecent().filter(item=>item!==color)].slice(0,12);
    try{localStorage.setItem(RECENT_KEY,JSON.stringify(next))}catch(error){}
    return next;
  }
  function checkerBackground(color,opacity){
    const rgb=hexToRgb(color),alpha=clamp(opacity,0,1);
    return `linear-gradient(rgba(${rgb.r},${rgb.g},${rgb.b},${alpha}),rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})),linear-gradient(45deg,#e2e8f0 25%,transparent 25%,transparent 75%,#e2e8f0 75%),linear-gradient(45deg,#e2e8f0 25%,#fff 25%,#fff 75%,#e2e8f0 75%)`;
  }
  function swatchHtml(color){return `<button type="button" class="kg-color-picker-swatch" data-picker-swatch="${color}" aria-label="${color}" title="${color}" style="--picker-swatch:${color}"></button>`}
  function create(options={}){
    const host=options.host;if(!host)throw new Error('color picker host is required');
    const allowOpacity=options.allowOpacity!==false;
    const allowTransparent=options.allowTransparent!==false;
    let color=normalizeHex(options.color||'#ffffff'),opacity=allowOpacity?clamp(options.opacity??1,0,1):1;
    let hsv=hexToHsv(color),active=false,destroyed=false,documentColors=[];
    host.classList.add('kg-color-picker');host.dataset.colorPickerKind=String(options.kind||'color');
    host.innerHTML=`
      <div class="kg-color-picker-sv" data-color-picker-sv role="slider" aria-label="颜色饱和度与亮度" tabindex="0"><span class="kg-color-picker-marker" data-color-picker-marker></span></div>
      <div class="kg-color-picker-slider-row"><span class="kg-color-picker-slider-icon">色相</span><input type="range" min="0" max="360" step="1" value="0" data-color-picker-hue aria-label="色相"></div>
      ${allowOpacity?'<div class="kg-color-picker-slider-row"><span class="kg-color-picker-slider-icon">透明</span><div class="kg-color-picker-alpha-track" data-color-picker-alpha-track><input type="range" min="0" max="100" step="1" value="100" data-color-picker-alpha aria-label="透明度"></div><output data-color-picker-alpha-output>100%</output></div>':''}
      <div class="kg-color-picker-fields"><span class="kg-color-picker-preview" data-color-picker-preview aria-hidden="true"></span><label>#<input type="text" maxlength="6" inputmode="text" spellcheck="false" data-color-picker-hex aria-label="十六进制颜色"></label><button type="button" class="kg-color-picker-eyedropper" data-color-picker-eyedropper aria-label="吸取屏幕颜色" title="吸取屏幕颜色">⌖</button></div>
      ${allowTransparent?'<button type="button" class="kg-color-picker-transparent" data-color-picker-transparent>无填充 / 透明</button>':''}
      <div class="kg-color-picker-section"><span>预设颜色</span><div class="kg-color-picker-swatches" data-color-picker-presets></div></div>
      <div class="kg-color-picker-section" data-color-picker-recent-section><span>最近使用</span><div class="kg-color-picker-swatches" data-color-picker-recent></div></div>
      <div class="kg-color-picker-section" data-color-picker-document-section><span data-color-picker-document-label>${String(options.documentLabel||"当前图谱")}</span><div class="kg-color-picker-swatches" data-color-picker-document></div></div>`;
    const sv=host.querySelector('[data-color-picker-sv]'),marker=host.querySelector('[data-color-picker-marker]'),hue=host.querySelector('[data-color-picker-hue]'),alpha=host.querySelector('[data-color-picker-alpha]'),alphaTrack=host.querySelector('[data-color-picker-alpha-track]'),alphaOutput=host.querySelector('[data-color-picker-alpha-output]'),hexInput=host.querySelector('[data-color-picker-hex]'),preview=host.querySelector('[data-color-picker-preview]'),eyeDropper=host.querySelector('[data-color-picker-eyedropper]');
    let svPointerId=null;
    function emit(name){if(typeof options[name]==='function')options[name]({color,opacity,kind:options.kind||'color'})}
    function begin(){if(active)return;active=true;emit('onStart')}
    function previewChange(){emit('onPreview')}
    function commit(){if(!active)begin();active=false;rememberColor(color);renderPalette();emit('onCommit')}
    function cancel(){if(!active)return;active=false;emit('onCancel')}
    function updateUI(){
      if(destroyed)return;
      sv.style.setProperty('--picker-hue',hsv.h.toFixed(1));marker.style.left=(hsv.s*100)+'%';marker.style.top=((1-hsv.v)*100)+'%';hue.value=String(Math.round(hsv.h));hexInput.value=color.slice(1).toUpperCase();
      preview.style.background=checkerBackground(color,opacity);preview.style.backgroundSize='auto,10px 10px,10px 10px';preview.style.backgroundPosition='0 0,0 0,5px 5px';
      if(alpha){alpha.value=String(Math.round(opacity*100));alphaOutput.textContent=Math.round(opacity*100)+'%';alphaTrack.style.setProperty('--picker-alpha-color',color)}
      host.querySelectorAll('[data-picker-swatch]').forEach(button=>button.classList.toggle('active',button.dataset.pickerSwatch===color));
    }
    function setHSV(nextH,nextS,nextV,shouldPreview=true){hsv={h:((Number(nextH)||0)%360+360)%360,s:clamp(nextS,0,1),v:clamp(nextV,0,1)};color=hsvToHex(hsv.h,hsv.s,hsv.v);updateUI();if(shouldPreview)previewChange()}
    function updateSVFromEvent(event){const rect=sv.getBoundingClientRect();if(!rect.width||!rect.height)return;setHSV(hsv.h,clamp((event.clientX-rect.left)/rect.width,0,1),1-clamp((event.clientY-rect.top)/rect.height,0,1))}
    function renderPalette(){
      host.querySelector('[data-color-picker-presets]').innerHTML=uniqueColors(options.presets||DEFAULT_PRESETS).map(swatchHtml).join('');
      const recent=readRecent(),recentSection=host.querySelector('[data-color-picker-recent-section]');recentSection.hidden=!recent.length;host.querySelector('[data-color-picker-recent]').innerHTML=recent.map(swatchHtml).join('');
      const used=uniqueColors(documentColors).filter(item=>!recent.includes(item)).slice(0,18),documentSection=host.querySelector('[data-color-picker-document-section]');documentSection.hidden=!used.length;host.querySelector('[data-color-picker-document]').innerHTML=used.map(swatchHtml).join('');
      updateUI();
    }
    sv.addEventListener('pointerdown',event=>{if(event.button!==undefined&&event.button!==0)return;begin();svPointerId=event.pointerId;try{sv.setPointerCapture(event.pointerId)}catch(error){}updateSVFromEvent(event);event.preventDefault();event.stopPropagation()});
    sv.addEventListener('pointermove',event=>{if(svPointerId!==event.pointerId)return;updateSVFromEvent(event);event.preventDefault()});
    const finishSV=event=>{if(svPointerId!==event.pointerId)return;try{sv.releasePointerCapture(event.pointerId)}catch(error){}svPointerId=null;commit();event.preventDefault();event.stopPropagation()};
    sv.addEventListener('pointerup',finishSV);sv.addEventListener('pointercancel',event=>{if(svPointerId!==event.pointerId)return;svPointerId=null;cancel()});
    sv.addEventListener('keydown',event=>{const step=event.shiftKey?.05:.01;let s=hsv.s,v=hsv.v;if(event.key==='ArrowLeft')s-=step;else if(event.key==='ArrowRight')s+=step;else if(event.key==='ArrowUp')v+=step;else if(event.key==='ArrowDown')v-=step;else return;event.preventDefault();begin();setHSV(hsv.h,s,v);commit()});
    hue.addEventListener('input',()=>{begin();setHSV(Number(hue.value),hsv.s,hsv.v)});hue.addEventListener('change',commit);
    if(alpha){alpha.addEventListener('input',()=>{begin();opacity=clamp(Number(alpha.value)/100,0,1);updateUI();previewChange()});alpha.addEventListener('change',commit)}
    function commitHex(){const candidate=normalizeHex('#'+hexInput.value,color);begin();color=candidate;hsv=hexToHsv(color);updateUI();previewChange();commit()}
    hexInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitHex()}else if(event.key==='Escape'){event.preventDefault();cancel();updateUI()}});hexInput.addEventListener('change',commitHex);
    host.addEventListener('click',event=>{
      const swatch=event.target.closest('[data-picker-swatch]');if(swatch){begin();color=normalizeHex(swatch.dataset.pickerSwatch,color);hsv=hexToHsv(color);updateUI();previewChange();commit();event.preventDefault();return}
      if(event.target.closest('[data-color-picker-transparent]')){begin();opacity=0;updateUI();previewChange();commit();event.preventDefault()}
    });
    if(!global.EyeDropper)eyeDropper.hidden=true;else eyeDropper.addEventListener('click',async()=>{try{const result=await new global.EyeDropper().open();if(result&&result.sRGBHex){begin();color=normalizeHex(result.sRGBHex,color);hsv=hexToHsv(color);updateUI();previewChange();commit()}}catch(error){}});
    function setValue(next={}){color=normalizeHex(next.color||color,color);opacity=allowOpacity?clamp(next.opacity??opacity,0,1):1;hsv=hexToHsv(color);updateUI();return{color,opacity}}
    function setDocumentColors(colors=[]){documentColors=uniqueColors(colors);renderPalette()}
    function destroy(){destroyed=true;host.innerHTML=''}
    renderPalette();
    return Object.freeze({setValue,setDocumentColors,getValue:()=>({color,opacity}),cancel,destroy});
  }
  global.KGGraphColorPickerController=Object.freeze({create,normalizeHex,hexToRgb,rgbToHex,rgbToHsv,hsvToRgb,hexToHsv,hsvToHex,rememberColor,readRecent,DEFAULT_PRESETS});
})(typeof window!=='undefined'?window:globalThis);
