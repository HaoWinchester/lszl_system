"""Call the configured Coding Plan through Claude Code, without host tools."""
import asyncio
import json
import os
from pathlib import Path
import signal
import tempfile
from app.core.config import settings
from app.services.teacher_assistant_tool_catalog import definitions

class ModelError(ValueError):
    pass

def command(system_prompt='仅根据用户提供的数据完成教师整理任务，返回 JSON。'):
    return [settings.TEACHER_ASSISTANT_CLAUDE,'--bare','-p','--model',settings.TEACHER_ASSISTANT_MODEL,
            '--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
            '--setting-sources','','--no-session-persistence','--output-format','json',
            '--effort','low','--system-prompt',system_prompt]

def decode_reply(raw):
    text=str(raw).strip()
    if text.startswith('```'):
        text=text.split('\n',1)[-1].rsplit('```',1)[0].strip()
    try: result=json.loads(text)
    except (ValueError,TypeError) as exc: raise ModelError('模型未返回可校验的整理结果，请重试。') from exc
    if not isinstance(result,dict) or not isinstance(result.get('reply'),str):
        raise ModelError('模型返回格式不完整，请重试。')
    if len(result['reply'])>10000: raise ModelError('模型回复超过上限，请拆分需求。')
    return result

async def ask(payload: dict) -> dict:
    # Stateless CLI; application-owned messages preserve multi-turn conversations.
    system_prompt=payload.get('system','仅根据用户提供的数据完成教师整理任务，返回 JSON。')
    prompt=json.dumps({key:value for key,value in payload.items() if key!='system'},ensure_ascii=False)
    if len(prompt.encode())>220000:
        raise ModelError('本次上下文过大，请拆分文档或开启新会话。')
    if not os.environ.get('ANTHROPIC_AUTH_TOKEN') and not os.environ.get('ANTHROPIC_API_KEY'):
        raise ModelError('套餐模型尚未配置，请联系管理员；已保留会话和文件。')
    with tempfile.TemporaryDirectory(prefix='teacher-model-') as cwd, tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as error:
        try:
            process=await asyncio.create_subprocess_exec(*command(system_prompt),stdin=asyncio.subprocess.PIPE,stdout=output,stderr=error,cwd=cwd,start_new_session=True)
        except OSError as exc:
            raise ModelError('套餐调用程序暂不可用，请联系管理员。') from exc
        try:
            await asyncio.wait_for(process.communicate(prompt.encode()),timeout=settings.TEACHER_ASSISTANT_MODEL_TIMEOUT)
        except (TimeoutError,asyncio.CancelledError):
            try: os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            await process.wait()
            raise ModelError('模型响应超时，已保留当前会话，可重试。')
        if output.tell()>2*1024*1024:
            raise ModelError('模型输出过大，请拆分文件。')
        output.seek(0)
        try: envelope=json.load(output)
        except (ValueError,UnicodeError): raise ModelError('套餐调用失败，请检查套餐额度或稍后重试。')
        if process.returncode or envelope.get('is_error'):
            # Provider error text can contain credentials/URLs; never return raw stderr.
            raise ModelError('套餐模型暂不可用或额度不足，稍后重试；不会切换到按量计费接口。')
        return decode_reply(envelope.get('result',''))


def native_session_exists(cwd,session_id):
    """Init may precede the first native transcript write; only resume saved history."""
    return any(path.is_file() and path.stat().st_size for path in (Path(cwd)/"config"/"projects").glob("*/"+session_id+".jsonl"))


def stream_command(session_id,resume,mcp_config,system_prompt):
    return [settings.TEACHER_ASSISTANT_CLAUDE,'--bare','-p','--model',settings.TEACHER_ASSISTANT_MODEL,
        '--tools','','--strict-mcp-config','--mcp-config',json.dumps(mcp_config),
        '--allowedTools',*['mcp__teacher__'+tool['name'] for tool in definitions()],
        '--setting-sources','','--output-format','stream-json','--verbose','--include-partial-messages',
        '--effort','low','--system-prompt',system_prompt,
        '--resume' if resume else '--session-id',session_id]


def public_events(envelope):
    # Do not expose thinking blocks, tool input fragments, init metadata or raw errors.
    event=envelope.get('event',{}) if envelope.get('type')=='stream_event' else {}
    delta=event.get('delta',{}) if event.get('type')=='content_block_delta' else {}
    if delta.get('type')=='text_delta' and isinstance(delta.get('text'),str):
        return [('text_delta',{'text':delta['text']})]
    return []


