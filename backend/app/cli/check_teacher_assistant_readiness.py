"""Read-only worker deployment gate. Never emit credentials or subprocess output."""
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.request import urlopen

REQUIRED_TABLES = {'teacher_assistant_sessions', 'teacher_assistant_uploads', 'teacher_assistant_jobs'}


def evaluate(*, tables, revisions, heads, checks):
    errors = [f'missing table: {name}' for name in sorted(REQUIRED_TABLES - set(tables))]
    if not heads or set(revisions) != set(heads):
        errors.append('database migrations are not at the current code head')
    errors.extend(f'{name} check failed' for name, passed in checks.items() if passed is not True)
    return {'ok': not errors, 'errors': errors}


def command_ok(arguments):
    try:
        result = subprocess.run(arguments, capture_output=True, timeout=15, check=False)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def worker_running():
    for entry in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            if b'app.worker.teacher_assistant' in entry.read_bytes().split(b'\0'):
                return True
        except OSError:
            continue
    return False


def converter_ready(url):
    # Runtime config is internal only; neither URL nor response is logged.
    for _ in range(10):
        try:
            with urlopen(url.rstrip('/') + '/health', timeout=2) as response:
                if response.status == 200 and json.loads(response.read(1024)).get('status') == 'ok':
                    return True
        except Exception:
            pass
        import time
        time.sleep(1)
    return False


async def inspect_runtime():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import inspect, text
    from app.core.config import settings
    from app.db.session import engine
    storage = Path(settings.TEACHER_ASSISTANT_STORAGE)
    runner = os.environ.get('TEACHER_DOCUMENT_CONVERTER_RUNNER', '')
    checks = {
        'provider credentials': bool((os.environ.get('ANTHROPIC_AUTH_TOKEN') or os.environ.get('ANTHROPIC_API_KEY') or '').strip()),
        'provider endpoint': bool(os.environ.get('ANTHROPIC_BASE_URL', '').strip()),
        'configured model': settings.TEACHER_ASSISTANT_MODEL == 'glm-5.3-flash[1m]',
        'unprivileged worker UID': os.geteuid() == 10001,
        'shared private storage': storage.is_dir() and storage.stat().st_uid == 10001 and os.access(storage, os.R_OK | os.W_OK | os.X_OK),
        'worker process': worker_running(),
        'Claude executable': command_ok([settings.TEACHER_ASSISTANT_CLAUDE, '--version']),
        'conversion runner': bool(runner) and Path(runner).is_file() and os.access(runner, os.X_OK),
        'document tools': all(shutil.which(tool) for tool in ('pdfinfo', 'pdftotext', 'pdftoppm', 'tesseract')),
        'converter health': await asyncio.to_thread(converter_ready, os.environ.get('TEACHER_DOCUMENT_CONVERTER_URL', 'http://document-converter:8090')),
    }
    # Read-only table/head checks also prove the worker's restricted DB account connects.
    async with engine.connect() as connection:
        await connection.execute(text('SET TRANSACTION READ ONLY'))
        tables = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        revisions = set((await connection.execute(text('SELECT version_num FROM alembic_version'))).scalars()) if 'alembic_version' in tables else set()
    heads = set(ScriptDirectory.from_config(Config('alembic.ini')).get_heads())
    return evaluate(tables=tables, revisions=revisions, heads=heads, checks=checks)


if __name__ == '__main__':
    try:
        result = asyncio.run(inspect_runtime())
    except Exception as error:
        result = {'ok': False, 'errors': [f'runtime inspection failed ({type(error).__name__})']}
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
