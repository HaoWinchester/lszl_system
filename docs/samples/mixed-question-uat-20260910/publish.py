"""Publish this reviewed sample through application services, only in UAT.

Run inside the UAT backend: PYTHONPATH=/app/backend python publish.py --actor admin
The JSON and PNG must be next to this script. No production connection allowed.
"""
import argparse
import asyncio
import base64
import json
from copy import deepcopy
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.question import ExamPaper, Question, QuestionBank
from app.models.question_material import QuestionMaterial
from app.models.paper_release import PaperRelease
from app.models.user import User
from app.schemas.paper import PaperCreateRequest
from app.schemas.question_material import AssetInput, MaterialInput
from app.services import question_service, question_material_service, paper_service, paper_release_service


async def main(actor_name):
    if make_url(settings.DATABASE_URL).database != 'kg_graph_uat':
        raise RuntimeError('This sample publisher is restricted to kg_graph_uat')
    root = Path(__file__).resolve().parent
    content = json.loads((root / 'paper.json').read_text())
    async with AsyncSessionLocal() as db:
        actor = await db.get(User, actor_name)
        if not actor or actor.role != 'admin' or actor.status != 'active':
            raise RuntimeError('An existing active UAT administrator is required')
        bank_name = '新题型体验题库（2026-09-10）'
        bank = await db.scalar(select(QuestionBank).where(
            QuestionBank.name == bank_name, QuestionBank.owner_id == actor_name))
        if bank is None:
            bank = await question_service.create_bank(db, actor, {
                'name': bank_name, 'subject': 'PMP', 'description': content['description']})
        bank_id = bank.id
        material = await db.scalar(select(QuestionMaterial).where(
            QuestionMaterial.title == content['material']['title'],
            QuestionMaterial.owner_id == actor_name,
            QuestionMaterial.text == content['material']['text']))
        if material is None:
            material_payload = await question_material_service.save_material(
                db, actor, MaterialInput(**content['material']))
        else:
            material_payload = question_material_service.material_payload(material)
        refs = []
        for order, original in enumerate(content['questions'], 1):
            question = await db.scalar(select(Question).where(
                Question.bank_id == bank_id, Question.title == original['title']))
            if question is None:
                payload = deepcopy(original)
                image_file = payload.pop('imageFile', None)
                case_order = payload.pop('caseOrder', None)
                if image_file:
                    asset = await question_material_service.upload_asset(db, actor, AssetInput(
                        filename=image_file, mimeType='image/png',
                        dataBase64=base64.b64encode((root / image_file).read_bytes()).decode(),
                        alt='测试协议表：列出单元、集成、端到端、功能、性能、安全、兼容性、回归与用户验收测试的说明及验收标准。'))
                    payload['images'] = [asset]
                if case_order:
                    payload['material'] = material_payload
                    payload['caseGroup'] = {'id': material_payload['id'], 'order': case_order, 'total': 3}
                question = await question_service.create_question(db, actor, bank_id, payload)
            refs.append({'bankId': bank_id, 'questionId': question.id, 'order': order, 'score': 1})
        paper = await db.scalar(select(ExamPaper).where(
            ExamPaper.name == content['name'], ExamPaper.owner_id == actor_name,
            ExamPaper.deleted_at.is_(None)))
        if paper is None:
            created = await paper_service.create_paper(db, actor, PaperCreateRequest(
                name=content['name'], subject='PMP', paperType='mixed',
                description=content['description'], totalCount=5,
                enabledModes=['practice_mode'], questions=refs))
            paper = await db.get(ExamPaper, created['id'])
        release = await db.get(PaperRelease, paper.published_release_id) if paper.published_release_id else None
        # This UAT demo must also remain visible after an administrator or teacher logs in.
        allowed_roles = ['admin', 'teacher', 'student', 'viewer']
        if release is None or release.status != 'published' or set(release.allowed_roles or []) != set(allowed_roles):
            await paper_release_service.publish(
                db, actor, paper.id, expected_revision=paper.revision,
                access_level='free', enabled_modes=['practice_mode'], allowed_roles=allowed_roles,
                metadata=deepcopy(release.release_metadata or {}) if release else {})
            await db.refresh(paper)
        result = await paper_service.get_paper(db, actor, paper.id)
        assert result['questionCount'] == 5, result['questionCount']
        print(json.dumps({
            'paperId': paper.id, 'bankId': bank_id, 'releaseId': paper.published_release_id,
            'name': paper.name, 'questionCount': 5, 'questions': refs,
            'url': 'https://uat.aihuanpu.com/practice-mode.html',
        }, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', required=True)
    asyncio.run(main(parser.parse_args().actor))
