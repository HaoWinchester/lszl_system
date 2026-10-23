"""Prepare exactly one explicitly selected UAT paper/question, default read-only."""
import argparse
import asyncio
import json
from app.db.session import AsyncSessionLocal
from app.services.uat_learning_feedback_service import prepare


async def run(args):
    async with AsyncSessionLocal() as db:
        return await prepare(db, release_id=args.release_id, question_id=args.question_id, apply=args.apply)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--question-id', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False))


if __name__ == '__main__':
    main()
