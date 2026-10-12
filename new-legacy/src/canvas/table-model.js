'use strict';
(function(global){
  // TableV1 限额：与 backend/app/schemas/canvas_table.py 保持同一语义。
  const LIMITS=Object.freeze({
    MAX_ROWS:100,MAX_COLS:50,
    MAX_CELLS_PER_TABLE:5000,MAX_CELLS_PER_CANVAS:20000,
    MAX_CELL_CHARS:3000,DEFAULT_ROWS:3,DEFAULT_COLS:3,
  });
  function fail(message){throw new Error(message)}
  const isIndex=n=>Number.isInteger(n)&&n>=0;
  function clone(value){return JSON.parse(JSON.stringify(value))}

  // 稀疏单元格：仅非空文本存在 cells；键为 'r,c'。
  function create(options={}){
    const rows=Math.round(Number(options.rows)||LIMITS.DEFAULT_ROWS),cols=Math.round(Number(options.cols)||LIMITS.DEFAULT_COLS);
    return normalize({id:String(options.id||''),schemaVersion:1,x:Number(options.x)||0,y:Number(options.y)||0,
      rows,cols,columnWidths:Array.from({length:cols},()=>options.columnWidth||140),
      rowHeights:Array.from({length:rows},()=>options.rowHeight||40),
      cells:clone(options.cells||{}),merges:clone(options.merges||[])});
  }
  function cellCount(table){return table.rows*table.cols}

  function normalize(input){
    if(!input||typeof input!=='object')fail('表格结构必须是对象');
    if(input.schemaVersion!==1)fail('不支持的表格版本');
    const rows=input.rows,cols=input.cols;
    if(!isIndex(rows)||rows<1||rows>LIMITS.MAX_ROWS)fail(`表格行数必须在 1-${LIMITS.MAX_ROWS} 之间`);
    if(!isIndex(cols)||cols<1||cols>LIMITS.MAX_COLS)fail(`表格列数必须在 1-${LIMITS.MAX_COLS} 之间`);
    if(rows*cols>LIMITS.MAX_CELLS_PER_TABLE)fail(`表格单元格总数不能超过 ${LIMITS.MAX_CELLS_PER_TABLE}`);
    const widths=input.columnWidths,heights=input.rowHeights;
    if(!Array.isArray(widths)||widths.length!==cols||!widths.every(w=>Number.isFinite(w)&&w>0))fail('列宽配置无效');
    if(!Array.isArray(heights)||heights.length!==rows||!heights.every(h=>Number.isFinite(h)&&h>0))fail('行高配置无效');
    const cells={};
    if(input.cells!=null&&typeof input.cells==='object'){
      for(const [key,value] of Object.entries(input.cells)){
        const match=/^(\d+),(\d+)$/.exec(key),r=match&&Number(match[1]),c=match&&Number(match[2]);
        if(!match||r>=rows||c>=cols)fail(`单元格坐标越界：${key}`);
        if(value==null)continue;
        if(typeof value!=='string')fail(`单元格 ${key} 内容必须是文本`);
        if(value.length>LIMITS.MAX_CELL_CHARS)fail(`单元格 ${key} 超过 ${LIMITS.MAX_CELL_CHARS} 字符上限`);
        if(value)cells[key]=value;
      }
    }
    const merges=[];
    const taken=Array.from({length:rows},()=>new Array(cols).fill(false));
    for(const m of Array.isArray(input.merges)?input.merges:[]){
      const rect={row:m.row,column:m.column,rowSpan:Math.round(m.rowSpan),columnSpan:Math.round(m.columnSpan)};
      if(!isIndex(rect.row)||!isIndex(rect.column)||!isIndex(rect.rowSpan)||!isIndex(rect.columnSpan)||rect.rowSpan<1||rect.columnSpan<1)fail('合并区域无效');
      if(rect.row+rect.rowSpan>rows||rect.column+rect.columnSpan>cols)fail('合并区域越界');
      for(let r=rect.row;r<rect.row+rect.rowSpan;r++)for(let c=rect.column;c<rect.column+rect.columnSpan;c++){
        if(taken[r][c])fail('合并区域相互重叠');taken[r][c]=true;
      }
      merges.push(rect);
    }
    return {id:typeof input.id==='string'&&input.id?input.id:fail('表格缺少 id'),schemaVersion:1,
      x:Number.isFinite(input.x)?input.x:0,y:Number.isFinite(input.y)?input.y:0,
      rows,cols,columnWidths:widths.map(Number),rowHeights:heights.map(Number),cells,merges};
  }

  function rectOf(m){return {row:m.row,column:m.column,rowSpan:m.rowSpan,columnSpan:m.columnSpan}}
  function covers(outer,inner){
    return outer.row<=inner.row&&outer.column<=inner.column&&
      outer.row+outer.rowSpan>=inner.row+inner.rowSpan&&outer.column+outer.columnSpan>=inner.column+inner.columnSpan;
  }
  function intersects(a,b){
    return a.row<b.row+b.rowSpan&&b.row<a.row+a.rowSpan&&a.column<b.column+b.columnSpan&&b.column<a.column+a.columnSpan;
  }

  // 合并：内容按行优先、跳过空格、以换行拼入左上格；其余格清除。修改返回新表。
  function merge(table,rect){
    const row=rect.row,column=rect.column,rowSpan=Math.round(rect.rowSpan),columnSpan=Math.round(rect.columnSpan);
    if(!isIndex(row)||!isIndex(column)||!isIndex(rowSpan)||!isIndex(columnSpan)||rowSpan<1||columnSpan<1)fail('合并区域无效');
    if(row+rowSpan>table.rows||column+columnSpan>table.cols)fail('合并区域越界');
    if(rowSpan===1&&columnSpan===1)return normalize(table); // 无需合并
    const next=clone(table);
    const request={row,column,rowSpan,columnSpan};
    for(const m of next.merges){
      if(covers(request,m))continue; // 新合并覆盖旧合并：整体并入
      if(covers(m,request)){
        if(m.row===row&&m.column===column&&m.rowSpan===rowSpan&&m.columnSpan===columnSpan)continue; // 幂等
        fail('该区域已在更大的合并单元格内，请先拆分');
      }
      if(intersects(request,m))fail('合并区域与已有合并部分重叠，请先拆分');
    }
    const combined=[];
    for(let r=row;r<row+rowSpan;r++)for(let c=column;c<column+columnSpan;c++){
      const value=next.cells[`${r},${c}`];
      if(value)combined.push(value);delete next.cells[`${r},${c}`];
    }
    const mergedText=combined.join('\n');
    if(mergedText.length>LIMITS.MAX_CELL_CHARS)fail('合并后的内容超过单元格字符上限，请先整理');
    if(mergedText)next.cells[`${row},${column}`]=mergedText;
    next.merges=next.merges.filter(m=>!covers(request,m)&&!covers(m,request));
    next.merges.push({row,column,rowSpan,columnSpan});
    return normalize(next);
  }

  // 拆分：移除包含该格的合并；左上格保留内容，其余格为空（内容早已收进左上格）。
  function split(table,row,column){
    if(!isIndex(row)||!isIndex(column))fail('拆分坐标无效');
    const index=table.merges.findIndex(m=>row>=m.row&&row<m.row+m.rowSpan&&column>=m.column&&column<m.column+m.columnSpan);
    if(index<0)fail('该单元格不在合并区域内');
    const next=clone(table);next.merges.splice(index,1);
    return normalize(next);
  }

  // 粘贴：必要时扩充行列；与现有合并区域相交即拒绝；超限整体拒绝，不部分写入。
  function paste(table,origin,clipboardGrid){
    if(!isIndex(origin?.row)||!isIndex(origin?.column))fail('粘贴起点无效');
    const grid=clipboardGrid&&Array.isArray(clipboardGrid.cells)?clipboardGrid:fail('剪贴板数据无效');
    const gridRows=grid.cells.length,gridCols=grid.cells[0]?.length||0;
    if(!gridRows||!gridCols)fail('剪贴板数据为空');
    if(grid.cells.some(r=>r.length!==gridCols))fail('剪贴板各行列数不一致');
    const merges=(Array.isArray(grid.merges)?grid.merges:[]).map(m=>({
      row:origin.row+m.row,column:origin.column+m.column,rowSpan:m.rowSpan,columnSpan:m.columnSpan}));
    for(const m of merges)if(!isIndex(m.rowSpan)||!isIndex(m.columnSpan)||m.rowSpan<1||m.columnSpan<1)fail('剪贴板合并区域无效');
    for(const value of grid.cells.flat())if(typeof value!=='string'&&value!=null)fail('剪贴板包含非文本单元格');
    const rows=Math.max(table.rows,origin.row+gridRows),cols=Math.max(table.cols,origin.column+gridCols);
    if(rows>LIMITS.MAX_ROWS||cols>LIMITS.MAX_COLS)fail(`粘贴超出表格 ${LIMITS.MAX_ROWS} 行 ${LIMITS.MAX_COLS} 列上限`);
    if(rows*cols>LIMITS.MAX_CELLS_PER_TABLE)fail(`粘贴超出每表 ${LIMITS.MAX_CELLS_PER_TABLE} 格上限`);
    const request={row:origin.row,column:origin.column,rowSpan:gridRows,columnSpan:gridCols};
    for(const m of table.merges)if(intersects(request,m))fail('粘贴区域与已有合并单元格冲突，请先拆分');
    const next=clone(table);
    next.rows=rows;next.cols=cols;
    while(next.columnWidths.length<cols)next.columnWidths.push(next.columnWidths[next.columnWidths.length-1]||140);
    while(next.rowHeights.length<rows)next.rowHeights.push(next.rowHeights[next.rowHeights.length-1]||40);
    for(let r=0;r<gridRows;r++)for(let c=0;c<gridCols;c++){
      const value=grid.cells[r][c],key=`${origin.row+r},${origin.column+c}`;
      if(value&&String(value).length>LIMITS.MAX_CELL_CHARS)fail(`粘贴内容超过每格 ${LIMITS.MAX_CELL_CHARS} 字符上限`);
      if(value)next.cells[key]=String(value);else delete next.cells[key];
    }
    next.merges.push(...merges);
    return normalize(next);
  }

  const api=Object.freeze({LIMITS,create,normalize,cellCount,merge,split,paste});
  global.KGCanvasTableModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
