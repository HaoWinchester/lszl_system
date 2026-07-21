'use strict';

/*
 * 基线重构 C：
 * 首页学习包 ZIP 导入 / 导出服务。
 *
 * 说明：
 * - 只负责学习包文件格式、ZIP 打包、ZIP/JSON 解析和下载。
 * - 不直接读写首页全局 state，不直接 render，不直接 showStatus。
 * - 业务脚本通过 window.KGHomePackageService 调用，降低 20-flashcards-toolbar.js 体积。
 */
(function(global){
  const FORMAT='kg-graph-learning-package';
  const VERSION='1.0.0';
  const MAX_ZIP_BYTES=50*1024*1024;
  const MAX_JSON_BYTES=30*1024*1024;
  const MAX_ZIP_ENTRIES=50;
  const MAX_ENTRY_BYTES=30*1024*1024;
  const MAX_TOTAL_UNCOMPRESSED_BYTES=60*1024*1024;

  function textEncoder(){return new TextEncoder()}
  function textDecoder(){return new TextDecoder('utf-8')}

  function safeFileBase(value){
    return String(value||'知识图谱')
      .trim()
      .replace(/[\\/:*?"<>|]/g,'_')
      .replace(/\s+/g,'_')
      .slice(0,80)||'知识图谱';
  }

  function dosDateTime(date=new Date()){
    const year=Math.max(1980,date.getFullYear());
    const dosTime=(date.getHours()<<11)|(date.getMinutes()<<5)|Math.floor(date.getSeconds()/2);
    const dosDate=((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate();
    return {dosTime,dosDate};
  }

  const crcTable=(()=>{
    const table=new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;
      for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
      table[i]=c>>>0;
    }
    return table;
  })();

  function crc32(bytes){
    let crc=0xffffffff;
    for(let i=0;i<bytes.length;i++) crc=crcTable[(crc^bytes[i])&0xff]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }

  function u16(value){return [value&255,(value>>>8)&255]}
  function u32(value){return [value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255]}

  function bytes(value){
    if(value instanceof Uint8Array)return value;
    return textEncoder().encode(String(value??''));
  }

  function makeZip(entries){
    const parts=[],central=[];
    let offset=0;
    const {dosTime,dosDate}=dosDateTime();
    entries.forEach(entry=>{
      const nameBytes=bytes(entry.name);
      const data=bytes(entry.data);
      const crc=crc32(data);
      const local=new Uint8Array([
        ...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),
        ...u16(dosTime),...u16(dosDate),...u32(crc),...u32(data.length),...u32(data.length),
        ...u16(nameBytes.length),...u16(0)
      ]);
      parts.push(local,nameBytes,data);
      const centralHeader=new Uint8Array([
        ...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),
        ...u16(dosTime),...u16(dosDate),...u32(crc),...u32(data.length),...u32(data.length),
        ...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)
      ]);
      central.push(centralHeader,nameBytes);
      offset+=local.length+nameBytes.length+data.length;
    });
    const centralOffset=offset;
    let centralSize=0;
    central.forEach(part=>centralSize+=part.length);
    const end=new Uint8Array([
      ...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),
      ...u32(centralSize),...u32(centralOffset),...u16(0)
    ]);
    return new Blob([...parts,...central,end],{type:'application/zip'});
  }

  function readU16(bytes,offset){return bytes[offset]|(bytes[offset+1]<<8)}
  function readU32(bytes,offset){return (bytes[offset]|(bytes[offset+1]<<8)|(bytes[offset+2]<<16)|(bytes[offset+3]<<24))>>>0}

  function findEndOfCentralDirectory(bytes){
    const min=Math.max(0,bytes.length-65557);
    for(let i=bytes.length-22;i>=min;i--){
      if(readU32(bytes,i)===0x06054b50)return i;
    }
    return -1;
  }

  async function inflateRaw(bytes){
    if(typeof DecompressionStream==='undefined')throw new Error('当前浏览器不支持读取压缩 ZIP，请使用本系统导出的学习包，或导入旧 JSON。');
    const tryFormats=['deflate-raw','deflate'];
    let lastErr=null;
    for(const format of tryFormats){
      try{
        const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }catch(err){lastErr=err}
    }
    throw lastErr||new Error('无法解压 ZIP 内容。');
  }

  async function readZipTextEntries(file){
    if(!file||typeof file.arrayBuffer!=='function')throw new Error('未选择有效的 ZIP 文件。');
    if(Number(file.size)>MAX_ZIP_BYTES)throw new Error('ZIP 文件过大，最大允许 50 MB。');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length>MAX_ZIP_BYTES)throw new Error('ZIP 文件过大，最大允许 50 MB。');
    const eocd=findEndOfCentralDirectory(bytes);
    if(eocd<0)throw new Error('不是有效的 ZIP 学习包。');
    const total=readU16(bytes,eocd+10);
    if(total>MAX_ZIP_ENTRIES)throw new Error(`ZIP 条目过多，最多允许 ${MAX_ZIP_ENTRIES} 个文件。`);
    let ptr=readU32(bytes,eocd+16);
    if(ptr<0||ptr>=bytes.length)throw new Error('ZIP 中央目录位置异常。');
    const out={};let totalUncompressed=0,actualUncompressed=0;
    for(let i=0;i<total;i++){
      if(ptr+46>bytes.length||readU32(bytes,ptr)!==0x02014b50)throw new Error('ZIP 目录结构异常。');
      const method=readU16(bytes,ptr+10);
      const expectedCrc=readU32(bytes,ptr+16);
      const compSize=readU32(bytes,ptr+20);
      const uncompSize=readU32(bytes,ptr+24);
      if(uncompSize>MAX_ENTRY_BYTES)throw new Error('ZIP 中存在过大的文件，单个文件最大允许 30 MB。');
      totalUncompressed+=uncompSize;
      if(totalUncompressed>MAX_TOTAL_UNCOMPRESSED_BYTES)throw new Error('ZIP 解压后的总大小过大，最大允许 60 MB。');
      const nameLen=readU16(bytes,ptr+28);
      const extraLen=readU16(bytes,ptr+30);
      const commentLen=readU16(bytes,ptr+32);
      const localOffset=readU32(bytes,ptr+42);
      const nextPtr=ptr+46+nameLen+extraLen+commentLen;
      if(nextPtr>bytes.length)throw new Error('ZIP 目录条目越界。');
      const name=textDecoder().decode(bytes.slice(ptr+46,ptr+46+nameLen));
      ptr=nextPtr;
      if(localOffset+30>bytes.length||readU32(bytes,localOffset)!==0x04034b50)continue;
      const localNameLen=readU16(bytes,localOffset+26);
      const localExtraLen=readU16(bytes,localOffset+28);
      const dataStart=localOffset+30+localNameLen+localExtraLen;
      if(dataStart<0||dataStart+compSize>bytes.length)throw new Error('ZIP 压缩数据越界。');
      const compressed=bytes.slice(dataStart,dataStart+compSize);
      let data;
      if(method===0)data=compressed;
      else if(method===8)data=await inflateRaw(compressed);
      else continue;
      if(data.length>MAX_ENTRY_BYTES)throw new Error('ZIP 解压后的单个文件过大。');
      actualUncompressed+=data.length;
      if(actualUncompressed>MAX_TOTAL_UNCOMPRESSED_BYTES)throw new Error('ZIP 实际解压后的总大小过大。');
      if(crc32(data)!==expectedCrc)throw new Error(`ZIP 文件校验失败：${name||'未命名条目'}`);
      out[name]=textDecoder().decode(data);
    }
    return out;
  }

  function createReadme(clean){
    const meta=clean&&clean.meta||{};
    return [
      '知识图谱学习包',
      '',
      '这是由“通用知识点关系图谱工具”导出的 ZIP 学习包。',
      '你可以直接把整个 ZIP 文件发给老师、同学，或在另一台电脑上通过“导入学习包”恢复。',
      '',
      '包含内容：',
      '- manifest.json：学习包说明',
      '- graph.json：知识图谱数据',
      '',
      '图谱标题：'+(meta.title||'知识图谱'),
      '学科/课程：'+(meta.subject||'通用课程'),
      '导出时间：'+new Date().toLocaleString('zh-CN',{hour12:false}),
      '',
      '提示：请不要手动修改压缩包内的文件，避免导入失败。'
    ].join('\n');
  }

  function buildManifest(clean){
    clean=clean||{};
    return {
      format:FORMAT,
      version:VERSION,
      exportedAt:new Date().toISOString(),
      title:clean.meta&&clean.meta.title||'知识图谱',
      subject:clean.meta&&clean.meta.subject||'通用课程',
      nodeCount:Array.isArray(clean.nodes)?clean.nodes.length:0,
      linkCount:Array.isArray(clean.links)?clean.links.length:0,
      entry:'graph.json'
    };
  }

  function buildPackageBlob(clean){
    const manifest=buildManifest(clean);
    const blob=makeZip([
      {name:'manifest.json',data:JSON.stringify(manifest,null,2)},
      {name:'graph.json',data:JSON.stringify(clean,null,2)},
      {name:'README.txt',data:createReadme(clean)}
    ]);
    return {blob,manifest};
  }

  function downloadBlob(blob,filename){
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),120);
  }

  function downloadPackage(clean,options={}){
    const built=buildPackageBlob(clean);
    const filename=options.filename||safeFileBase(built.manifest.title)+'-学习包.zip';
    downloadBlob(built.blob,filename);
    return {filename,manifest:built.manifest};
  }

  async function parseFile(file){
    const name=String(file&&file.name||'').toLowerCase();
    if(name.endsWith('.zip')||/zip/.test(String(file&&file.type||''))){
      const entries=await readZipTextEntries(file);
      const graphText=entries['graph.json']||entries['data/graph.json']||entries['知识图谱.json'];
      if(!graphText)throw new Error('ZIP 中未找到 graph.json。');
      const manifestText=entries['manifest.json'];
      if(manifestText){
        const manifest=JSON.parse(manifestText.replace(/^\uFEFF/,''));
        if(manifest&&manifest.format&&manifest.format!==FORMAT)throw new Error('ZIP 不是受支持的知识图谱学习包。');
        if(manifest&&manifest.entry&& !['graph.json','data/graph.json','知识图谱.json'].includes(String(manifest.entry)))throw new Error('学习包入口文件声明无效。');
      }
      return JSON.parse(graphText.replace(/^\uFEFF/,''));
    }
    if(Number(file&&file.size)>MAX_JSON_BYTES)throw new Error('JSON 文件过大，最大允许 30 MB。');
    const raw=(await file.text()).replace(/^\uFEFF/,'');
    if(new Blob([raw]).size>MAX_JSON_BYTES)throw new Error('JSON 文件过大，最大允许 30 MB。');
    return JSON.parse(raw);
  }

  global.KGHomePackageService = {
    FORMAT,
    VERSION,
    MAX_ZIP_BYTES,MAX_JSON_BYTES,MAX_ZIP_ENTRIES,MAX_ENTRY_BYTES,MAX_TOTAL_UNCOMPRESSED_BYTES,
    safeFileBase,
    makeZip,
    readZipTextEntries,
    createReadme,
    buildManifest,
    buildPackageBlob,
    downloadPackage,
    parseFile
  };
})(window);
