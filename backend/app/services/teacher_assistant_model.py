"""Call the configured Coding Plan through Claude Code, without host tools."""
import asyncio
import json
import os
from pathlib import Path
import signal
import tempfile
from app.core.config import settings

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
