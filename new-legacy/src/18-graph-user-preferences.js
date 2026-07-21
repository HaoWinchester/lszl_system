"use strict";

/*
 * 图谱用户偏好设置。
 *
 * 设计目标：
 * - 偏好属于当前浏览器用户，不写入图谱文件，避免影响学习包共享。
 * - 通过 documentElement class 切换视觉效果，避免逐节点改 DOM。
 * - 高性能模式主要关闭阴影、玻璃模糊、动画、关系标签和渐变，降低大图谱场景下的重绘与合成成本。
 */
(function(){
  const STORAGE_KEY = "kg_graph_user_preferences_v1";
  const CHANGE_EVENT = "kg-graph-preferences-change";
  const PRESET_LABELS = {
    quality: "精致",
    balanced: "平衡",
    performance: "高性能",
    custom: "自定义"
  };
  const DEFAULT_PREFS = Object.freeze({
    performancePreset: "quality",
    shadows: true,
    blur: true,
    animations: true,
    relationLabels: true,
    gradients: true,
    deferEdgesDuringDrag: true,
    largeGraphMode: true
  });
  const PRESET_PREFS = Object.freeze({
    quality: {
      performancePreset: "quality",
      shadows: true,
      blur: true,
      animations: true,
      relationLabels: true,
      gradients: true,
      deferEdgesDuringDrag: true,
      largeGraphMode: true
    },
    balanced: {
      performancePreset: "balanced",
      shadows: true,
      blur: false,
      animations: true,
      relationLabels: true,
      gradients: true,
      deferEdgesDuringDrag: true,
      largeGraphMode: true
    },
    performance: {
      performancePreset: "performance",
      shadows: false,
      blur: false,
      animations: false,
      relationLabels: false,
      gradients: false,
      deferEdgesDuringDrag: true,
      largeGraphMode: true
    }
  });

  let prefs = sanitizePrefs(readPrefs());
  let menuEl = null, launcherMenuEl = null, fileSubmenuEl = null, exportSubmenuEl = null;
  let openState = false, launcherOpenState = false, activeLauncherSubmenu = null;

  function $(id){return document.getElementById(id)}

  function clone(value){
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizePrefs(input){
    const base = clone(DEFAULT_PREFS);
    const src = input && typeof input === "object" ? input : {};
    const preset = String(src.performancePreset || base.performancePreset);
    base.performancePreset = Object.prototype.hasOwnProperty.call(PRESET_LABELS, preset) ? preset : "custom";
    ["shadows","blur","animations","relationLabels","gradients","deferEdgesDuringDrag","largeGraphMode"].forEach(key=>{
      if(Object.prototype.hasOwnProperty.call(src, key)) base[key] = !!src[key];
    });
    return base;
  }

  function readPrefs(){
    const store = window.KGAppStorage;
    if(store && typeof store.readJSON === "function") return store.readJSON(STORAGE_KEY, DEFAULT_PREFS);
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : clone(DEFAULT_PREFS);
    }catch(e){
      return clone(DEFAULT_PREFS);
    }
  }

  function emitPreferencesChange(nextPrefs, changedKeys){
    if(!changedKeys || !changedKeys.length) return;
    try{
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {detail:{prefs:clone(nextPrefs), changedKeys:changedKeys.slice()}}));
    }catch(e){}
  }

  function writePrefs(nextPrefs){
    const previous = sanitizePrefs(prefs);
    const clean = sanitizePrefs(nextPrefs);
    const changedKeys = Object.keys(clean).filter(key=>clean[key] !== previous[key]);
    const store = window.KGAppStorage;
    let ok = false;
    if(store && typeof store.writeJSON === "function") ok = store.writeJSON(STORAGE_KEY, clean) !== false;
    else{
      try{localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));ok = true}catch(e){ok = false}
    }
    prefs = clean;
    applyPrefs();
    renderMenuState();
    emitPreferencesChange(clean, changedKeys);
    return ok;
  }

  function root(){
    return document.documentElement;
  }

  function applyPrefs(){
    const r = root();
    r.classList.toggle("kg-perf-no-shadows", !prefs.shadows);
    r.classList.toggle("kg-perf-no-blur", !prefs.blur);
    r.classList.toggle("kg-perf-no-animations", !prefs.animations);
    r.classList.toggle("kg-perf-hide-relation-labels", !prefs.relationLabels);
    r.classList.toggle("kg-perf-no-gradients", !prefs.gradients);
    r.classList.toggle("kg-perf-defer-drag-edges", !!prefs.deferEdgesDuringDrag);
    r.classList.toggle("kg-large-graph-mode-disabled", prefs.largeGraphMode === false);
    r.dataset.kgGraphPerformancePreset = prefs.performancePreset || "custom";

    const btn = $("graphPrefsBtn");
    if(btn){
      const label = PRESET_LABELS[prefs.performancePreset] || PRESET_LABELS.custom;
      btn.title = "图谱设置：" + label + "模式";
      btn.setAttribute("aria-label", "打开图谱设置，当前偏好为" + label + "模式");
    }
  }

  function presetLabel(key){
    return PRESET_LABELS[key] || PRESET_LABELS.custom;
  }

  function ensureMenu(){
    if(menuEl && document.body.contains(menuEl)) return menuEl;
    menuEl = document.createElement("aside");
    menuEl.id = "graphPrefsMenu";
    menuEl.className = "graph-prefs-menu";
    menuEl.dataset.stageUi = "true";
    menuEl.hidden = true;
    menuEl.setAttribute("role", "dialog");
    menuEl.setAttribute("aria-label", "图谱偏好设置");
    menuEl.innerHTML = `
      <div class="graph-prefs-head">
        <div>
          <strong>偏好设置</strong>
          <span>关闭高消耗视觉效果可提升大图谱流畅度</span>
        </div>
        <button type="button" class="graph-prefs-close" aria-label="关闭偏好设置">×</button>
      </div>
      <div class="graph-prefs-section">
        <div class="graph-prefs-section-title">性能模式</div>
        <div class="graph-prefs-presets" role="group" aria-label="性能模式">
          <button type="button" data-preset="quality">精致</button>
          <button type="button" data-preset="balanced">平衡</button>
          <button type="button" data-preset="performance">高性能</button>
        </div>
      </div>
      <div class="graph-prefs-section">
        <div class="graph-prefs-section-title">性能与视觉效果</div>
        <label class="graph-prefs-toggle graph-prefs-toggle-important"><input type="checkbox" data-pref="largeGraphMode"><span>大图模式</span></label>
        <label class="graph-prefs-toggle graph-prefs-toggle-important"><input type="checkbox" data-pref="deferEdgesDuringDrag"><span>拖动时延迟刷新连接线</span></label>
        <label class="graph-prefs-toggle"><input type="checkbox" data-pref="shadows"><span>卡牌与面板阴影</span></label>
        <label class="graph-prefs-toggle"><input type="checkbox" data-pref="blur"><span>玻璃模糊效果</span></label>
        <label class="graph-prefs-toggle"><input type="checkbox" data-pref="animations"><span>动画过渡</span></label>
        <label class="graph-prefs-toggle"><input type="checkbox" data-pref="relationLabels"><span>关系线标签</span></label>
        <label class="graph-prefs-toggle"><input type="checkbox" data-pref="gradients"><span>卡牌渐变背景</span></label>
      </div>
      <div class="graph-prefs-note">建议：卡牌较多或多选拖动卡顿时，优先切换到“高性能”，并保持“大图模式”和“拖动时延迟刷新连接线”开启。开启大图模式后，任何数量的卡牌都会使用大图渲染策略；关闭后按普通图谱模式显示，关系线较多时可能变卡。偏好仅保存在当前浏览器，不会写入图谱文件。</div>
    `;
    document.body.appendChild(menuEl);

    menuEl.addEventListener("pointerdown", event=>event.stopPropagation());
    menuEl.addEventListener("click", event=>{
      event.stopPropagation();
      const presetBtn = event.target && event.target.closest && event.target.closest("[data-preset]");
      if(presetBtn){
        const preset = presetBtn.dataset.preset;
        if(PRESET_PREFS[preset]) writePrefs(PRESET_PREFS[preset]);
        return;
      }
      if(event.target && event.target.closest && event.target.closest(".graph-prefs-close")){
        closeMenu();
      }
    });
    menuEl.addEventListener("change", event=>{
      const input = event.target;
      if(!input || !input.matches || !input.matches("input[data-pref]")) return;
      const key = input.dataset.pref;
      writePrefs({...prefs, [key]: !!input.checked, performancePreset: "custom"});
    });
    return menuEl;
  }

  function renderMenuState(){
    if(!menuEl) return;
    menuEl.querySelectorAll("[data-preset]").forEach(btn=>{
      const active = btn.dataset.preset === prefs.performancePreset;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    menuEl.querySelectorAll("input[data-pref]").forEach(input=>{
      input.checked = !!prefs[input.dataset.pref];
    });
    const modeTitle = menuEl.querySelector(".graph-prefs-section-title");
    if(modeTitle){
      const label = presetLabel(prefs.performancePreset);
      modeTitle.textContent = "性能模式" + (prefs.performancePreset === "custom" ? "（自定义）" : "（" + label + "）");
    }
  }

  function clamp(n, min, max){
    return Math.max(min, Math.min(max, n));
  }

  function placeMenu(options={}){
    const btn = $("graphPrefsBtn");
    const menu = ensureMenu();
    if(!btn) return;
    const asSubmenu = !!options.asSubmenu || (launcherOpenState && activeLauncherSubmenu === "preferences" && launcherMenuEl && !launcherMenuEl.hidden);
    const anchor = options.anchor || (asSubmenu && launcherMenuEl ? launcherMenuEl.querySelector('[data-meta-submenu="preferences"]') : btn);
    const width = Math.min(320, Math.max(280, window.innerWidth - 16));
    menu.style.width = width + "px";
    menu.style.maxHeight = "calc(100vh - 16px)";
    menu.style.overflowY = "auto";
    let left, top;
    if(asSubmenu && anchor && launcherMenuEl){
      const anchorRect = anchor.getBoundingClientRect();
      const launcherRect = launcherMenuEl.getBoundingClientRect();
      left = launcherRect.right + 8;
      if(left + width > window.innerWidth - 8) left = launcherRect.left - width - 8;
      top = anchorRect.top - 8;
    }else{
      const rect = btn.getBoundingClientRect();
      left = rect.left;
      top = rect.bottom + 8;
    }
    left = clamp(left, 8, window.innerWidth - width - 8);
    const preferredHeight = Math.min(menu.scrollHeight || 440, window.innerHeight - 16);
    top = clamp(top, 8, window.innerHeight - preferredHeight - 8);
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  function openMenu(options={}){
    const menu = ensureMenu();
    openState = true;
    if(options.asSubmenu) activeLauncherSubmenu = "preferences";
    renderMenuState();
    menu.hidden = false;
    menu.classList.add("show");
    placeMenu(options);
    const btn = $("graphPrefsBtn");
    if(btn) btn.setAttribute("aria-expanded", "true");
  }

  function closeMenu(options={}){
    if(!menuEl) return;
    openState = false;
    menuEl.classList.remove("show");
    menuEl.hidden = true;
    if(activeLauncherSubmenu === "preferences") activeLauncherSubmenu = null;
    const btn = $("graphPrefsBtn");
    if(btn && !launcherOpenState) btn.setAttribute("aria-expanded", "false");
    if(!options.keepLauncher) markLauncherActive(null);
  }

  function toggleMenu(){
    if(openState) closeMenu();
    else openMenu();
  }

  function graphMetaIcon(name){
    const icons = {
      file: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z"/><path d="M14 3.5V8h4"/></svg>',
      pref: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/></svg>',
      add: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
      import: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15V3M7 10l5 5 5-5"/><path d="M5 14v6h14v-6"/></svg>',
      export: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/></svg>',
      zip: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z"/><path d="M14 3.5V8h4"/><path d="M9.5 12h5M9.5 15h5"/></svg>',
      png: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M7 17l4-4 3 3 2-2 2 3"/></svg>',
      pdf: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z"/><path d="M14 3.5V8h4"/><path d="M8.8 16.5h2.4a1.5 1.5 0 0 0 0-3H8.8v5"/><path d="M14 13.5v5h1.4a2.5 2.5 0 0 0 0-5H14z"/></svg>'
    };
    return icons[name] || "";
  }

  function markLauncherActive(kind){
    if(!launcherMenuEl) return;
    launcherMenuEl.querySelectorAll('[data-meta-submenu]').forEach(btn=>{
      const active = !!kind && btn.dataset.metaSubmenu === kind;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-expanded', active ? 'true' : 'false');
    });
  }

  function ensureLauncherMenu(){
    if(launcherMenuEl && document.body.contains(launcherMenuEl)) return launcherMenuEl;
    launcherMenuEl = document.createElement("aside");
    launcherMenuEl.id = "graphMetaActionsMenu";
    launcherMenuEl.className = "graph-meta-actions-menu graph-meta-cascade-menu";
    launcherMenuEl.dataset.stageUi = "true";
    launcherMenuEl.hidden = true;
    launcherMenuEl.setAttribute("role", "menu");
    launcherMenuEl.setAttribute("aria-label", "图谱设置菜单：文件与偏好设置");
    launcherMenuEl.innerHTML = `
      <div class="graph-meta-cascade-list">
        <button type="button" class="graph-meta-cascade-item" data-meta-submenu="file" aria-haspopup="menu" aria-expanded="false" role="menuitem">
          ${graphMetaIcon('file')}
          <span>文件</span>
          <span class="graph-meta-cascade-chevron" aria-hidden="true">›</span>
        </button>
        <button type="button" class="graph-meta-cascade-item" data-meta-submenu="preferences" aria-haspopup="dialog" aria-expanded="false" role="menuitem">
          ${graphMetaIcon('pref')}
          <span>偏好设置</span>
          <span class="graph-meta-cascade-chevron" aria-hidden="true">›</span>
        </button>
      </div>
    `;
    document.body.appendChild(launcherMenuEl);
    launcherMenuEl.addEventListener("pointerdown", event=>event.stopPropagation());
    launcherMenuEl.addEventListener("pointerover", event=>{
      const item = event.target && event.target.closest && event.target.closest('[data-meta-submenu]');
      if(!item || !launcherMenuEl.contains(item)) return;
      showLauncherSubmenu(item.dataset.metaSubmenu, item);
    });
    launcherMenuEl.addEventListener("focusin", event=>{
      const item = event.target && event.target.closest && event.target.closest('[data-meta-submenu]');
      if(!item || !launcherMenuEl.contains(item)) return;
      showLauncherSubmenu(item.dataset.metaSubmenu, item);
    });
    launcherMenuEl.addEventListener("click", event=>{
      const item = event.target && event.target.closest && event.target.closest('[data-meta-submenu]');
      if(!item || !launcherMenuEl.contains(item)) return;
      event.preventDefault();
      event.stopPropagation();
      showLauncherSubmenu(item.dataset.metaSubmenu, item);
    });
    return launcherMenuEl;
  }

  function ensureFileSubmenu(){
    if(fileSubmenuEl && document.body.contains(fileSubmenuEl)) return fileSubmenuEl;
    fileSubmenuEl = document.createElement("aside");
    fileSubmenuEl.id = "graphMetaFileSubmenu";
    fileSubmenuEl.className = "graph-meta-actions-submenu graph-meta-file-submenu";
    fileSubmenuEl.dataset.stageUi = "true";
    fileSubmenuEl.hidden = true;
    fileSubmenuEl.setAttribute("role", "menu");
    fileSubmenuEl.setAttribute("aria-label", "图谱文件");
    fileSubmenuEl.innerHTML = `
      <button type="button" class="graph-meta-file-action" data-meta-file-action="new" role="menuitem">${graphMetaIcon('add')}<span>新建</span></button>
      <button type="button" class="graph-meta-file-action" data-meta-file-action="import" role="menuitem">${graphMetaIcon('import')}<span>导入</span></button>
      <button type="button" class="graph-meta-file-action graph-meta-file-export-action" data-meta-export-menu="true" aria-haspopup="menu" aria-expanded="false" role="menuitem">
        ${graphMetaIcon('export')}<span>导出</span><span class="graph-meta-cascade-chevron" aria-hidden="true">›</span>
      </button>
    `;
    document.body.appendChild(fileSubmenuEl);
    fileSubmenuEl.addEventListener("pointerdown", event=>event.stopPropagation());
    fileSubmenuEl.addEventListener("pointerover", event=>{
      const exportItem = event.target && event.target.closest && event.target.closest('[data-meta-export-menu]');
      if(exportItem && fileSubmenuEl.contains(exportItem)){
        showExportSubmenu(exportItem);
        return;
      }
      const actionItem = event.target && event.target.closest && event.target.closest('[data-meta-file-action]');
      if(actionItem && fileSubmenuEl.contains(actionItem)) closeExportSubmenu();
    });
    fileSubmenuEl.addEventListener("focusin", event=>{
      const exportItem = event.target && event.target.closest && event.target.closest('[data-meta-export-menu]');
      if(exportItem && fileSubmenuEl.contains(exportItem)) showExportSubmenu(exportItem);
    });
    fileSubmenuEl.addEventListener("click", event=>{
      event.stopPropagation();
      const exportItem = event.target && event.target.closest && event.target.closest('[data-meta-export-menu]');
      if(exportItem && fileSubmenuEl.contains(exportItem)){
        event.preventDefault();
        showExportSubmenu(exportItem);
        return;
      }
      const fileBtn = event.target && event.target.closest && event.target.closest("[data-meta-file-action]");
      if(!fileBtn) return;
      const action = fileBtn.dataset.metaFileAction;
      closeAllGraphMetaMenus();
      if(action === "new"){
        if(window.KGGraphFileTabs && typeof window.KGGraphFileTabs.createFile === "function") window.KGGraphFileTabs.createFile();
        else if(typeof showStatus === "function") showStatus("图谱文件服务尚未就绪。");
        return;
      }
      if(action === "import"){
        if(typeof authRequire === "function" && !authRequire("登录后才能导入图谱文件。", "importData")) return;
        const input = $("importFile");
        if(input) input.click();
        else if(typeof showStatus === "function") showStatus("导入控件尚未就绪。");
      }
    });
    return fileSubmenuEl;
  }

  function runGraphExportAction(format){
    if(format === "zip"){
      if(typeof exportLearningPackage === "function") exportLearningPackage().catch(err=>alert("导出学习包失败：" + (err.message || err)));
      else if(typeof showStatus === "function") showStatus("导出服务尚未就绪。");
      return;
    }
    const service = window.KGGraphExportService;
    if(!service || typeof service.exportVisual !== "function"){
      if(typeof showStatus === "function") showStatus("图片 / PDF 导出服务尚未就绪。");
      return;
    }
    service.exportVisual(format).catch(err=>alert("导出" + (format === "pdf" ? " PDF" : " PNG") + "失败：" + (err.message || err)));
  }

  function ensureExportSubmenu(){
    if(exportSubmenuEl && document.body.contains(exportSubmenuEl)) return exportSubmenuEl;
    exportSubmenuEl = document.createElement("aside");
    exportSubmenuEl.id = "graphMetaExportSubmenu";
    exportSubmenuEl.className = "graph-meta-actions-submenu graph-meta-export-submenu";
    exportSubmenuEl.dataset.stageUi = "true";
    exportSubmenuEl.hidden = true;
    exportSubmenuEl.setAttribute("role", "menu");
    exportSubmenuEl.setAttribute("aria-label", "导出格式");
    exportSubmenuEl.innerHTML = `
      <button type="button" class="graph-meta-file-action" data-meta-export-format="zip" role="menuitem">${graphMetaIcon('zip')}<span>学习包 ZIP</span></button>
      <button type="button" class="graph-meta-file-action" data-meta-export-format="png" role="menuitem">${graphMetaIcon('png')}<span>PNG 图片</span></button>
      <button type="button" class="graph-meta-file-action" data-meta-export-format="pdf" role="menuitem">${graphMetaIcon('pdf')}<span>PDF 文档</span></button>
    `;
    document.body.appendChild(exportSubmenuEl);
    exportSubmenuEl.addEventListener("pointerdown", event=>event.stopPropagation());
    exportSubmenuEl.addEventListener("click", event=>{
      event.stopPropagation();
      const btn = event.target && event.target.closest && event.target.closest("[data-meta-export-format]");
      if(!btn) return;
      const format = btn.dataset.metaExportFormat;
      closeAllGraphMetaMenus();
      runGraphExportAction(format);
    });
    return exportSubmenuEl;
  }

  function placeSubmenu(menu, anchor, width, parentMenu){
    if(!menu || !anchor || !launcherMenuEl) return;
    const anchorRect = anchor.getBoundingClientRect();
    const parentRect = (parentMenu || launcherMenuEl).getBoundingClientRect();
    const w = Math.min(width, Math.max(160, window.innerWidth - 16));
    menu.style.width = w + "px";
    menu.style.maxHeight = "calc(100vh - 16px)";
    menu.style.overflowY = "auto";
    let left = parentRect.right + 8;
    if(left + w > window.innerWidth - 8) left = parentRect.left - w - 8;
    left = clamp(left, 8, window.innerWidth - w - 8);
    const preferredHeight = Math.min(menu.scrollHeight || 160, window.innerHeight - 16);
    const top = clamp(anchorRect.top - 2, 8, window.innerHeight - preferredHeight - 8);
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  function closeExportSubmenu(){
    if(!exportSubmenuEl) return;
    exportSubmenuEl.classList.remove("show");
    exportSubmenuEl.hidden = true;
    const exportItem = fileSubmenuEl && fileSubmenuEl.querySelector('[data-meta-export-menu]');
    if(exportItem){
      exportItem.classList.remove('active');
      exportItem.setAttribute('aria-expanded', 'false');
    }
  }

  function closeFileSubmenu(){
    closeExportSubmenu();
    if(!fileSubmenuEl) return;
    fileSubmenuEl.classList.remove("show");
    fileSubmenuEl.hidden = true;
    if(activeLauncherSubmenu === "file") activeLauncherSubmenu = null;
  }

  function showExportSubmenu(anchor){
    if(!launcherOpenState || !fileSubmenuEl || fileSubmenuEl.hidden) return;
    const item = anchor || fileSubmenuEl.querySelector('[data-meta-export-menu]');
    if(!item) return;
    const menu = ensureExportSubmenu();
    item.classList.add('active');
    item.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    menu.classList.add('show');
    placeSubmenu(menu, item, 186, fileSubmenuEl);
  }

  function showLauncherSubmenu(kind, anchor){
    if(!launcherOpenState) return;
    activeLauncherSubmenu = kind;
    markLauncherActive(kind);
    if(kind === "file"){
      closeMenu({keepLauncher:true});
      const menu = ensureFileSubmenu();
      menu.hidden = false;
      menu.classList.add("show");
      placeSubmenu(menu, anchor || launcherMenuEl.querySelector('[data-meta-submenu="file"]'), 178);
      return;
    }
    if(kind === "preferences"){
      closeFileSubmenu();
      openMenu({asSubmenu:true, anchor:anchor || launcherMenuEl.querySelector('[data-meta-submenu="preferences"]')});
    }
  }

  function placeLauncherMenu(){
    const btn = $("graphPrefsBtn");
    const menu = ensureLauncherMenu();
    if(!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(178, Math.max(154, window.innerWidth - 16));
    const left = clamp(rect.left, 8, window.innerWidth - width - 8);
    const top = clamp(rect.bottom + 8, 8, window.innerHeight - 80);
    menu.style.width = width + "px";
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  function openLauncherMenu(){
    const menu = ensureLauncherMenu();
    launcherOpenState = true;
    activeLauncherSubmenu = null;
    closeMenu({keepLauncher:true});
    closeFileSubmenu();
    markLauncherActive(null);
    placeLauncherMenu();
    menu.hidden = false;
    menu.classList.add("show");
    const btn = $("graphPrefsBtn");
    if(btn) btn.setAttribute("aria-expanded", "true");
  }

  function closeLauncherMenu(){
    if(!launcherMenuEl) return;
    launcherOpenState = false;
    activeLauncherSubmenu = null;
    launcherMenuEl.classList.remove("show");
    launcherMenuEl.hidden = true;
    markLauncherActive(null);
    closeFileSubmenu();
    closeMenu({keepLauncher:true});
    const btn = $("graphPrefsBtn");
    if(btn) btn.setAttribute("aria-expanded", "false");
  }

  function closeAllGraphMetaMenus(){
    closeLauncherMenu();
  }

  function toggleLauncherMenu(){
    if(launcherOpenState) closeLauncherMenu();
    else openLauncherMenu();
  }

  function bindButton(){
    const btn = $("graphPrefsBtn");
    if(!btn || btn.dataset.graphPrefsBound === "1") return;
    btn.dataset.graphPrefsBound = "1";
    btn.addEventListener("click", event=>{
      event.preventDefault();
      event.stopPropagation();
      toggleLauncherMenu();
    });
    btn.addEventListener("keydown", event=>{
      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        event.stopPropagation();
        toggleLauncherMenu();
      }
    });
  }

  function bindGlobalGuards(){
    document.addEventListener("click", event=>{
      const btn = $("graphPrefsBtn");
      const target = event.target;
      const inside = (btn && btn.contains(target)) ||
        (launcherMenuEl && launcherMenuEl.contains(target)) ||
        (fileSubmenuEl && fileSubmenuEl.contains(target)) ||
        (exportSubmenuEl && exportSubmenuEl.contains(target)) ||
        (menuEl && menuEl.contains(target));
      if((openState || launcherOpenState) && !inside) closeAllGraphMetaMenus();
    });
    document.addEventListener("keydown", event=>{
      if(event.key === "Escape" && (openState || launcherOpenState)) closeAllGraphMetaMenus();
    });
    const refreshPlacement = ()=>{
      if(launcherOpenState) placeLauncherMenu();
      if(activeLauncherSubmenu === "file" && fileSubmenuEl && !fileSubmenuEl.hidden){
        placeSubmenu(fileSubmenuEl, launcherMenuEl && launcherMenuEl.querySelector('[data-meta-submenu="file"]'), 178);
      }
      if(exportSubmenuEl && !exportSubmenuEl.hidden && fileSubmenuEl && !fileSubmenuEl.hidden){
        placeSubmenu(exportSubmenuEl, fileSubmenuEl.querySelector('[data-meta-export-menu]'), 186, fileSubmenuEl);
      }
      if(openState) placeMenu({asSubmenu: launcherOpenState && activeLauncherSubmenu === "preferences"});
    };
    window.addEventListener("resize", refreshPlacement);
    window.addEventListener("scroll", refreshPlacement, true);
  }

  applyPrefs();
  bindButton();
  bindGlobalGuards();

  window.KGGraphUserPreferences = {
    get:()=>clone(prefs),
    set:nextPrefs=>writePrefs(nextPrefs),
    apply:applyPrefs,
    open:openMenu,
    openLauncher:openLauncherMenu,
    close:()=>{closeMenu();closeLauncherMenu()},
    presets:clone(PRESET_PREFS),
    CHANGE_EVENT
  };
})();
