#!/usr/bin/env python3
"""Read-only audit of published explanation availability; never prints question text."""
from __future__ import annotations

import asyncio
import html
import json
from pathlib import Path
import re
import sys


def _present(value) -> bool:
    if not isinstance(value, str):
        return False
    if re.search(r'<(?:img|svg|video|audio)\b', value, re.I):
        return True
    return bool(html.unescape(re.sub(r'<[^>]*>', '', value)).strip())


def explanation_presence(snapshot: dict) -> tuple[bool, bool]:
    translations = snapshot.get('translations') or {}
    zh, en = translations.get('zh') or {}, translations.get('en') or {}
    keys = ('analysis', 'explanation', 'rationale', 'solution')
    chinese = any(_present(snapshot.get(key)) or _present(zh.get(key)) for key in keys)
    english = any(_present(en.get(key)) for key in keys) or any(
        _present(snapshot.get(key)) for key in ('analysisEn', 'explanationEn'))
    return chinese, english


async def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sqlalchemy import select, text
    from app.db.session import AsyncSessionLocal
    from app.models.paper_release import PaperRelease, PaperReleaseQuestion

    async with AsyncSessionLocal() as db:
        await db.execute(text('SET TRANSACTION READ ONLY'))
        rows = (await db.execute(select(
            PaperRelease.id, PaperRelease.paper_id, PaperRelease.version,
            PaperRelease.question_count, PaperReleaseQuestion.question_id,
            PaperReleaseQuestion.order_index, PaperReleaseQuestion.snapshot,
        ).outerjoin(PaperReleaseQuestion, PaperReleaseQuestion.release_id == PaperRelease.id)
         .where(PaperRelease.status == 'published')
         .order_by(PaperRelease.id, PaperReleaseQuestion.order_index))).all()
        releases = {}
        for release_id, paper_id, version, expected, question_id, order, snapshot in rows:
            row = releases.setdefault(release_id, {
                'releaseId': release_id, 'paperId': paper_id, 'version': version,
                'expectedQuestions': expected, 'questions': 0, 'missingChinese': 0,
                'missingEnglish': 0, 'missingExplanation': [],
            })
            if question_id is None:
                continue
            chinese, english = explanation_presence(snapshot or {})
            row['questions'] += 1
            row['missingChinese'] += int(not chinese)
            row['missingEnglish'] += int(not english)
            if not chinese and not english:
                row['missingExplanation'].append({'questionId': question_id, 'orderIndex': order})
        await db.rollback()
    print(json.dumps({
        'scope': 'currently published releases in the configured database',
        'readOnly': True,
        'note': 'Presence check only; answer correctness and explanation quality require human review.',
        'releases': list(releases.values()),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
