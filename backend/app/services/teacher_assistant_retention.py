"""Bounded cleanup of private, unexecuted originals and old verbose receipts.

Never remove published resources, executed session sources, operation keys, or
active/retry task payloads. The worker schedules this maintenance separately.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import shutil

from sqlalchemy import cast, exists, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.orm import defer

from app.core.config import settings
from app.models.teacher_assistant import TeacherAssistantSession as Session, TeacherAssistantUpload as Upload, TeacherAssistantJob as Job

EXPIRED_WARNING = '私人原文件和解析缓存已超过 30 天保留期，请重新上传原件再执行。'


def _safe_directory(session_id, upload_id):
    if not all(re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value or '') for value in (session_id, upload_id)):
        return None
    root = Path(settings.TEACHER_ASSISTANT_STORAGE).resolve()
    lexical = root / session_id / upload_id
    resolved = lexical.resolve()
    # Reject symlink escapes and aliases, including a linked session directory.
    if resolved != lexical or root not in resolved.parents or resolved.parent.parent != root:
        return None
    return resolved


def _compact(receipt):
    return {key: receipt[key] for key in ('revision', 'status') if key in receipt} | {
        'items': [{key: entry[key] for key in ('itemId', 'status', 'bankId', 'paperId', 'releaseId') if key in entry}
                  for entry in receipt.get('items', [])]
    }


async def cleanup(db, now=None):
    now = now or datetime.now(timezone.utc)
    upload_cutoff, receipt_cutoff = now - timedelta(days=30), now - timedelta(days=180)
    active = exists(select(Job.id).where(Job.session_id == Session.id,
        or_(Job.status.in_(('queued', 'running')), Job.lease_until > now)))
    expired = exists(select(Upload.id).where(Upload.session_id == Session.id,
        Upload.created_at <= upload_cutoff, Upload.status != 'expired'))
    executed = exists(select(Job.id).where(Job.session_id == Session.id, Job.kind == 'execute'))
    # Receipt age is evaluated using its execution job below. Session timestamp
    # is the conservative fallback for direct-publish message jobs.
    verbose_receipt = Session.receipt.has_key('questionCount') | Session.receipt.has_key('summary') | Session.receipt.op('@?')(cast(literal('$.items[*] ? (exists(@.name) || exists(@.links) || exists(@.error) || exists(@.result))'), JSONPATH))
    old_receipt = verbose_receipt & (Session.updated_at <= receipt_cutoff)
    query = select(Session).where(~active, or_(expired & ~executed, old_receipt)).order_by(Session.updated_at).limit(20).with_for_update(skip_locked=True)
    sessions = (await db.execute(query.options(defer(Session.messages)))).scalars().all()
    counts = {'sessions': 0, 'uploadsExpired': 0, 'receiptsCompacted': 0, 'unsafePathsSkipped': 0}
    for session in sessions:
        jobs = (await db.execute(select(Job).where(Job.session_id == session.id))).scalars().all()
        if any(job.status in ('queued', 'running') or job.lease_until and job.lease_until > now for job in jobs):
            continue
        counts['sessions'] += 1
        receipt = deepcopy(session.receipt or {})
        successful = any(entry.get('status') == 'succeeded' or entry.get('bankId') or entry.get('paperId') or entry.get('releaseId') for entry in receipt.get('items', []))
        if not successful and not any(job.kind == 'execute' for job in jobs):
            uploads = (await db.execute(select(Upload).where(Upload.session_id == session.id,
                Upload.created_at <= upload_cutoff, Upload.status != 'expired'))).scalars().all()
            changed = False
            for upload in uploads:
                directory = _safe_directory(session.id, upload.id)
                if directory is None:
                    counts['unsafePathsSkipped'] += 1
                    continue
                if directory.is_dir():
                    shutil.rmtree(directory)
                elif directory.exists():
                    counts['unsafePathsSkipped'] += 1
                    continue
                upload.extracted = {}; upload.status = 'expired'
                upload.warnings = list(dict.fromkeys([*(upload.warnings or []), EXPIRED_WARNING]))
                counts['uploadsExpired'] += 1; changed = True
            if changed:
                plan = deepcopy(session.plan or {})
                plan['blockers'] = list(dict.fromkeys([*(plan.get('blockers') or []), EXPIRED_WARNING]))
                session.plan = plan; session.revision += 1
        timestamp = max((job.updated_at for job in jobs if job.kind == 'execute'), default=session.updated_at)
        if receipt and timestamp <= receipt_cutoff:
            compact = _compact(receipt)
            if compact != receipt:
                session.receipt = compact
                counts['receiptsCompacted'] += 1
    await db.commit()
    return counts
