"use strict";

/*
 * 首页左侧工具栏配置注册表。
 *
 * 目标：
 * - 工具按钮结构、分组、权限、提示文案集中维护。
 * - index.html 不再散落大量 data-permission。
 * - 保留原按钮 id，继续兼容 src/20-flashcards-toolbar.js 等旧事件绑定逻辑。
 *
 * 下一步可继续把 handler 也迁移到这里，形成完整 Tool Registry。
 */
(function(){
  const ICONS = {
    grip: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="8" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="1" fill="currentColor" stroke="none"/></svg>',
    add: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    template: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M10 10v10"/></svg>',
    focus: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    flow: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3.5c3.2 2.2 6 5.2 6 9.2 0 3.5-2.6 6.3-6 7.8-3.4-1.5-6-4.3-6-7.8 0-4 2.8-7 6-9.2z"/><path d="M9 12.5h6M12 9.5v6"/></svg>',
    flashcard: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="3"/><path d="M8 8h8M8 12h6M8 16h4"/></svg>',
    question: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.5 9a2.8 2.8 0 1 1 4.6 2.1c-1.2.9-2.1 1.5-2.1 3"/><circle cx="12" cy="18" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/></svg>',
    small: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    big: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>',
    solid: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16"/></svg>',
    dashed: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h3M10 12h4M17 12h3"/></svg>',
    color: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3s5 5.2 5 9a5 5 0 0 1-10 0c0-3.8 5-9 5-9z"/></svg>',
    fit: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/><rect x="8" y="8" width="8" height="8" rx="2"/></svg>',
    pointerArrow: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3l13 8-6 1.2 3.7 6.2-2.8 1.6-3.6-6.1L5 18V3z"/></svg>',
    pointerHand: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V13"/><path d="M8 12l-1.1-1.1a1.6 1.6 0 0 0-2.3 2.2l4.2 5.1A5.5 5.5 0 0 0 13 20h1a5 5 0 0 0 5-5v-3.5a1.5 1.5 0 0 0-3 0V13"/></svg>',
    relations: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 8.4 10.6 15.6M15.8 8.4 13.4 15.6M8.5 7h7"/></svg>',
    search: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
    zoomIn: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6"/></svg>',
    zoomOut: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M7.5 10.5h6"/></svg>',
    export: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/></svg>',
    import: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15V3M7 10l5 5 5-5"/><path d="M5 14v6h14v-6"/></svg>',
    reset: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7v5h5"/><path d="M5.5 12a7 7 0 1 0 2-5"/></svg>',
    dotted: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h.01M10 12h.01M15 12h.01M20 12h.01"/></svg>',
    style: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 18h16"/><path d="M6 7h5M15 7h3"/><path d="M6 12h3M13 12h5"/></svg>',
    size: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="6" width="7" height="7" rx="2"/><rect x="13" y="5" width="7" height="14" rx="3"/></svg>'
  };

  const HOME_TOOL_GROUPS = [
    {
      id: "create-learning",
      tools: [
        {id:"addBtn", label:"新增知识点", tooltip:"新增知识点", icon:"add", shortcut:"N", className:"primary", permission:"editGraph", action:"addNode", shortTip:"新增"},
        {id:"templateBtn", label:"模板", ariaLabel:"选择模板", tooltip:"模板", icon:"template", shortcut:"T", permission:"editGraph", action:"openTemplate", shortTip:"模板"},
        {id:"focusBtn", label:"重点聚焦", tooltip:"重点聚焦", icon:"focus", shortcut:"F", className:"focus-menu-btn", action:"toggleFocus", shortTip:"聚焦"},
        {id:"flashcardBtn", label:"记忆闪卡", tooltip:"记忆闪卡", icon:"flashcard", shortcut:"K", className:"flash-menu-btn", permission:"editGraph", action:"openFlashcards", shortTip:"闪卡"}
      ]
    },
    {
      id: "style",
      tools: [
        {id:"sizeMenuBtn", type:"menu", label:"尺寸", ariaLabel:"卡牌尺寸", tooltip:"卡牌尺寸", icon:"size", permission:"editGraph", shortTip:"尺寸", children:[
          {id:"sizeSmallBtn", label:"小卡", icon:"small", action:"setSmallCards", shortcut:"1"},
          {id:"sizeDefaultBtn", label:"默认", icon:"size", action:"setDefaultCards", shortcut:"`"},
          {id:"sizeBigBtn", label:"大卡", icon:"big", action:"setBigCards", shortcut:"2"}
        ]},
        {id:"lineStyleMenuBtn", type:"menu", label:"线型", ariaLabel:"关系线样式", tooltip:"关系线样式", icon:"style", permission:"editGraph", shortTip:"线型", children:[
          {id:"lineSolidBtn", label:"实线", icon:"solid", action:"setSolidLine", shortcut:"S"},
          {id:"lineDashedBtn", label:"虚线", icon:"dashed", action:"setDashedLine", shortcut:"D"},
          {id:"lineDottedBtn", label:"点线", icon:"dotted", action:"setDottedLine"},
          {id:"pathStraightBtn", label:"直线", icon:"solid", action:"setStraightPath"},
          {id:"pathElbowBtn", label:"折线", icon:"relations", action:"setElbowPath"},
          {id:"pathCurveBtn", label:"曲线", icon:"flow", action:"setCurvePath"}
        ]},
        {id:"lineColorPicker", label:"颜色", ariaLabel:"线条/卡牌颜色", tooltip:"线/卡颜色", title:"线条/卡牌颜色", icon:"color", type:"color", shortcut:"C", shortcutAction:"openLineColorPicker", permission:"editGraph", action:"setLineColor", event:"input", shortTip:"颜色"}
      ]
    },
    {
      id: "view",
      tools: [
        {id:"pointerModeBtn", label:"箭头", ariaLabel:"箭头/手型切换", tooltip:"编辑模式", shortcut:"V", icon:"pointerArrow", action:"togglePointerMode", shortTip:"选择/手型"},
        {id:"flowModeBtn", label:"心流", ariaLabel:"心流模式开关", tooltip:"心流模式", shortcut:"L", icon:"flow", action:"toggleFlowMode", shortTip:"心流"},
        {id:"relationViewMenuBtn", type:"menu", label:"关系", ariaLabel:"关系显示", tooltip:"关系显示", icon:"relations", shortTip:"关系", children:[
          {id:"largeGraphLinesBtn", label:"主干/骨架", ariaLabel:"主干线 / 骨架线开关", icon:"relations", action:"toggleLargeGraphOverview", shortcut:"G"},
          {id:"largeGraphRelatedBtn", label:"只看相关", ariaLabel:"大图谱只看相关开关", icon:"focus", action:"toggleLargeGraphRelated", shortcut:"R"}
        ]}
      ]
    },
    {
      id: "hidden-file-input",
      tools: [
        {id:"importFile", type:"file", accept:".zip,application/zip,application/x-zip-compressed,.json,application/json", action:"importLearningPackage", event:"change"}
      ]
    }
  ];

  function escapeHTML(value){
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "'":"&#39;",
      '"':"&quot;"
    }[c]));
  }
  function shortcutSuffix(tool){
    return tool && tool.shortcut ? ` ${tool.shortcut}` : "";
  }
  function textWithShortcut(text, tool){
    const value = tool && tool.shortTip ? tool.shortTip : (text || "");
    return value && tool && tool.shortcut ? `${value}${shortcutSuffix(tool)}` : value;
  }
  function attrsForTool(tool, options={}){
    const attrs = [];
    if(!options.skipId) attrs.push(`id="${escapeHTML(tool.id)}"`);
    if(tool.permission){
      attrs.push(`data-permission="${escapeHTML(tool.permission)}"`);
      attrs.push('data-permission-mode="hide"');
    }
    if(tool.shortcut) attrs.push(`data-shortcut="${escapeHTML(tool.shortcut)}"`);
    if(tool.tooltip || tool.shortTip) attrs.push(`data-tooltip="${escapeHTML(textWithShortcut(tool.tooltip || tool.label || '', tool))}"`);
    return attrs.join(" ");
  }
  function renderSubTool(tool){
    const classes = ["floating-subtool-btn", tool.className || ""].filter(Boolean).join(" ");
    return `<button aria-label="${escapeHTML(textWithShortcut(tool.ariaLabel || tool.label, tool))}" class="${escapeHTML(classes)}" ${attrsForTool(tool)} type="button">${ICONS[tool.icon] || ""}<span>${escapeHTML(tool.label || "")}</span></button>`;
  }
  function renderTool(tool){
    if(tool.type === "file"){
      return `<input accept="${escapeHTML(tool.accept || '')}" id="${escapeHTML(tool.id)}" type="file" hidden/>`;
    }
    if(tool.type === "color"){
      return `<label aria-label="${escapeHTML(textWithShortcut(tool.ariaLabel || tool.label, tool))}" class="floating-tool-btn floating-color-tool" ${attrsForTool(tool, {skipId:true})}>${ICONS[tool.icon] || ""}<span class="floating-color-swatch"></span><input id="${escapeHTML(tool.id)}" type="color" value="#2563eb"/></label>`;
    }
    if(tool.type === "menu"){
      const classes = ["floating-tool-btn", "floating-menu-trigger", tool.className || ""].filter(Boolean).join(" ");
      const children = (tool.children || []).map(renderSubTool).join("");
      return `<div class="floating-tool-menu-shell" id="${escapeHTML(tool.id)}Shell">
        <button aria-expanded="false" aria-haspopup="menu" aria-label="${escapeHTML(textWithShortcut(tool.ariaLabel || tool.label, tool))}" class="${escapeHTML(classes)}" ${attrsForTool(tool)} type="button">${ICONS[tool.icon] || ""}</button>
        <div class="floating-submenu" role="menu" aria-label="${escapeHTML(tool.label || "子菜单")}">${children}</div>
      </div>`;
    }
    const classes = ["floating-tool-btn", tool.className || ""].filter(Boolean).join(" ");
    return `<button aria-label="${escapeHTML(textWithShortcut(tool.ariaLabel || tool.label, tool))}" class="${escapeHTML(classes)}" ${attrsForTool(tool)} type="button">${ICONS[tool.icon] || ""}</button>`;
  }

  let toolbarActions = {};
  function flattenTools(){
    return HOME_TOOL_GROUPS.flatMap(group => group.tools || []).flatMap(tool => tool && tool.children ? [tool, ...tool.children] : [tool]);
  }
  function syncMenuTriggerFromSubtool(event){
    const target = event && event.target;
    const subBtn = target && target.closest && target.closest('.floating-subtool-btn');
    if(!subBtn) return;
    const shell = subBtn.closest('.floating-tool-menu-shell');
    const trigger = shell && shell.querySelector('.floating-menu-trigger');
    const icon = subBtn.querySelector('svg');
    if(trigger && icon){
      trigger.innerHTML = icon.outerHTML;
      trigger.dataset.currentSubtool = subBtn.id || '';
    }
    if(shell){
      shell.querySelectorAll('.floating-subtool-btn').forEach(btn=>btn.classList.toggle('active-toggle', btn===subBtn));
    }
  }
  function runToolAction(tool, event){
    if(!tool || !tool.action) return;
    const handler = toolbarActions[tool.action];
    if(typeof handler !== "function"){
      console.warn("[KGHomeToolbarRegistry] missing action handler:", tool.action);
      return;
    }
    handler(event, tool);
    syncMenuTriggerFromSubtool(event);
    if(event && event.target && event.target.closest) closeFloatingSubmenus();
  }
  function isTextEditingTarget(target){
    const el = target && target.closest && target.closest('input,textarea,select,[contenteditable]');
    return !!(el && (!el.hasAttribute || el.getAttribute('contenteditable') !== 'false'));
  }
  function hasOpenModal(){
    return !!document.querySelector('.modal-backdrop.show,.related-canvas-backdrop,.edge-inline-label-editor.show');
  }
  function shortcutMatches(tool, event){
    if(!tool || !tool.shortcut) return false;
    const key = String(event.key || '').toLowerCase();
    const candidates = [tool.shortcut, ...(tool.shortcutKeys || [])].map(v => String(v || '').toLowerCase());
    return candidates.includes(key);
  }
  function elementAllowsShortcut(tool){
    if(!tool || !tool.id) return false;
    const el = document.getElementById(tool.id);
    if(!el || el.disabled || el.hidden) return false;
    const host = el.closest('[hidden], .permission-hidden');
    if(host) return false;
    const styleTarget = el.type === 'color' && el.parentElement ? el.parentElement : el;
    const style = window.getComputedStyle ? window.getComputedStyle(styleTarget) : null;
    if(style && (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none')) return false;
    return true;
  }
  function handleToolbarShortcut(event){
    if(event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if(isTextEditingTarget(event.target) || hasOpenModal()) return;
    const tool = flattenTools().find(item => item.shortcut && shortcutMatches(item, event));
    if(!tool || !elementAllowsShortcut(tool)) return;
    const actionName = tool.shortcutAction || tool.action;
    const handler = toolbarActions[actionName];
    if(typeof handler !== "function") return;
    event.preventDefault();
    event.stopPropagation();
    handler(event, tool);
  }
  if(!window.__KGHomeToolbarShortcutBound){
    window.__KGHomeToolbarShortcutBound = true;
    document.addEventListener('keydown', handleToolbarShortcut);
  }

  function closeFloatingSubmenus(exceptShell=null){
    document.querySelectorAll('.floating-tool-menu-shell.menu-open').forEach(shell=>{
      if(shell===exceptShell)return;
      shell.classList.remove('menu-open');
      const trigger=shell.querySelector('.floating-menu-trigger');
      if(trigger)trigger.setAttribute('aria-expanded','false');
    });
  }
  function bindMenuShells(){
    document.querySelectorAll('.floating-tool-menu-shell').forEach(shell=>{
      if(shell.dataset.menuBound==='1')return;
      shell.dataset.menuBound='1';
      const trigger=shell.querySelector('.floating-menu-trigger');
      if(!trigger)return;
      trigger.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        const open=!shell.classList.contains('menu-open');
        closeFloatingSubmenus(shell);
        shell.classList.toggle('menu-open',open);
        trigger.setAttribute('aria-expanded',open?'true':'false');
      });
      trigger.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '||event.key==='ArrowRight'){
          event.preventDefault();
          event.stopPropagation();
          closeFloatingSubmenus(shell);
          shell.classList.add('menu-open');
          trigger.setAttribute('aria-expanded','true');
          const first=shell.querySelector('.floating-submenu button');
          if(first)first.focus();
        }
      });
    });
  }
  if(!window.__KGHomeToolbarMenuGlobalBound){
    window.__KGHomeToolbarMenuGlobalBound=true;
    document.addEventListener('pointerdown',event=>{
      if(!event.target.closest||!event.target.closest('.floating-tool-menu-shell'))closeFloatingSubmenus();
    },true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeFloatingSubmenus()});
  }
  function bindHandlers(){
    bindMenuShells();
    flattenTools().forEach(tool => {
      if(!tool.id || !tool.action) return;
      const el = document.getElementById(tool.id);
      if(!el) return;
      const eventName = tool.event || "click";
      const boundKey = "toolbarAction" + eventName.charAt(0).toUpperCase() + eventName.slice(1);
      if(el.dataset[boundKey] === tool.action) return;
      const listener = event => runToolAction(tool, event);
      el.addEventListener(eventName, listener);
      el.dataset[boundKey] = tool.action;
    });
    if(typeof toolbarActions.initToolbarDrag === "function"){
      toolbarActions.initToolbarDrag();
    }
  }
  function registerActions(actions={}){
    toolbarActions = {...toolbarActions, ...actions};
    bindHandlers();
  }

  function renderToolbar(){
    const box = document.getElementById("floatingToolbox");
    if(!box) return;
    box.innerHTML = `
      <button aria-label="拖动工具菜单" class="floating-toolbox-handle" id="floatingToolboxHandle" title="按住拖动菜单" type="button">${ICONS.grip}</button>
      <div class="floating-toolbox-grid">
        ${HOME_TOOL_GROUPS.filter(group => (group.tools || []).some(tool => tool.type !== "file")).map((group, groupIndex) => {
          const html = group.tools.filter(tool => tool.type !== "file").map(renderTool).join("\n");
          return `${groupIndex ? '<div aria-hidden="true" class="floating-toolbox-divider"></div>' : ''}${html}`;
        }).join("\n")}
        ${HOME_TOOL_GROUPS.flatMap(group => group.tools || []).filter(tool => tool.type === "file").map(renderTool).join("\n")}
      </div>
    `;
    box.dataset.renderedBy = "home-toolbar-registry";

    const roleApi = window.KGRolePermissions;
    if(roleApi && typeof roleApi.decoratePermissionElements === "function"){
      roleApi.decoratePermissionElements(box);
    }
    bindHandlers();
  }

  window.KGHomeToolbarRegistry = {
    groups: HOME_TOOL_GROUPS,
    render: renderToolbar,
    bindHandlers,
    registerActions,
    hideTransientMenus:()=>closeFloatingSubmenus()
  };

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderToolbar);
  else renderToolbar();
})();
