'use strict';
/* Shared canvas tool presentation; callers retain their existing commands/IDs. */
(function(global){
  const paths={select:'M5 3l14 8-7 2-3 7Z',pen:'m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z',text:'M5 7V5h14v2M12 5v14M9 19h6',eraser:'m14 3 7 7-11 11H6l-4-4ZM8 11l7 7M10 21h12',undo:'M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5',redo:'M21 10H10a6 6 0 0 0 0 12M21 10l-5-5M21 10l-5 5',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',theme:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 0-10Z',save:'M4 3h13l4 4v14H3V3ZM7 3v6h9V3M7 21v-8h10v8',camera:'M3 7h4l2-3h6l2 3h4v13H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',add:'M12 4v16M4 12h16',delete:'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',connect:'M8 5h8M8 19h8M5 8v8M19 8v8M3 3h4v4H3ZM17 17h4v4h-4Z',fit:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',close:'m6 6 12 12M18 6 6 18',highlighter:'m10 15 5 5 7-10-8-8-10 7 5 5M5 15l4 4-4 3-3-3Z',font:'M4 19 10 5l6 14M6 15h8M17 10h5M20 7v12'};
  function icon(name){return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+(paths[name]||paths.settings)+'"/></svg>'}
  function present(button,name,label){
    if(!button)return;
    button.classList.add('canvas-tool-button');button.dataset.canvasUi='true';
    button.innerHTML=icon(name)+'<span class="canvas-tool-label"></span>';button.querySelector('span').textContent=label;
    if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',label);
    if(!button.title)button.title=button.getAttribute('aria-label')||label;
  }
  function group(root,label,items){
    if(!root)return null;root.classList.add('canvas-toolbar');root.setAttribute('role','toolbar');
    const group=document.createElement('div');group.className='canvas-tool-group';group.setAttribute('role','group');group.setAttribute('aria-label',label);
    for(const [button,name,text] of items){if(!button)continue;present(button,name,text);group.append(button)}
    if(group.childElementCount)root.append(group);return group;
  }
  global.KGCanvasToolbar=Object.freeze({icon,present,group});
})(window);
