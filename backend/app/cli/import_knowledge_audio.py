"""Plan or explicitly import an original M4A for one published knowledge node."""
import argparse
import asyncio
import json
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import AsyncSessionLocal
from app.services.knowledge_audio_service import MAX_AUDIO_BYTES, import_audio


async def run(args):
    path = Path(args.file)
    if not path.is_file() or not 16 <= path.stat().st_size <= MAX_AUDIO_BYTES:
        raise ValueError('需要不超过64MB的M4A音频文件')
    data = path.read_bytes()
    async with AsyncSessionLocal() as db:
        return await import_audio(db, actor=args.actor, taxonomy_id=args.taxonomy_id,
            node_id=args.node_id, title=args.title, filename=path.name,
            data=data, duration_ms=args.duration_ms, expected_sha256=args.sha256, apply=args.apply)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', required=True)
    parser.add_argument('--taxonomy-id', required=True)
    parser.add_argument('--node-id', required=True)
    parser.add_argument('--file', required=True)
    parser.add_argument('--title', required=True)
    parser.add_argument('--duration-ms', required=True, type=int)
    parser.add_argument('--sha256')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        result = asyncio.run(run(args))
    except SQLAlchemyError:
        # SQLAlchemy exception parameters can include the original BYTEA body.
        parser.exit(1, json.dumps({'error': '数据库导入失败，未输出音频数据'}, ensure_ascii=False)+'\n')
    except (ValueError, OSError, HTTPException) as error:
        message = error.detail if isinstance(error, HTTPException) else str(error) if isinstance(error, ValueError) else '音频文件不可读取'
        parser.exit(1, json.dumps({'error': message}, ensure_ascii=False)+'\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
