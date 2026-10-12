'use strict';

// Keyboard ownership and unscaled overlay hosts shared by the three canvases.
(function(global){
  function editable(element){
    for(let el=element?.nodeType===3?element.parentElement:element;el;el=el.parentElement||el.getRootNode?.().host){
      if(['INPUT','TEXTAREA','SELECT'].includes(el.tagName))return true;
      if(el.hasAttribute?.('contenteditable')){
        const value=String(el.getAttribute('contenteditable')).toLowerCase();
        if(value==='false')return false;
        if(value===''||value==='true'||value==='plaintext-only')return true;
      }
    }
    return false;
  }
  function isEditingTarget(eventOrElement){
    if(!eventOrElement)return false;
    if(eventOrElement.isComposing||eventOrElement.keyCode===229)return true;
    const target=eventOrElement.target||eventOrElement;
    const path=eventOrElement.composedPath?.()||[target];
    if(editable(path.find(el=>el?.nodeType===1||el?.nodeType===3)))return true;
    const doc=target.ownerDocument||global.document;
    return editable(doc?.activeElement);
  }
  function overlayHost(surface){
    const doc=surface?.ownerDocument||global.document;
    return doc.fullscreenElement||doc.webkitFullscreenElement||surface||doc.body;
  }
  // Keep one real DOM node and a placeholder, including when fullscreen exits.
  function mountOverlay(element,surface,onMove){
    const doc=element.ownerDocument||global.document,home=surface||doc.body;
    if(!element.parentNode)home.appendChild(element);
    const marker=doc.createComment('canvas-overlay-home');
    element.parentNode.insertBefore(marker,element);
    function sync(){
      const host=overlayHost(home);
      if(host===home&&marker.parentNode){
        if(element.parentNode!==marker.parentNode)marker.parentNode.insertBefore(element,marker.nextSibling);
      }else if(element.parentNode!==host)host.appendChild(element);
      if(onMove)onMove(host);
    }
    doc.addEventListener('fullscreenchange',sync);
    doc.addEventListener('webkitfullscreenchange',sync);
    sync();
    return ()=>{
      doc.removeEventListener('fullscreenchange',sync);doc.removeEventListener('webkitfullscreenchange',sync);
      if(marker.parentNode)marker.parentNode.insertBefore(element,marker.nextSibling);
      marker.remove();
    };
  }
  const api=Object.freeze({isEditingTarget,overlayHost,mountOverlay});
  global.KGCanvasDomInteraction=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
