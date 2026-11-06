"""Plan or explicitly seed an isolated UAT knowledge sky demo; read-only by default."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

from app.db.session import AsyncSessionLocal
from app.services.uat_knowledge_demo_service import DEFAULT_USERNAME, prepare


async def run(args, password=None):
    async with AsyncSessionLocal() as db:
        return await prepare(db, username=args.username, password=password, apply=args.apply)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', default=DEFAULT_USERNAME)
    parser.add_argument('--apply', action='store_true')
    secret = parser.add_mutually_exclusive_group()
    secret.add_argument('--password-file', help='Private file used only when creating the demo account')
    secret.add_argument('--password-stdin', action='store_true', help='Read the new-account password from stdin')
    args = parser.parse_args()
    password = None
    if args.apply:
        if args.password_file:
            password = Path(args.password_file).read_text().rstrip('\r\n')
        elif args.password_stdin:
            password = sys.stdin.readline().rstrip('\r\n')
    print(json.dumps(asyncio.run(run(args, password)), ensure_ascii=False))


if __name__ == '__main__':
    main()
