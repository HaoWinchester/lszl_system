'use strict';

/*
 * KGCanvasTableController · 三个画布页共用的可编辑表格工具（TableV1）。
 *
 * 职责：把 getTables() 渲染为 world 内的真实 DOM table（随画布平移缩放坐标一致，
 * 1px 边框 + 真实文字保证 DPR 清晰度），提供单元格编辑、整体拖动、四边等比缩放、
 * 列宽/行高拖拽、相邻矩形合并/拆分与 Excel/TSV 粘贴。持久化、历史与权限由页面
 * 通过 change/setTables/history/isReadonly 注入，本模块不请求任何业务 API。
 *
 * 历史约定（单次操作 = 一条历史）：
 * - options.change(next, label)：页面自管历史（图谱页 checkpoint/run）；label 为 null 表示
 *   单元格输入等轻量写入，不进历史（页面仍负责持久化）。
 * - options.history（KGCanvasHistoryController 命令栈）：本模块 push {undo,redo} 命令，
 *   undo/redo 经 setTables 回写（多题页 kernel.history）。
 * - 两者都不提供：内部命令栈 + 面板撤销/重做按钮 + Ctrl/⌘+Z（回忆页）。
 */
(function(global){
  const model=()=>global.KGCanvasTableModel;
  const clipboard=()=>global.KGCanvasTableClipboard;
  const LIMITS=Object.freeze({MIN_SIZE:28,MOVE_BAR:16,HANDLE:9,GRID_MAX:10,ROWS_MAX:100,COLS_MAX:50});

  // —— 纯函数（Node 单测覆盖） ——

  // 依据 anchor/focus 计算选择矩形，并扩展覆盖 intersect 的合并区域（合并请求必须整体包含已有合并）。
  function selectionRect(table,anchor,focus){
    if(!table||!anchor)return null;
    const end=focus||anchor;
    let row=Math.min(anchor.row,end.row),column=Math.min(anchor.column,end.column);
    let rowSpan=Math.abs(anchor.row-end.row)+1,columnSpan=Math.abs(anchor.column-end.column)+1;
    const contains=(rect,m)=>rect.row<=m.row&&rect.column<=m.column&&rect.row+rect.rowSpan>=m.row+m.rowSpan&&rect.column+rect.columnSpan>=m.column+m.columnSpan;
    let changed=true;
    while(changed){
      changed=false;
      for(const m of table.merges||[]){
        if(contains({row,column,rowSpan,columnSpan},m))continue;
        if(m.row<row){rowSpan+=row-m.row;row=m.row;changed=true}
        if(m.column<column){columnSpan+=column-m.column;column=m.column;changed=true}
        if(m.row+m.rowSpan>row+rowSpan){rowSpan=m.row+m.rowSpan-row;changed=true}
        if(m.column+m.columnSpan>column+columnSpan){columnSpan=m.column+m.columnSpan-column;changed=true}
      }
    }
    return {row:Math.max(0,row),column:Math.max(0,column),
      rowSpan:Math.min(table.rows-row,rowSpan),columnSpan:Math.min(table.cols-column,columnSpan)};
  }

  // 四边缩放：把一组行高/列宽等比缩放到目标总尺寸，每项不低于 min。
  function scaleSizes(sizes,total,min=LIMITS.MIN_SIZE){
    const list=(Array.isArray(sizes)?sizes:[]).map(Number).filter(n=>Number.isFinite(n)&&n>0);
    const source=list.length?list:[140],sum=source.reduce((a,b)=>a+b,0)||1;
    const factor=Math.max(min*source.length,Math.max(1,total))/sum;
    return source.map(size=>Math.max(min,Math.round(size*factor)));
  }

  // 插入面板/数字输入的行列数钳制：1 起，超上限归上限，非法返回 0。
  function clampGridCount(value,max){
    if(!(typeof value==='number'?Number.isFinite(value):true))return 0;
    const n=Math.round(Number(value));
    if(!Number.isFinite(n)||n<1)return 0;
    return Math.min(n,max);
  }

  // 粘贴数据是否“表格状”（>1 格）：空画布新建表需要，避免普通句子被建成 1×1 表。
  function isTabularGrid(grid){
    if(!grid||!Array.isArray(grid.cells)||!grid.cells.length)return false;
    return grid.cells.length>1||grid.cells[0].length>1;
  }

  function create(options){
    const viewport=options.viewport,world=options.world;
    if(!viewport||!world||typeof options.getTables!=='function')return null;
    const doc=viewport.ownerDocument;
    const readonly=()=>!!options.isReadonly?.();
    const status=message=>{if(message&&typeof options.onStatus==='function')options.onStatus(message)};
    const view=()=>{const v=options.getViewport?.()||{};return{x:Number(v.x)||0,y:Number(v.y)||0,scale:Math.max(.0001,Number(v.scale??v.zoom)||1)}};
    const getTables=()=>{try{const raw=options.getTables();return model()?.sanitizeCollection?model().sanitizeCollection(raw):(Array.isArray(raw)?raw:[])}catch(error){return []}};
    // 写入路径：优先 change（页面自管历史），否则 setTables 直写。
    function applyTables(next,label=null){
      if(typeof options.change==='function')options.change(next,label);
      else if(typeof options.setTables==='function')options.setTables(next);
    }
    const ownHistoryStack=[];let ownRedoStack=[];
    const ownHistory={
      push(command){ownHistoryStack.push(command);if(ownHistoryStack.length>80)ownHistoryStack.shift();ownRedoStack=[]},
      undo(){const command=ownHistoryStack.pop();if(!command)return false;ownRedoStack.push(command);command.undo();return true},
      redo(){const command=ownRedoStack.pop();if(!command)return false;ownHistoryStack.push(command);command.redo();return true},
      getState(){return{canUndo:ownHistoryStack.length>0,canRedo:ownRedoStack.length>0}},
    };
    const pageDrivenHistory=typeof options.change==='function';
    // 整集合替换中只改目标表，兄弟表保持原对象不动（防止单表操作丢失多表画布的其它表）。
    function withTableReplaced(table,replacement){
      return getTables().map(item=>item.id===table.id?replacement:item);
    }
    function mutate(next,label,{transient=false,before=null}={}){
      if(readonly()){status('当前画布只读，不能修改表格');return false}
      const factory=model();if(!factory)return false;
      let normalized;
      try{normalized=next.map(item=>factory.normalize(item))}
      catch(error){status(error?.message||'表格数据无效，已拒绝写入');return false}
      let total=0;
      for(const item of normalized){total+=factory.cellCount(item);if(total>factory.LIMITS.MAX_CELLS_PER_CANVAS){status(`画布单元格总数不能超过 ${factory.LIMITS.MAX_CELLS_PER_CANVAS}`);return false}}
      if(transient){applyTables(normalized);paintRenderedSignature();return true}
      // before：显式传入拖前状态（拖动直写后 getTables() 已是拖后位置，必须用拖前快照进历史）。
      const previous=before||getTables();
      if(pageDrivenHistory){
        // 页面 checkpoint 在 run 调用时捕获：先把拖前状态写回，再走一次带历史的写入，
        // 撤销才能回到拖前位置。
        applyTables(previous,null);
        applyTables(normalized,label);
      }else{
        const command={label:label||'编辑表格',undo:()=>applyTables(previous),redo:()=>applyTables(normalized)};
        if(options.history&&typeof options.history.push==='function')options.history.push(command);
        else ownHistory.push(command);
        applyTables(normalized);
      }
      render({force:true});
      return true;
    }

    // —— DOM 结构 ——
    const layer=doc.createElement('div');
    layer.className='kg-canvas-tables-layer';
    world.append(layer);
    const insertPanel=doc.createElement('div');
    insertPanel.className='kg-canvas-table-insert-panel';
    insertPanel.dataset.canvasUi='true';
    insertPanel.setAttribute('role','dialog');
    insertPanel.setAttribute('aria-label','插入表格');
    insertPanel.hidden=true;
    let unmountInsertPanel=null;

    let selectedTableId=null,anchor=null,focusCellPos=null,drag=null,editingCell=null;
    const listeners=[];
    function listen(target,type,callback,config){target.addEventListener(type,callback,config);listeners.push(()=>target.removeEventListener(type,callback,config))}
    const tableById=id=>getTables().find(item=>item.id===id)||null;

    function findCell(target){
      const cell=target?.closest?.('.kg-canvas-table-cell');
      const wrap=cell?.closest?.('.kg-canvas-table-wrap');
      if(!cell||!wrap||!layer.contains(wrap))return null;
      return {cell,wrap,tableId:wrap.dataset.tableId,row:Number(cell.dataset.row),column:Number(cell.dataset.column)};
    }

    function showsHistory(){return !pageDrivenHistory&&!!options.showHistory}

    function buildWrap(table,scale){
      const wrap=doc.createElement('div');
      wrap.className='kg-canvas-table-wrap';
      wrap.dataset.tableId=table.id;
      wrap.dataset.canvasUi='true';
      wrap.style.left=table.x+'px';wrap.style.top=table.y+'px';
      const width=table.columnWidths.reduce((a,b)=>a+b,0),height=table.rowHeights.reduce((a,b)=>a+b,0);
      wrap.style.width=width+'px';wrap.style.height=height+'px';
      wrap.style.setProperty('--kg-table-handle',`${(LIMITS.HANDLE/scale).toFixed(2)}px`);
      wrap.style.setProperty('--kg-table-panel-scale',String(Math.min(1.6,1/scale).toFixed(3)));
      // 移动手柄（整体拖动入口）。
      const movebar=doc.createElement('div');
      movebar.className='kg-canvas-table-movebar';
      movebar.dataset.tableDrag='move';
      movebar.title='拖动移动整张表格';
      wrap.append(movebar);
      // 表格本体：合并区域用 rowspan/colspan，覆盖格跳过。
      const mergeAt=(r,c)=>(table.merges||[]).find(m=>m.row===r&&m.column===c);
      const covered=(r,c)=>(table.merges||[]).some(m=>r>m.row&&r<m.row+m.rowSpan&&c>m.column&&c<m.column+m.columnSpan);
      const tableEl=doc.createElement('table');
      tableEl.className='kg-canvas-table';
      const colgroup=doc.createElement('colgroup');
      for(const w of table.columnWidths){const col=doc.createElement('col');col.style.width=w+'px';colgroup.append(col)}
      tableEl.append(colgroup);
      const tbody=doc.createElement('tbody');
      const selectedRect=(selectedTableId===table.id&&anchor)?selectionRect(table,anchor,focusCellPos):null;
      for(let r=0;r<table.rows;r++){
        const tr=doc.createElement('tr');
        tr.style.height=table.rowHeights[r]+'px';
        for(let c=0;c<table.cols;c++){
          if(covered(r,c))continue;
          const td=doc.createElement('td');
          td.className='kg-canvas-table-cell';
          td.dataset.row=String(r);td.dataset.column=String(c);
          td.textContent=table.cells[`${r},${c}`]||'';
          td.setAttribute('contenteditable',readonly()?'false':'plaintext-only');
          if(!readonly())td.setAttribute('spellcheck','false');
          const merge=mergeAt(r,c);
          if(merge){if(merge.rowSpan>1)td.setAttribute('rowspan',String(merge.rowSpan));if(merge.columnSpan>1)td.setAttribute('colspan',String(merge.columnSpan))}
          if(selectedRect&&r>=selectedRect.row&&r<selectedRect.row+selectedRect.rowSpan&&c>=selectedRect.column&&c<selectedRect.column+selectedRect.columnSpan)td.classList.add('kg-canvas-table-cell-selected');
          tr.append(td);
        }
        tbody.append(tr);
      }
      tableEl.append(tbody);
      wrap.append(tableEl);
      // 列边界/行边界把手（拖动调列宽行高）。
      let acc=0;
      for(let i=0;i<table.cols-1;i++){
        acc+=table.columnWidths[i];
        const handle=doc.createElement('div');
        handle.className='kg-canvas-table-boundary kg-canvas-table-boundary-col';
        handle.dataset.tableDrag='col';handle.dataset.boundaryIndex=String(i+1);
        handle.style.left=`${acc}px`;
        handle.title='拖动调整列宽';
        wrap.append(handle);
      }
      acc=0;
      for(let i=0;i<table.rows-1;i++){
        acc+=table.rowHeights[i];
        const handle=doc.createElement('div');
        handle.className='kg-canvas-table-boundary kg-canvas-table-boundary-row';
        handle.dataset.tableDrag='row';handle.dataset.boundaryIndex=String(i+1);
        handle.style.top=`${acc}px`;
        handle.title='拖动调整行高';
        wrap.append(handle);
      }
      // 四边缩放手柄（整表等比缩放，字号固定不适用文本框字号规则）。
      for(const edge of ['n','s','e','w']){
        const handle=doc.createElement('div');
        handle.className=`kg-canvas-table-resize kg-canvas-table-resize-${edge}`;
        handle.dataset.tableDrag='table';handle.dataset.resizeEdge=edge;
        handle.title='拖动调整整表大小（行列等比缩放）';
        wrap.append(handle);
      }
      // 表格工具面板（合并/拆分/删除 + 可选撤销重做），在 world 内随画布变换。
      const panel=doc.createElement('div');
      panel.className='kg-canvas-table-panel';
      panel.dataset.canvasUi='true';
      panel.setAttribute('role','toolbar');
      panel.setAttribute('aria-label','表格工具');
      const buttons=[
        ['merge','合并','合并选中的相邻矩形区域（内容按行拼入左上格）'],
        ['split','拆分','拆分所在合并单元格'],
        ['delete','删除表格','删除整张表格，可撤销'],
      ];
      if(showsHistory())buttons.push(['_divider','',''],['undo','↶','撤销上一次表格操作'],['redo','↷','重做表格操作']);
      for(const [action,label,title] of buttons){
        if(action==='_divider'){const divider=doc.createElement('span');divider.className='kg-canvas-table-panel-divider';panel.append(divider);continue}
        const button=doc.createElement('button');
        button.type='button';button.dataset.tableAction=action;button.textContent=label;button.title=title;
        panel.append(button);
      }
      wrap.append(panel);
      return wrap;
    }

    function render({force=false}={}){
      if(!force&&editingCell&&layer.contains(editingCell))return; // 输入态不重建，避免丢光标
      const scale=view().scale,tables=getTables();
      if(selectedTableId&&!tables.some(item=>item.id===selectedTableId)){selectedTableId=null;anchor=null;focusCellPos=null}
      if(selectedTableId){
        const current=tables.find(item=>item.id===selectedTableId);
        if(current&&anchor){anchor=clampCell(current,anchor);focusCellPos=focusCellPos?clampCell(current,focusCellPos):null}
      }
      layer.replaceChildren(...tables.map(table=>buildWrap(table,scale)));
      paintRenderedSignature();
      refreshControls();
    }
    function clampCell(table,cell){
      return {row:Math.max(0,Math.min(table.rows-1,cell.row)),column:Math.max(0,Math.min(table.cols-1,cell.column))};
    }

    // 仅刷新选中高亮（不重建 DOM，保住单元格焦点）；结构变化才走 render()。
    function paintSelection(){
      const tables=getTables();
      layer.querySelectorAll('.kg-canvas-table-wrap').forEach(wrap=>{
        const table=tables.find(item=>item.id===wrap.dataset.tableId);
        const rect=(wrap.dataset.tableId===selectedTableId&&anchor&&table)?selectionRect(table,anchor,focusCellPos):null;
        wrap.querySelectorAll('.kg-canvas-table-cell').forEach(td=>{
          const r=Number(td.dataset.row),c=Number(td.dataset.column);
          const on=!!rect&&r>=rect.row&&r<rect.row+rect.rowSpan&&c>=rect.column&&c<rect.column+rect.columnSpan;
          td.classList.toggle('kg-canvas-table-cell-selected',on);
        });
      });
    }
    function refreshControls(){
      const locked=readonly();
      layer.classList.toggle('kg-canvas-tables-readonly',locked);
      const historyState=ownHistory.getState(),pageState=(!pageDrivenHistory&&options.history?.getState?.())||historyState;
      layer.querySelectorAll('.kg-canvas-table-wrap').forEach(wrap=>{
        const has=wrap.dataset.tableId===selectedTableId;
        wrap.classList.toggle('kg-canvas-table-selected',has);
        // 只读切换即时生效：单元格可编辑性与手柄可见性跟随权限。
        wrap.querySelectorAll('.kg-canvas-table-cell').forEach(td=>{
          if(locked){td.setAttribute('contenteditable','false');td.removeAttribute('spellcheck')}
          else if(td.getAttribute('contenteditable')!=='plaintext-only'){td.setAttribute('contenteditable','plaintext-only');td.setAttribute('spellcheck','false')}
        });
        wrap.classList.toggle('kg-canvas-table-readonly',locked);
        wrap.querySelectorAll('[data-table-action]').forEach(button=>{
          const action=button.dataset.tableAction;
          if(action==='merge')button.disabled=locked||!has||!anchor;
          else if(action==='split')button.disabled=locked||!has||!anchor;
          else if(action==='delete')button.disabled=locked||!has;
          else if(action==='undo')button.disabled=locked||!pageState.canUndo;
          else if(action==='redo')button.disabled=locked||!pageState.canRedo;
        });
      });
    }
    function tableSignature(){try{return JSON.stringify(getTables())}catch(error){return ''}}
    // 渲染时把当前数据签名记在 layer 上；sync 只在“DOM 落后于数据”时重建
    // （撤销/重做恢复出与上次缓存签名相同的 JSON 时也能正确重绘）。
    function paintRenderedSignature(){layer.dataset.kgTableSignature=tableSignature()}
    function sync(){
      if(domSignature()!==tableSignature())render({force:!editingCell})
    }
    function domSignature(){return layer.dataset.kgTableSignature||''}

    // —— 选中与单元格事件（委托到 layer；stopPropagation 隔离画布平移/框选/拖卡） ——
    listen(layer,'pointerdown',event=>{
      const wrap=event.target.closest?.('.kg-canvas-table-wrap');
      if(!wrap||!layer.contains(wrap))return;
      event.stopPropagation();
      if(readonly())return;
      const tableId=wrap.dataset.tableId;
      // 面板内按下只隔离画布事件，不改变单元格选择。
      if(event.target.closest?.('.kg-canvas-table-panel'))return;
      const dragHandle=event.target.closest?.('[data-table-drag]');
      if(dragHandle){
        event.preventDefault();
        selectTable(tableId);
        beginDrag(event,dragHandle,wrap);
        return;
      }
      selectTable(tableId);
      const hit=findCell(event.target);
      if(hit&&hit.tableId===tableId){
        const table=tableById(tableId);
        if(table){
          const resolved=resolveMergeAnchor(table,hit.row,hit.column);
          if(event.shiftKey&&anchor)focusCellPos={row:resolved.row,column:resolved.column};
          else{anchor={row:resolved.row,column:resolved.column};focusCellPos=null}
        }
      }else{anchor=null;focusCellPos=null}
      paintSelection();refreshControls();
    });
    listen(layer,'dblclick',event=>event.stopPropagation());
    listen(layer,'focusin',event=>{
      const hit=findCell(event.target);
      if(!hit)return;
      editingCell=hit.cell;
      selectTable(hit.tableId);
      const table=tableById(hit.tableId);
      if(table){
        // 焦点已落在当前选择矩形内（如 Shift+点击后的终点格）时不重置选择。
        const rect=anchor?selectionRect(table,anchor,focusCellPos):null;
        const inside=rect&&hit.row>=rect.row&&hit.row<rect.row+rect.rowSpan&&hit.column>=rect.column&&hit.column<rect.column+rect.columnSpan;
        if(!inside){const resolved=resolveMergeAnchor(table,hit.row,hit.column);anchor={row:resolved.row,column:resolved.column};focusCellPos=null}
      }
      paintSelection();refreshControls();
    });
    listen(layer,'focusout',event=>{
      const hit=findCell(event.target);
      if(hit&&editingCell===hit.cell)editingCell=null;
    });
    // 单元格文本入库：contenteditable 末尾可能残留一个表现换行符，入库前去掉。
    function commitCellText(hit){
      const table=tableById(hit.tableId);if(!table)return;
      let text=hit.cell.innerText.replace(/\r\n?/g,'\n');
      if(text.endsWith('\n'))text=text.replace(/\n$/,'');
      const max=model()?.LIMITS?.MAX_CELL_CHARS||3000;
      if(text.length>max){
        text=text.slice(0,max);
        hit.cell.textContent=text;placeCaretEnd(hit.cell);
        status(`单元格内容不能超过 ${max} 字符`);
      }
      const tables=getTables().map(item=>{
        if(item.id!==hit.tableId)return item;
        const cells={...item.cells},key=`${hit.row},${hit.column}`;
        if(text)cells[key]=text;else delete cells[key];
        return {...item,cells};
      });
      mutate(tables,null,{transient:true});
    }
    listen(layer,'input',event=>{
      const hit=findCell(event.target);
      if(!hit||readonly())return;
      // IME 组词中间态不入库；compositionend 后的最终 input/事件统一提交。
      if(event.isComposing)return;
      commitCellText(hit);
    });
    listen(layer,'compositionend',event=>{
      const hit=findCell(event.target);
      if(hit&&!readonly()&&!event.isComposing)commitCellText(hit);
    });
    // 单元格内粘贴：表格结构（Excel HTML/多格 TSV）优先按表格粘贴到选中起始格；
    // 普通文本按纯文本插入（“正在文本编辑”由 isEditingTarget 识别，画布快捷键不介入）。
    listen(layer,'paste',event=>{
      const hit=findCell(event.target);
      if(!hit||readonly())return;
      const parser=clipboard();
      let grid=null;
      if(parser){try{grid=parser.parseClipboardData(event.clipboardData)}catch(error){grid=null}}
      if(grid&&isTabularGrid(grid)){
        event.preventDefault();event.stopPropagation();
        pasteIntoSelection(event.clipboardData);
        return;
      }
      const text=event.clipboardData?.getData?.('text/plain');
      if(text==null)return;
      event.preventDefault();event.stopPropagation();
      doc.execCommand('insertText',false,text.replace(/\r\n?/g,'\n'));
    });
    listen(layer,'keydown',event=>{
      const hit=findCell(event.target);
      if(!hit)return;
      event.stopPropagation(); // 编辑态：Delete/空格等属于文本编辑，画布处理器不得响应
      if(event.isComposing||event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();hit.cell.blur();return}
      if(event.key==='Tab'&&(hit.cell.getAttribute('contenteditable')!=='false')){
        event.preventDefault();
        moveFocus(hit.tableId,hit.row,hit.column,event.shiftKey?-1:1,0);
      }
    });
    function moveFocus(tableId,row,column,dc,dr){
      const table=tableById(tableId);if(!table)return;
      let c=column+dc,r=row+dr;
      while(r>=0&&r<table.rows){
        if(c<0){c=table.cols-1;r--;continue}
        if(c>=table.cols){c=0;r++;continue}
        if(r<0||r>=table.rows)return;
        const target=layer.querySelector(`.kg-canvas-table-wrap[data-table-id="${tableId}"] .kg-canvas-table-cell[data-row="${r}"][data-column="${c}"]`);
        if(target){selectTable(tableId);anchor={row:r,column:c};focusCellPos=null;target.focus();placeCaretEnd(target);paintSelection();return}
        c+=dc;
      }
    }
    function placeCaretEnd(element){
      const range=doc.createRange();range.selectNodeContents(element);range.collapse(false);
      const selection=doc.defaultView?.getSelection?.();if(selection){selection.removeAllRanges();selection.addRange(range)}
    }
    function resolveMergeAnchor(table,row,column){
      const merge=(table.merges||[]).find(m=>row>=m.row&&row<m.row+m.rowSpan&&column>=m.column&&column<m.column+m.columnSpan);
      return merge?{row:merge.row,column:merge.column}:{row,column};
    }
    function selectTable(tableId){selectedTableId=tableId||null;if(!tableId){anchor=null;focusCellPos=null}}

    // —— 拖拽：整体移动 / 四边缩放 / 行列边界 ——
    function beginDrag(event,handle){
      const wrap=handle.closest('.kg-canvas-table-wrap'),table=tableById(wrap?.dataset.tableId);
      if(!table)return;
      drag={kind:handle.dataset.tableDrag,index:handle.dataset.boundaryIndex||null,edge:handle.dataset.resizeEdge||null,
        pointerId:event.pointerId,tableId:table.id,
        original:{...table,columnWidths:[...table.columnWidths],rowHeights:[...table.rowHeights]},
        start:{x:event.clientX,y:event.clientY},scale:view().scale,moved:false};
      try{viewport.setPointerCapture(event.pointerId)}catch(_){}
    }
    listen(viewport,'pointermove',event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;
      const current=tableById(drag.tableId);
      if(!current){drag=null;return}
      if(Math.hypot(event.clientX-drag.start.x,event.clientY-drag.start.y)>2)drag.moved=true;
      if(!drag.moved)return;
      const dx=(event.clientX-drag.start.x)/drag.scale,dy=(event.clientY-drag.start.y)/drag.scale;
      const factory=model();
      let next=null;
      if(drag.kind==='move'){
        next=getTables().map(item=>item.id===drag.tableId?factory.normalize({...item,x:drag.original.x+dx,y:drag.original.y+dy}):item);
      }else if(drag.kind==='table'){
        // 四边缩放：对应方向总宽/总高增减，行列等比缩放；n/w 同时平移 x/y 保持对边不动。
        const widthTotal=drag.original.columnWidths.reduce((a,b)=>a+b,0)+(drag.edge==='e'||drag.edge==='w'?dx*(drag.edge==='w'?-1:1):0);
        const heightTotal=drag.original.rowHeights.reduce((a,b)=>a+b,0)+(drag.edge==='s'||drag.edge==='n'?dy*(drag.edge==='n'?-1:1):0);
        const patch={};
        if(drag.edge==='e'||drag.edge==='w')patch.columnWidths=scaleSizes(drag.original.columnWidths,widthTotal);
        if(drag.edge==='s'||drag.edge==='n')patch.rowHeights=scaleSizes(drag.original.rowHeights,heightTotal);
        next=getTables().map(item=>{
          if(item.id!==drag.tableId)return item;
          const merged={...item,...patch};
          if(drag.edge==='n')merged.y=drag.original.y+dy;
          if(drag.edge==='w')merged.x=drag.original.x+dx;
          return factory.normalize(merged);
        });
      }else if(drag.kind==='col'){
        const index=Number(drag.index),widths=[...drag.original.columnWidths];
        widths[index]=Math.max(LIMITS.MIN_SIZE,Math.round(drag.original.columnWidths[index]+dx));
        next=getTables().map(item=>item.id===drag.tableId?factory.normalize({...item,columnWidths:widths}):item);
      }else if(drag.kind==='row'){
        const index=Number(drag.index),heights=[...drag.original.rowHeights];
        heights[index]=Math.max(LIMITS.MIN_SIZE,Math.round(drag.original.rowHeights[index]+dy));
        next=getTables().map(item=>item.id===drag.tableId?factory.normalize({...item,rowHeights:heights}):item);
      }
      if(!next)return;
      applyTables(next); // 拖动过程直写，pointerup 时以「拖前快照 → 拖后状态」单条历史进栈
      render({force:true});
    });
    listen(viewport,'pointerup',event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;
      const session=drag;drag=null;
      try{viewport.releasePointerCapture(session.pointerId)}catch(_){}
      if(!session.moved)return;
      const current=tableById(session.tableId);
      if(!current)return;
      const labels={move:'移动表格',table:'调整表格大小',col:'调整表格列宽',row:'调整表格行高'};
      // before 用拖前快照（pointermove 直写绕过历史，getTables() 已是拖后位置）。
      mutate(getTables(),labels[session.kind]||'调整表格',{before:withTableReplaced(current,session.original)});
    });
    listen(viewport,'pointercancel',event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;
      const session=drag;drag=null;
      try{viewport.releasePointerCapture(session.pointerId)}catch(_){}
      // 拖动中断：回滚到拖动前布局（不进历史）。
      applyTables(getTables().map(item=>item.id===session.tableId?session.original:item));
      render({force:true});
    });

    // —— 面板动作：合并 / 拆分 / 删除 / 撤销重做 ——
    listen(layer,'click',event=>{
      const button=event.target.closest?.('[data-table-action]');
      if(!button||!layer.contains(button))return;
      event.preventDefault();event.stopPropagation();
      if(readonly())return;
      const action=button.dataset.tableAction;
      const wrap=button.closest('.kg-canvas-table-wrap'),tableId=wrap?.dataset.tableId||selectedTableId;
      try{
        if(action==='undo'||action==='redo'){
          const stack=options.history&&typeof options.history[action]==='function'?options.history:ownHistory;
          if(stack[action]&&!stack[action]())status(action==='undo'?'暂无可撤销的表格操作。':'暂无可重做的表格操作。');
          render({force:true});return;
        }
        const table=tableById(tableId);if(!table)return;
        selectTable(tableId);
        if(action==='delete'){
          if(!confirmOperation('确认删除整张表格？可按 Ctrl/Command+Z 撤销。'))return;
          mutate(getTables().filter(item=>item.id!==tableId),'删除表格');
          if(selectedTableId===tableId)selectTable(null);
          status('表格已删除。');return;
        }
        if(!anchor){status('请先点击起始单元格，再用 Shift+点击 扩选。');return}
        const cellAnchor=resolveMergeAnchor(table,anchor.row,anchor.column);
        if(action==='merge'){
          const endAnchor=focusCellPos?resolveMergeAnchor(table,focusCellPos.row,focusCellPos.column):cellAnchor;
          const rect=selectionRect(table,cellAnchor,endAnchor);
          if(!rect||(rect.rowSpan===1&&rect.columnSpan===1)){status('请用 Shift+点击 选中要合并的相邻矩形区域。');return}
          const next=model().merge(table,rect);
          mutate(withTableReplaced(table,next),'合并单元格');
          anchor={row:rect.row,column:rect.column};focusCellPos=null;
          status('已合并单元格，内容按行拼入左上格。');return;
        }
        if(action==='split'){
          const next=model().split(table,cellAnchor.row,cellAnchor.column);
          mutate(withTableReplaced(table,next),'拆分单元格');
          status('已拆分合并单元格。');return;
        }
      }catch(error){status(error?.message||'表格操作失败');render({force:true})}
    });
    function confirmOperation(message){return typeof options.confirm==='function'?!!options.confirm(message):global.confirm(message)}

    // —— 粘贴：编辑态文本优先（cell 层拦截）；选中起始格粘贴；空画布表格数据新建表 ——
    function parseGrid(data){
      const parser=clipboard();if(!parser)return null;
      try{return parser.parseClipboardData(data)}catch(error){status(error?.message||'剪贴板数据无效');return null}
    }
    function pasteIntoSelection(data){
      if(readonly())return false;
      const grid=parseGrid(data);if(!grid)return false;
      const table=selectedTableId?tableById(selectedTableId):null;
      if(table&&anchor){
        const origin=resolveMergeAnchor(table,anchor.row,anchor.column);
        try{
          const next=model().paste(table,{row:origin.row,column:origin.column},grid);
          if(mutate(withTableReplaced(table,next),'粘贴表格数据')){
            anchor={row:origin.row,column:origin.column};focusCellPos=null;
            status('已粘贴剪贴板表格数据。');return true;
          }
          return true; // 已识别为表格粘贴但被拒绝（超限/冲突）：不落回页面语义
        }catch(error){status(error?.message||'粘贴失败');return true}
      }
      if(getTables().length===0&&isTabularGrid(grid))return insertFromGrid(grid,'粘贴为新表格');
      return false;
    }
    listen(doc,'paste',event=>{
      if(readonly()||drag)return;
      if(global.KGCanvasDomInteraction?.isEditingTarget?.(event))return; // 编辑态：文本优先
      if(!selectedTableId&&getTables().length>0)return; // 既有页面粘贴语义优先
      // 只接管表格状数据（≥2 格）；1×1 纯文本/图谱片段放行页面语义（卡牌复制粘贴不受影响）。
      if(!isTabularGrid(parseGrid(event.clipboardData)))return;
      if(pasteIntoSelection(event.clipboardData)){event.preventDefault();event.stopPropagation()}
    },true);

    // —— 插入表格 ——
    function insertFromGrid(grid,label){
      const factory=model();if(!factory)return false;
      // 粘贴网格以 cells 为准；插入面板以 rows/cols 为准；双路径都钳制到上限内。
      const rows=Math.max(1,Math.min(LIMITS.ROWS_MAX,Array.isArray(grid.cells)&&grid.cells.length?grid.cells.length:Math.round(Number(grid.rows)||0)));
      const cols=Math.max(1,Math.min(LIMITS.COLS_MAX,Array.isArray(grid.cells)&&grid.cells.length?grid.cells[0]?.length||0:Math.round(Number(grid.cols)||0)));
      const point=clampPointIntoView(typeof options.getLastWorldPoint==='function'?options.getLastWorldPoint():viewportCenterWorld());
      const id=nextId();
      try{
        const created=factory.create({id,rows,cols,x:Math.round(point.x),y:Math.round(point.y)});
        if(!mutate([...getTables(),created],label||'插入表格'))return false;
        selectTable(id);anchor={row:0,column:0};focusCellPos=null;
        render({force:true});
        return true;
      }catch(error){status(error?.message||'插入表格失败');return false}
    }
    function insert(rows,cols){
      if(readonly()){status('当前画布只读，不能插入表格');return false}
      const r=clampGridCount(rows,LIMITS.ROWS_MAX),c=clampGridCount(cols,LIMITS.COLS_MAX);
      if(!r||!c){status(`请输入 1 以上的行列数（最大 ${LIMITS.ROWS_MAX} 行 × ${LIMITS.COLS_MAX} 列）`);return false}
      return insertFromGrid({rows:r,cols:c},'插入表格');
    }
    function viewportCenterWorld(){
      const v=view(),rect=viewport.getBoundingClientRect();
      return {x:(rect.width/2-v.x)/v.scale,y:(rect.height/2-v.y)/v.scale};
    }
    // 插入点钳制到当前可视区（留 24px 屏幕边距），避免记忆指针位置把新表放到画面外。
    function clampPointIntoView(point){
      const v=view(),rect=viewport.getBoundingClientRect(),margin=24/v.scale;
      const left=-v.x/v.scale+margin,top=-v.y/v.scale+margin;
      const right=(rect.width-v.x)/v.scale-margin,bottom=(rect.height-v.y)/v.scale-margin;
      if(right<=left||bottom<=top)return {x:Math.round(point.x),y:Math.round(point.y)};
      return {x:Math.round(Math.min(Math.max(point.x,left),right)),y:Math.round(Math.min(Math.max(point.y,top),bottom))};
    }
    let sequence=0;
    function nextId(){return `tb-${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2,8)}`}
    function buildInsertPanel(){
      if(insertPanel.dataset.built==='1')return;
      insertPanel.dataset.built='1';
      insertPanel.innerHTML='<strong>插入表格</strong><div class="kg-canvas-table-insert-grid" role="grid" aria-label="选择行列数"></div><div class="kg-canvas-table-insert-inputs"><label>行 <input class="kg-canvas-table-insert-rows" type="number" min="1" max="100" value="3" aria-label="表格行数"></label><label>列 <input class="kg-canvas-table-insert-cols" type="number" min="1" max="50" value="3" aria-label="表格列数"></label></div><div class="kg-canvas-table-insert-actions"><button type="button" data-insert-cancel>取消</button><button type="button" class="kg-canvas-table-insert-confirm" data-insert-confirm>插入</button></div><small>网格 1-10，数字输入最大 100 行 × 50 列</small>';
      const gridBox=insertPanel.querySelector('.kg-canvas-table-insert-grid');
      for(let r=1;r<=LIMITS.GRID_MAX;r++)for(let c=1;c<=LIMITS.GRID_MAX;c++){
        const cell=doc.createElement('button');
        cell.type='button';cell.dataset.gridRow=String(r);cell.dataset.gridCol=String(c);
        cell.setAttribute('aria-label',`${r} 行 ${c} 列`);
        gridBox.append(cell);
      }
      const rowsInput=insertPanel.querySelector('.kg-canvas-table-insert-rows'),colsInput=insertPanel.querySelector('.kg-canvas-table-insert-cols');
      const updateHover=()=>{
        gridBox.querySelectorAll('button').forEach(button=>{
          const r=Number(button.dataset.gridRow),c=Number(button.dataset.gridCol);
          button.classList.toggle('is-active',r<=Number(rowsInput.value||0)&&c<=Number(colsInput.value||0));
        });
      };
      listen(gridBox,'pointerover',event=>{
        const button=event.target.closest?.('button');if(!button)return;
        rowsInput.value=button.dataset.gridRow;colsInput.value=button.dataset.gridCol;updateHover();
      });
      listen(gridBox,'click',event=>{
        const button=event.target.closest?.('button');if(!button)return;
        event.preventDefault();
        closeInsertPanel();
        insert(Number(button.dataset.gridRow),Number(button.dataset.gridCol));
      });
      listen(insertPanel,'click',event=>{
        event.stopPropagation();
        if(event.target.dataset?.insertConfirm){closeInsertPanel();insert(rowsInput.value,colsInput.value)}
        else if(event.target.dataset?.insertCancel)closeInsertPanel();
      });
      listen(insertPanel,'pointerdown',event=>event.stopPropagation());
      listen(insertPanel,'input',updateHover);
      listen(insertPanel,'keydown',event=>{
        event.stopPropagation();
        if(event.key==='Escape')closeInsertPanel();
        else if(event.key==='Enter'){event.preventDefault();insertPanel.querySelector('[data-insert-confirm]').click()}
      });
    }
    function openInsertPanel(anchorEl){
      if(readonly()){status('当前画布只读，不能插入表格');return}
      buildInsertPanel();
      if(!unmountInsertPanel&&global.KGCanvasDomInteraction?.mountOverlay)unmountInsertPanel=global.KGCanvasDomInteraction.mountOverlay(insertPanel,options.overlayHost||doc.body);
      else if(!insertPanel.parentNode)(options.overlayHost||doc.body).append(insertPanel);
      insertPanel.hidden=false;
      // 定位到入口按钮附近（挂全屏宿主后仍按视口坐标）。
      if(anchorEl&&anchorEl.getBoundingClientRect){
        const rect=anchorEl.getBoundingClientRect();
        const width=insertPanel.offsetWidth||238,height=insertPanel.offsetHeight||300;
        insertPanel.style.left=Math.max(8,Math.min(rect.left,global.innerWidth-width-8))+'px';
        insertPanel.style.top=Math.max(8,Math.min(rect.bottom+8,global.innerHeight-height-8))+'px';
      }
      insertPanel.querySelector('.kg-canvas-table-insert-rows')?.focus?.();
    }
    function closeInsertPanel(){insertPanel.hidden=true}

    // —— 全局键盘：Ctrl/⌘+Z（仅自有历史且当前表格被选中时接管，capture 先于页面；
    //     undoKeyDelegated 页面已把同一命令栈接到自己的撤销入口时不拦截）；Escape 清除选择 ——
    listen(doc,'keydown',event=>{
      if(global.KGCanvasDomInteraction?.isEditingTarget?.(event))return;
      if(event.key==='Escape'&&!event.defaultPrevented&&selectedTableId){selectTable(null);paintSelection();refreshControls();closeInsertPanel();return}
      if(pageDrivenHistory||options.undoKeyDelegated||!selectedTableId)return;
      const combo=(event.ctrlKey||event.metaKey)&&!event.altKey&&String(event.key||'').toLowerCase()==='z';
      if(!combo)return;
      event.preventDefault();event.stopPropagation();
      try{if(!undoRedo(event.shiftKey?'redo':'undo'))status(event.shiftKey?'暂无可重做的表格操作。':'暂无可撤销的表格操作。')}
      catch(error){status(error?.message||'表格操作失败')}
    },true);

    function undoRedo(action){
      const stack=options.history&&typeof options.history[action]==='function'?options.history:ownHistory;
      const done=!!stack[action]?.();
      if(done)render({force:true})
      return done;
    }
    function reset({keepSelection=false}={}){
      ownHistoryStack.length=0;ownRedoStack=[];
      if(!keepSelection)selectTable(null);
      closeInsertPanel();
      drag=null;editingCell=null;
      render({force:true});
    }
    function destroy(){
      listeners.forEach(remove=>remove());
      unmountInsertPanel?.();insertPanel.remove();layer.remove();
    }

    render({force:true});
    return Object.freeze({
      render:()=>render({force:!editingCell}),sync,refreshControls,
      openInsertPanel,closeInsertPanel,insert,
      undo:()=>undoRedo('undo'),redo:()=>undoRedo('redo'),
      reset,destroy,
      handlePasteEvent:event=>pasteIntoSelection(event.clipboardData),
      clearSelection:()=>{selectTable(null);render({force:true})},
      get selectedTableId(){return selectedTableId},
      get tables(){return getTables()},
      get selection(){return selectedTableId&&anchor?{tableId:selectedTableId,anchor,focus:focusCellPos}:null},
      get editing(){return !!(editingCell&&layer.contains(editingCell))},
    });
  }

  const api=Object.freeze({create,selectionRect,scaleSizes,clampGridCount,isTabularGrid,LIMITS});
  global.KGCanvasTableController=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
