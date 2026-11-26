(function(global){
  'use strict';
  // 题干竖线表格渲染：历史导入的题干里表格是「a | b | c」纯文本 + 换行，
  // 各做题页按 pre-wrap 原样显示会错位。此模块把连续 >=2 行、每行 >=2 个 '|'
  // 的文本块转成真正的 HTML 表格（首行作表头），其余文本原样返回。
  // 输入约定为已 escapeHTML 的文本（'|' 与换行不受转义影响，单元格内容安全）。
  const TABLE_CLASS='kg-stem-table';

  function pipeCount(line){let n=0;for(let i=0;i<line.length;i+=1)if(line.charAt(i)==='|')n+=1;return n;}
  function isRowLine(line){return pipeCount(line)>=2;}

  function detectBlocks(lines){
    const blocks=[];let start=-1;
    lines.forEach((line,i)=>{
      if(isRowLine(line)){if(start<0)start=i;}
      else if(start>=0){if(i-start>=2)blocks.push([start,i]);start=-1;}
    });
    if(start>=0&&lines.length-start>=2)blocks.push([start,lines.length]);
    return blocks;
  }

  function hasTable(text){
    const value=String(text||'');
    if(value.indexOf('|')<0)return false;
    return detectBlocks(value.split('\n')).length>0;
  }

  function cells(line,trimEdges){
    const parts=line.split('|').map(part=>part.trim());
    if(trimEdges){
      if(parts.length&&parts[0]==='')parts.shift();
      if(parts.length&&parts[parts.length-1]==='')parts.pop();
    }
    return parts.length?parts:[''];
  }

  function tableMarkup(lines){
    // 首行作表头；列数取块内最大，短行补空单元格。
    const grid=lines.map((line,i)=>cells(line,i===0));
    const cols=Math.max.apply(null,grid.map(row=>row.length));
    const header=grid[0];
    let html='<thead><tr>';
    for(let j=0;j<cols;j+=1)html+='<th>'+(header[j]||'')+'</th>';
    html+='</tr></thead><tbody>';
    for(let i=1;i<grid.length;i+=1){
      html+='<tr>';
      for(let j=0;j<cols;j+=1)html+='<td>'+(grid[i][j]||'')+'</td>';
      html+='</tr>';
    }
    html+='</tbody>';
    return '<table class="'+TABLE_CLASS+'">'+html+'</table>';
  }

  function render(escapedText){
    const text=String(escapedText||'');
    if(text.indexOf('|')<0)return text;
    const lines=text.split('\n');
    const blocks=detectBlocks(lines);
    if(!blocks.length)return text;
    let html='',cursor=0;
    blocks.forEach(([start,end])=>{
      html+=lines.slice(cursor,start).join('\n');
      html+=tableMarkup(lines.slice(start,end));
      cursor=end;
    });
    html+=lines.slice(cursor).join('\n');
    return html;
  }

  function injectStyle(){
    const doc=global.document;
    if(!doc||doc.getElementById('kg-stem-table-style'))return;
    const style=doc.createElement('style');
    style.id='kg-stem-table-style';
    style.textContent='.'
      +TABLE_CLASS+'{border-collapse:collapse;margin:10px 0;max-width:100%;font-size:.92em;line-height:1.6;display:block;overflow-x:auto}'
      +'.'+TABLE_CLASS+' th,.'+TABLE_CLASS+' td{border:1px solid #dfe4ec;padding:5px 12px;text-align:left;vertical-align:top}'
      +'.'+TABLE_CLASS+' thead th{background:#f1f4f8;color:#526071;font-weight:600}';
    doc.head.appendChild(style);
  }
  injectStyle();

  global.KGStemTable=Object.freeze({render,hasTable});
})(typeof window!=='undefined'?window:globalThis);
