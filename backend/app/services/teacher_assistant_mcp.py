"""Minimal newline-delimited MCP stdio transport, scoped by server-created config."""
import asyncio
import json
import os
import sys
from app.services.teacher_assistant_tool_catalog import definitions

async def main():
    owner=os.environ['TEACHER_TOOL_OWNER'];sid=os.environ['TEACHER_TOOL_SESSION'];jid=os.environ['TEACHER_TOOL_JOB']
    # The tool process never needs provider credentials.
    for key in list(os.environ):
        if key.startswith(('ANTHROPIC_','OPENAI_')): os.environ.pop(key,None)
    while True:
        line=await asyncio.to_thread(sys.stdin.buffer.readline,512*1024+1)
        if not line: break
        if len(line)>512*1024: break
        try:
            request=json.loads(line);method=request.get('method');rid=request.get('id')
            if rid is None: continue
            if method=='initialize':
                result={'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'teacher-files','version':'2'}}
            elif method=='ping': result={}
            elif method=='tools/list': result={'tools':definitions()}
            elif method=='tools/call':
                # Keep initialize/tools/list independent of cold database imports.
                from app.services.teacher_assistant_tools import call_tool
                from app.services.teacher_assistant_events import emit
                params=request.get('params',{});name=params.get('name');args=params.get('arguments',{})
                safe_name=name if name in {t['name'] for t in definitions()} else 'unknown'
                # No raw arguments, file contents or exception messages enter public events.
                info={'origin':'mcp','name':safe_name,'label':{'read_file':'正在读取附件','read_image':'正在查看图片','list_files':'正在核对附件','prepare_import':'正在生成预览'}.get(safe_name,'工具调用')}
                if safe_name in ('read_file','read_image') and isinstance(args,dict):
                    try:
                        listing=await call_tool(owner,sid,jid,'list_files',{})
                        match=next((f for f in json.loads(listing['content'][0]['text'])['files'] if f['uploadId']==args.get('uploadId')),None)
                        if match: info.update(uploadId=match['uploadId'],label=info['label']+'：'+match['name'])
                    except Exception: pass
                await emit(sid,jid,'tool_start',info)
                try:
                    result=await call_tool(owner,sid,jid,name,args);ok=True
                except Exception:
                    result={'isError':True,'content':[{'type':'text','text':'工具执行失败：附件不可读取、参数无效或任务已停止。请核对真实文件状态，不得声称读取成功。'}]};ok=False
                await emit(sid,jid,'tool_end',{'origin':'mcp','name':safe_name,'ok':ok})
            else:
                sys.stdout.write(json.dumps({'jsonrpc':'2.0','id':rid,'error':{'code':-32601,'message':'Method not found'}})+'\n');sys.stdout.flush();continue
            sys.stdout.write(json.dumps({'jsonrpc':'2.0','id':rid,'result':result},ensure_ascii=False)+'\n');sys.stdout.flush()
        except (ValueError,TypeError,AttributeError):
            # Malformed transport input is never reflected to stdout/logs.
            continue

if __name__=='__main__': asyncio.run(main())