async def stream_reply(*,session_id,resume,cwd,mcp_config,prompt,system_prompt,on_event,on_started,is_active):
    """One native context per history; idle processes are always released."""
    if not os.environ.get('ANTHROPIC_AUTH_TOKEN') and not os.environ.get('ANTHROPIC_API_KEY'):
        raise ModelError('套餐模型尚未配置，请联系管理员；已保留会话和文件。')
    if len(prompt.encode())>220000: raise ModelError('本次上下文过大，请拆分需求。')
    cwd=Path(cwd);cwd.mkdir(parents=True,exist_ok=True,mode=0o700)
    config=cwd/'config';config.mkdir(exist_ok=True,mode=0o700)
    # Pydantic dotenv values are not os.environ entries. The fresh MCP
    # interpreter runs in this private cwd, so pass its effective configuration
    # through inherited environment, never through CLI args/MCP JSON or logs.
    env={**os.environ,'CLAUDE_CONFIG_DIR':str(config),
        'DATABASE_URL':settings.DATABASE_URL,
        'TEACHER_ASSISTANT_STORAGE':str(Path(settings.TEACHER_ASSISTANT_STORAGE).resolve())}
    output_size=0;reply='';result_seen=False
    requires_tools='teacher' in mcp_config.get('mcpServers',{})
    tools_ready=not requires_tools
    # Neither stderr nor CLI internals are stored as user-facing events.
    try:
        process=await asyncio.create_subprocess_exec(*stream_command(session_id,resume,mcp_config,system_prompt),
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,
            cwd=cwd,env=env,start_new_session=True,limit=1024*1024)
    except OSError as exc: raise ModelError('套餐调用程序暂不可用，请联系管理员。') from exc
    async def consume():
        nonlocal output_size,reply,result_seen,tools_ready
        process.stdin.write(prompt.encode());await process.stdin.drain();process.stdin.close()
        while line:=await process.stdout.readline():
            output_size+=len(line)
            if output_size>8*1024*1024: raise ModelError('模型输出过大，请拆分需求。')
            try: envelope=json.loads(line)
            except (ValueError,UnicodeError): raise ModelError('套餐流格式无效，请稍后重试。')
            if not isinstance(envelope,dict): continue
            if envelope.get('type')=='system' and envelope.get('subtype')=='init':
                if envelope.get('session_id')!=session_id: raise ModelError('会话恢复标识不一致，已停止。')
                if requires_tools:
                    expected={'mcp__teacher__'+tool['name'] for tool in definitions()}
                    connected=any(server.get('name')=='teacher' and server.get('status')=='connected' for server in envelope.get('mcp_servers',[]))
                    tools_ready=connected and expected.issubset(envelope.get('tools',[]))
                    if not tools_ready: raise ModelError('附件工具尚未连接，已保留会话和文件，请重试。')
                await on_started()
            if not tools_ready and envelope.get('type') in ('stream_event','assistant','result'):
                raise ModelError('附件工具尚未就绪，已保留会话和文件，请重试。')
            for kind,data in public_events(envelope):
                if len(reply)+len(data['text'])>64000: raise ModelError('模型回复超过上限，请拆分需求。')
                reply+=data['text'];await on_event(kind,data)
            if envelope.get('type')=='result':
                if envelope.get('is_error'): raise ModelError('套餐模型暂不可用或额度不足，请稍后重试。')
                result_seen=True
                # Some provider routes do not send text deltas. Never pretend those
                # responses streamed; append their final text only when it arrives.
                if not reply and isinstance(envelope.get('result'),str):
                    final=envelope['result']
                    if len(final)>64000: raise ModelError('模型回复超过上限，请拆分需求。')
                    for start in range(0,len(final),2000):
                        await on_event('text_delta',{'text':final[start:start+2000]})
                    reply=final
        await process.wait()
        if process.returncode or not result_seen: raise ModelError('套餐调用中断，已保留当前回复。')
        return reply
    task=asyncio.create_task(consume())
    try:
        deadline=asyncio.get_running_loop().time()+settings.TEACHER_ASSISTANT_MODEL_TIMEOUT
        while not task.done():
            await asyncio.wait([task],timeout=.25)
            if not await is_active(): raise asyncio.CancelledError()
            if asyncio.get_running_loop().time()>deadline: raise ModelError('模型响应超时，已保留当前会话。')
        return await task
    except (ValueError,asyncio.LimitOverrunError) as exc:
        if isinstance(exc,ModelError): raise
        raise ModelError('套餐流超过安全上限或格式无效。') from exc
    finally:
        # The MCP server shares this process group and has no nested model/parser
        # processes. Kill the entire group before the worker releases its locks.
        try: os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        if not task.done(): task.cancel()
        await asyncio.gather(task,return_exceptions=True)
        # Drain the killed process's pipe before wait(): asyncio can otherwise
        # wait forever on a paused/full StreamReader after a size-limit error.
        while await process.stdout.read(65536): pass
        await process.wait()
