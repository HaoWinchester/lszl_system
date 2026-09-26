"""Office converter service. Deploy ONLY on the internal, no-egress converter network."""
import asyncio
from pathlib import Path
import os
import signal
import tempfile
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import Response
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
MAX_SIZE=20*1024*1024
lock=asyncio.Lock()

@app.get('/health')
async def health(): return {'status':'ok'}

@app.post('/convert')
async def convert(request:Request,target:str):
    if target not in ('docx','pptx'): raise HTTPException(422,'不支持的转换格式')
    # This container has no database, credentials, host mounts, or external network.
    async with lock:
        with tempfile.TemporaryDirectory(prefix='convert-') as directory:
            base=Path(directory);source=base/('input.doc' if target=='docx' else 'input.ppt');size=0
            with source.open('wb') as file:
                async for chunk in request.stream():
                    size+=len(chunk)
                    if size>MAX_SIZE: raise HTTPException(413,'文件超过20MiB')
                    file.write(chunk)
            with source.open('rb') as file: magic=file.read(8)
            if magic!=bytes.fromhex('d0cf11e0a1b11ae1'): raise HTTPException(422,'文件不是有效旧版Office文档')
            profile=base/'profile';(profile/'user').mkdir(parents=True)
            (profile/'user'/'registrymodifications.xcu').write_text('''<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>''')
            try:
                proc=await asyncio.create_subprocess_exec('libreoffice',f'-env:UserInstallation={profile.as_uri()}','--headless','--nologo','--nodefault','--nofirststartwizard','--convert-to',target,'--outdir',directory,str(source),stdin=asyncio.subprocess.DEVNULL,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL,start_new_session=True,env={'PATH':'/usr/bin:/bin','HOME':directory,'LANG':'C.UTF-8'})
            except OSError: raise HTTPException(503,'转换程序不可用')
            try: await asyncio.wait_for(proc.wait(),100)
            except (TimeoutError,asyncio.CancelledError):
                try: os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                await proc.wait();raise HTTPException(504,'文档转换超时')
            output=base/('input.'+target)
            if proc.returncode or not output.is_file(): raise HTTPException(422,'无法转换文档，请检查文件')
            if output.stat().st_size>MAX_SIZE: raise HTTPException(413,'转换结果超过20MiB')
            return Response(output.read_bytes(),media_type='application/octet-stream')
