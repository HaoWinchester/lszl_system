'use strict';
(function(global){
  // 剪贴板表格解析：Excel HTML 优先（含 rowspan/colspan、<br> 换行），否则 TSV。
  // 只读取安全显示文本；不执行脚本、公式或加载外部资源。
  const EMPTY_CELL=/^[\s　 ]*$/; // U+3000 与 mso NBSP 视为空格子
  function hasDom(){return typeof DOMParser!=='undefined'&&typeof Node!=='undefined'}
  function cellText(element){
    const parts=[];
    for(const node of element.childNodes){
      if(node.nodeType===Node.TEXT_NODE)parts.push(node.nodeValue||'');
      else if(node.nodeType===Node.ELEMENT_NODE){
        if(node.tagName==='BR')parts.push('\n');
        else if(node.tagName==='SCRIPT'||node.tagName==='STYLE')continue;
        else parts.push(cellText(node));
      }
    }
    return parts.join('');
  }
  // 解析 HTML 表格为 {cells,merges}；跨列/跨行以空串占位，只保留左上格内容。
  function parseHTML(html){
    if(!hasDom()||typeof html!=='string'||!/<table[\s>]/i.test(html))return null;
    let document;
    try{document=new DOMParser().parseFromString(html,'text/html')}catch(error){return null}
    const table=document.querySelector('table');
    if(!table)return null;
    const occupied=new Set(),cells=[],merges=[];
    let row=-1;
    for(const tr of table.querySelectorAll('tr')){
      row++;
      cells.push([]);
      let column=0;
      for(const td of tr.children){
        if(!/^(TD|TH)$/.test(td.tagName))continue;
        while(occupied.has(row+':'+column)){cells[row].push('');column++}
        const rowSpan=Math.max(1,Math.min(1000,parseInt(td.getAttribute('rowspan')||'1',10)||1));
        const colSpan=Math.max(1,Math.min(1000,parseInt(td.getAttribute('colspan')||'1',10)||1));
        const text=cellText(td).replace(/\r\n?/g,'\n');
        cells[row].push(EMPTY_CELL.test(text)?'':text);
        if(rowSpan>1||colSpan>1){
          merges.push({row,column,rowSpan,columnSpan:colSpan});
          for(let r=row;r<row+rowSpan;r++)for(let c=column;c<column+colSpan;c++)occupied.add(r+':'+c);
        }
        column+=colSpan;
      }
    }
    if(!cells.length||!cells.some(r=>r.length))return null;
    const width=Math.max(...cells.map(r=>r.length));
    for(const r of cells)while(r.length<width)r.push('');
    return {cells,merges};
  }
  // TSV：仅当字段含 tab/换行时 Excel 会加引号；引号字段内 "" 为字面引号。
  function parseTSV(text){
    if(typeof text!=='string'||!text.trim())return null;
    const rows=[];let row=[],field='',quoted=false;
    const pushField=()=>{row.push(field);field=''};
    const pushRow=()=>{pushField();rows.push(row);row=[]};
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'){if(text[i+1]==='"'){field+='"';i++}else quoted=false}
        else field+=ch;
      }else if(ch==='"'&&!field)quoted=true;
      else if(ch==='\t'){pushField()}
      else if(ch==='\r'){/* CRLF 与裸 CR 都按行结束处理的一半 */}
      else if(ch==='\n'){pushRow()}
      else field+=ch;
    }
    if(quoted)throw new Error('剪贴板 TSV 引号未闭合');
    if(field||row.length)pushRow();
    while(rows.length&&!rows[rows.length-1].some(v=>v))rows.pop(); // 尾随空行
    if(!rows.length)return null;
    const width=Math.max(...rows.map(r=>r.length));
    return {cells:rows.map(r=>Array.from({length:width},(_,c)=>{const v=r[c]||'';return EMPTY_CELL.test(v)?'':v})),merges:[]};
  }
  // data：ClipboardEvent.clipboardData 或 {html,text}。
  function parseClipboardData(data){
    if(!data)return null;
    let html=null,text=null;
    if(typeof data.getData==='function'){
      try{html=data.getData('text/html')||null}catch(error){/* 某些浏览器对禁止类型抛错 */}
      try{text=data.getData('text/plain')||null}catch(error){text=null}
    }else{html=data.html||null;text=data.text||null}
    return parseHTML(html)||parseTSV(text||'');
  }
  const api=Object.freeze({parseHTML,parseTSV,parseClipboardData});
  global.KGCanvasTableClipboard=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
