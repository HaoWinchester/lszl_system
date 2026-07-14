'use strict';

/*
 * v7.9.56：图谱视觉导出服务。
 * - ZIP 学习包仍由 21-home-package-service.js 负责。
 * - 本服务负责把当前整张知识图谱绘制为 PNG / PDF，便于汇报、归档和分享。
 */
(function(global){
  const EXPORT_PADDING = 96;
  const MAX_CANVAS_SIDE = 8192;
  const MAX_CANVAS_PIXELS = 32000000;
  const BG_COLOR = '#f7f8fc';
  const DOT_COLOR = 'rgba(15,23,42,.12)';
  const DOT_STEP = 28;

  function showExportStatus(message){
    if(typeof showStatus === 'function') showStatus(message);
  }

  function safeFileBase(value){
    const service = global.KGHomePackageService;
    if(service && typeof service.safeFileBase === 'function') return service.safeFileBase(value);
    return String(value || '知识图谱')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || '知识图谱';
  }

  function currentGraphTitle(){
    try{
      const store = global.KGGraphFileStore;
      const file = store && typeof store.getCurrentFileMeta === 'function' ? store.getCurrentFileMeta() : (store && typeof store.getCurrentFile === 'function' ? store.getCurrentFile() : null);
      return (file && file.name) || (typeof state !== 'undefined' && state.meta && state.meta.title) || '知识图谱';
    }catch(err){
      return '知识图谱';
    }
  }

  function downloadBlob(blob, filename){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 180);
  }

  function cssColorToRgb(color, fallback=[100,116,139]){
    const value = String(color || '').trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if(hex){
      let h = hex[1];
      if(h.length === 3) h = h.split('').map(c=>c+c).join('');
      const n = parseInt(h, 16);
      return [n >> 16 & 255, n >> 8 & 255, n & 255];
    }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
    if(rgb){
      const parts = rgb[1].split(',').map(v=>Number(String(v).trim()));
      if(parts.length >= 3 && parts.slice(0,3).every(Number.isFinite)) return parts.slice(0,3).map(v=>Math.max(0, Math.min(255, Math.round(v))));
    }
    return fallback;
  }

  function tintColor(color, amount){
    const [r,g,b] = cssColorToRgb(color);
    const t = Math.max(0, Math.min(1, Number(amount) || 0));
    return `rgb(${Math.round(r + (255 - r) * t)}, ${Math.round(g + (255 - g) * t)}, ${Math.round(b + (255 - b) * t)})`;
  }

  function safeNodeColor(value, fallback='#64748b'){
    if(typeof safeColor === 'function') return safeColor(value, fallback);
    return /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback;
  }

  function dimsForNode(node){
    if(typeof nodeDims === 'function') return nodeDims(node);
    if(node && node.size === 'small') return {w:104, h:110};
    if(node && node.size === 'big') return {w:160, h:166};
    return {w:128, h:132};
  }

  function positionForNode(node){
    if(typeof visualPositionForNode === 'function') return visualPositionForNode(node, {ignoreGather:true});
    return {x:Number(node && node.x) || 0, y:Number(node && node.y) || 0};
  }

  function centerForNode(node){
    const d = dimsForNode(node), p = positionForNode(node);
    return {x:p.x + d.w / 2, y:p.y + d.h / 2};
  }

  function exportNodes(){
    if(typeof state === 'undefined' || !state || !Array.isArray(state.nodes)) return [];
    return state.nodes.slice();
  }

  function exportLinks(){
    if(typeof state === 'undefined' || !state || !Array.isArray(state.links)) return [];
    return state.links.slice();
  }

  function graphBounds(nodes){
    if(!nodes.length) return {x:-260, y:-180, width:760, height:520};
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    nodes.forEach(node=>{
      const p = positionForNode(node), d = dimsForNode(node);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + d.w);
      maxY = Math.max(maxY, p.y + d.h);
    });
    minX -= EXPORT_PADDING;
    minY -= EXPORT_PADDING;
    maxX += EXPORT_PADDING;
    maxY += EXPORT_PADDING;
    return {
      x:Math.floor(minX),
      y:Math.floor(minY),
      width:Math.max(320, Math.ceil(maxX - minX)),
      height:Math.max(240, Math.ceil(maxY - minY))
    };
  }

  function canvasScaleFor(width, height){
    const ratio = Math.min(2, Math.max(1, global.devicePixelRatio || 1.5));
    const bySide = Math.min(1, MAX_CANVAS_SIDE / Math.max(width, height));
    const byPixels = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)));
    return Math.max(.25, Math.min(ratio, bySide, byPixels));
  }

  function drawBackground(ctx, bounds){
    ctx.save();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
    ctx.fillStyle = DOT_COLOR;
    const startX = Math.floor(bounds.x / DOT_STEP) * DOT_STEP;
    const startY = Math.floor(bounds.y / DOT_STEP) * DOT_STEP;
    for(let x=startX; x<=bounds.x + bounds.width; x+=DOT_STEP){
      for(let y=startY; y<=bounds.y + bounds.height; y+=DOT_STEP){
        ctx.beginPath();
        ctx.arc(x - bounds.x + 1, y - bounds.y + 1, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function applyCanvasLineDash(ctx, style, strokeWidth){
    const width = Math.max(1, Number(strokeWidth) || 4);
    if(style === 'dashed') ctx.setLineDash([width * 4, width * 2]);
    else if(style === 'dotted') ctx.setLineDash([width, width * 1.5]);
    else ctx.setLineDash([]);
  }

  function linkLineStyle(link){
    const style = link && link.lineStyle;
    if(typeof LINE_STYLES !== 'undefined' && LINE_STYLES && LINE_STYLES.has && LINE_STYLES.has(style)) return style;
    return (typeof DEFAULTS !== 'undefined' && DEFAULTS.linkStyle) || 'solid';
  }

  function linkPathStyle(link){
    const style = link && link.pathStyle;
    if(typeof LINE_PATH_STYLES !== 'undefined' && LINE_PATH_STYLES && LINE_PATH_STYLES.has && LINE_PATH_STYLES.has(style)) return style;
    return (typeof DEFAULTS !== 'undefined' && DEFAULTS.linkPathStyle) || 'curve';
  }

  function drawLinkPath(ctx, a, b, style){
    const dx = b.x - a.x, dy = b.y - a.y, adx = Math.abs(dx), ady = Math.abs(dy);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if(style === 'straight'){
      ctx.lineTo(b.x, b.y);
    }else if(style === 'elbow'){
      if(adx >= ady){
        const mx = Math.round((a.x + b.x) / 2);
        ctx.lineTo(mx, a.y);
        ctx.lineTo(mx, b.y);
        ctx.lineTo(b.x, b.y);
      }else{
        const my = Math.round((a.y + b.y) / 2);
        ctx.lineTo(a.x, my);
        ctx.lineTo(b.x, my);
        ctx.lineTo(b.x, b.y);
      }
    }else{
      const c = Math.max(80, adx * .45);
      ctx.bezierCurveTo(a.x + c, a.y, b.x - c, b.y, b.x, b.y);
    }
  }

  function truncateText(value, len){
    const text = String(value || '').trim();
    if(!text) return '';
    return text.length > len ? text.slice(0, Math.max(1, len - 1)) + '…' : text;
  }

  function drawLinks(ctx, links, nodeMap){
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    links.forEach(link=>{
      const from = nodeMap.get(link.from), to = nodeMap.get(link.to);
      if(!from || !to) return;
      const a = centerForNode(from), b = centerForNode(to);
      const color = safeNodeColor(link.color, (typeof DEFAULTS !== 'undefined' && DEFAULTS.linkColor) || '#2563eb');
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.shadowColor = 'rgba(37,99,235,.16)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 3;
      applyCanvasLineDash(ctx, linkLineStyle(link), 4);
      drawLinkPath(ctx, a, b, linkPathStyle(link));
      ctx.stroke();
      ctx.restore();
    });
    ctx.setLineDash([]);
    links.forEach(link=>{
      const from = nodeMap.get(link.from), to = nodeMap.get(link.to);
      if(!from || !to) return;
      const text = truncateText(link.type || link.note, 12);
      if(!text) return;
      const a = centerForNode(from), b = centerForNode(to);
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2 - 8;
      ctx.save();
      ctx.font = '800 14px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#1e3a8a';
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      ctx.restore();
    });
    ctx.restore();
  }

  function roundedRect(ctx, x, y, w, h, r){
    const radius = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function splitForWrap(text){
    const clean = String(text || '').trim();
    if(!clean) return [];
    if(/\s/.test(clean)) return clean.split(/(\s+)/).filter(Boolean);
    return Array.from(clean);
  }

  function wrapText(ctx, text, maxWidth, maxLines){
    const tokens = splitForWrap(text);
    const lines = [];
    let line = '';
    tokens.forEach(token=>{
      const test = line + token;
      if(line && ctx.measureText(test).width > maxWidth){
        lines.push(line.trim());
        line = token.trimStart();
      }else{
        line = test;
      }
    });
    if(line) lines.push(line.trim());
    if(lines.length > maxLines){
      const kept = lines.slice(0, maxLines);
      let last = kept[kept.length - 1] || '';
      while(last && ctx.measureText(last + '…').width > maxWidth) last = Array.from(last).slice(0, -1).join('');
      kept[kept.length - 1] = (last || Array.from(text).slice(0, 1).join('')) + '…';
      return kept;
    }
    return lines;
  }

  function cardMetrics(node){
    const d = dimsForNode(node);
    if(node && node.size === 'small') return {w:d.w, h:d.h, radius:18, topH:66, icon:46, iconRadius:15, titleFont:13, titlePad:7, maxLines:2};
    if(node && node.size === 'big') return {w:d.w, h:d.h, radius:24, topH:100, icon:70, iconRadius:22, titleFont:17, titlePad:12, maxLines:3};
    return {w:d.w, h:d.h, radius:20, topH:78, icon:56, iconRadius:18, titleFont:15, titlePad:9, maxLines:2};
  }

  function drawCard(ctx, node){
    const p = positionForNode(node), m = cardMetrics(node), color = safeNodeColor(node.color);
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,.14)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    roundedRect(ctx, p.x, p.y, m.w, m.h, m.radius);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundedRect(ctx, p.x, p.y, m.w, m.h, m.radius);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, p.y, 0, p.y + m.topH);
    grad.addColorStop(0, tintColor(color, .88));
    grad.addColorStop(1, '#e5e7eb');
    ctx.fillStyle = grad;
    ctx.fillRect(p.x, p.y, m.w, m.topH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x, p.y + m.topH, m.w, m.h - m.topH);
    ctx.strokeStyle = 'rgba(15,23,42,.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + m.topH + .5);
    ctx.lineTo(p.x + m.w, p.y + m.topH + .5);
    ctx.stroke();
    ctx.restore();

    const iconX = p.x + (m.w - m.icon) / 2, iconY = p.y + (m.topH - m.icon) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,.10)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 8;
    roundedRect(ctx, iconX, iconY, m.icon, m.icon, m.iconRadius);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundedRect(ctx, iconX, iconY, m.icon, m.icon, m.iconRadius);
    ctx.clip();
    ctx.fillStyle = 'rgba(15,23,42,.08)';
    ctx.fillRect(iconX, iconY + m.icon - Math.max(6, m.icon * .16), m.icon, Math.max(6, m.icon * .16));
    ctx.restore();

    const initial = Array.from(String(node.title || '?').trim() || '?')[0] || '?';
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `1000 ${node.size === 'big' ? 25 : node.size === 'small' ? 18 : 20}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
    ctx.fillText(initial, p.x + m.w / 2, iconY + m.icon / 2 + 1);
    ctx.restore();

    const title = String(node.title || '未命名知识点').trim() || '未命名知识点';
    const titleTop = p.y + m.topH, titleH = m.h - m.topH, lineH = Math.round(m.titleFont * 1.2);
    ctx.save();
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `850 ${m.titleFont}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
    const lines = wrapText(ctx, title, m.w - m.titlePad * 2, m.maxLines);
    const totalH = Math.max(lineH, lines.length * lineH);
    let y = titleTop + titleH / 2 - totalH / 2 + lineH / 2;
    lines.forEach(line=>{
      ctx.fillText(line, p.x + m.w / 2, y);
      y += lineH;
    });
    ctx.restore();

    ctx.save();
    roundedRect(ctx, p.x + .5, p.y + .5, m.w - 1, m.h - 1, m.radius);
    ctx.strokeStyle = 'rgba(15,23,42,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function renderGraphCanvas(){
    const nodes = exportNodes();
    if(!nodes.length) throw new Error('当前图谱没有卡牌，暂时无法导出图片。');
    const links = exportLinks();
    const bounds = graphBounds(nodes);
    const scale = canvasScaleFor(bounds.width, bounds.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
    canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
    const ctx = canvas.getContext('2d', {alpha:false});
    if(!ctx) throw new Error('浏览器无法创建导出画布。');
    ctx.scale(scale, scale);
    drawBackground(ctx, bounds);
    ctx.translate(-bounds.x, -bounds.y);
    const nodeMap = new Map(nodes.map(node=>[node.id, node]));
    drawLinks(ctx, links, nodeMap);
    nodes.forEach(node=>drawCard(ctx, node));
    return {canvas, bounds, scale, nodes, links};
  }

  function canvasToBlob(canvas, type='image/png', quality){
    return new Promise((resolve, reject)=>{
      if(!canvas || typeof canvas.toBlob !== 'function'){
        reject(new Error('浏览器不支持图片导出。'));
        return;
      }
      canvas.toBlob(blob=>{
        if(blob) resolve(blob);
        else reject(new Error('图片生成失败。'));
      }, type, quality);
    });
  }

  async function exportPng(options={}){
    const title = options.title || currentGraphTitle();
    showExportStatus('正在生成 PNG 图片…');
    const {canvas} = renderGraphCanvas();
    const blob = await canvasToBlob(canvas, 'image/png');
    const filename = (options.filename || safeFileBase(title) + '-图谱.png');
    downloadBlob(blob, filename);
    showExportStatus('已导出 PNG 图片。');
    return {filename, blob};
  }

  function dataUrlToBytes(dataUrl){
    const base64 = String(dataUrl || '').split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function concatBytes(parts){
    const total = parts.reduce((sum, part)=>sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    parts.forEach(part=>{out.set(part, offset); offset += part.length;});
    return out;
  }

  function makePdfBlobFromJpeg(jpegBytes, imageWidth, imageHeight){
    const aspect = imageWidth / Math.max(1, imageHeight);
    const landscape = aspect >= 1;
    const pageW = landscape ? 841.89 : 595.28;
    const pageH = landscape ? 595.28 : 841.89;
    const margin = 28.35;
    const fitW = pageW - margin * 2;
    const fitH = pageH - margin * 2;
    const drawScale = Math.min(fitW / imageWidth, fitH / imageHeight);
    const drawW = imageWidth * drawScale;
    const drawH = imageHeight * drawScale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const encoder = new TextEncoder();
    const parts = [];
    const offsets = [0];
    let offset = 0;
    function addString(str){const bytes = encoder.encode(str); parts.push(bytes); offset += bytes.length;}
    function addBytes(bytes){parts.push(bytes); offset += bytes.length;}
    function beginObj(id){offsets[id] = offset; addString(`${id} 0 obj\n`);}
    function endObj(){addString('endobj\n');}

    addString('%PDF-1.4\n%KGGraph\n');
    beginObj(1); addString('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj();
    beginObj(2); addString('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n'); endObj();
    beginObj(3); addString(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n`); endObj();
    beginObj(4);
    addString(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    addBytes(jpegBytes);
    addString('\nendstream\n');
    endObj();
    const contentBytes = encoder.encode(content);
    beginObj(5);
    addString(`<< /Length ${contentBytes.length} >>\nstream\n`);
    addBytes(contentBytes);
    addString('endstream\n');
    endObj();

    const xrefOffset = offset;
    addString('xref\n0 6\n');
    addString('0000000000 65535 f \n');
    for(let i=1;i<=5;i++) addString(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    addString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    return new Blob([concatBytes(parts)], {type:'application/pdf'});
  }

  async function exportPdf(options={}){
    const title = options.title || currentGraphTitle();
    showExportStatus('正在生成 PDF 文档…');
    const {canvas} = renderGraphCanvas();
    const jpegDataUrl = canvas.toDataURL('image/jpeg', .94);
    const jpegBytes = dataUrlToBytes(jpegDataUrl);
    const blob = makePdfBlobFromJpeg(jpegBytes, canvas.width, canvas.height);
    const filename = (options.filename || safeFileBase(title) + '-图谱.pdf');
    downloadBlob(blob, filename);
    showExportStatus('已导出 PDF 文档。');
    return {filename, blob};
  }

  async function exportVisual(format, options={}){
    if(format === 'png') return exportPng(options);
    if(format === 'pdf') return exportPdf(options);
    throw new Error('暂不支持该导出格式。');
  }

  global.KGGraphExportService = {
    renderGraphCanvas,
    exportPng,
    exportPdf,
    exportVisual
  };
})(window);
