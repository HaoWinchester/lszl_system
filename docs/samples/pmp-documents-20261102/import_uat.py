"""Import this reviewed batch through existing services, strictly into UAT.

Dry run (default): python import_uat.py --actor admin
Apply: python import_uat.py --actor admin --apply
Verify existing imports: python import_uat.py --actor admin --verify
Run with the UAT backend environment; package JSON/assets must accompany it.
No credentials, original screenshots, or production connection are needed.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine
from app.models.question import Question, QuestionBank
from app.models.question_material import QuestionAsset, QuestionMaterial
from app.models.user import User
from app.schemas.question_catalog import QuestionBankImportRequest
from app.schemas.question_material import AssetInput, MaterialInput
from app.services import question_answer_service as answers
from app.services import question_content_service as content
from app.services import question_group_service as groups
from app.services import question_material_service as materials
from app.services import question_service as questions

ROOT = Path(__file__).resolve().parent
BATCH = 'pmp-documents-20261102'
PACKAGE_FILES = ('text-package.json', 'mini-package.json')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def load_packages():
    manifest = json.loads((ROOT/'manifest.json').read_text())
    for package in manifest['packages']:
        if package['file'] not in PACKAGE_FILES or digest((ROOT/package['file']).read_bytes()) != package['sha256']:
            raise ValueError('题库包校验值不符')
    for asset in manifest['assets']:
        path = (ROOT/asset['file']).resolve()
        if not path.is_relative_to(ROOT/'assets') or digest(path.read_bytes()) != asset['sha256']:
            raise ValueError('图表文件路径或校验值不符')
    packages = [json.loads((ROOT/name).read_text()) for name in PACKAGE_FILES]
    expected_counts = [manifest['textQuestionCount'], manifest['miniQuestionCount']]
    for package, expected in zip(packages, expected_counts):
        assert len(package['bank']['questions']) == expected > 0
        snapshots = []
        for original in package['bank']['questions']:
            q = deepcopy(original)
            assert q['metadata']['documentImport']['batch'] == BATCH
            assert q['type'] in {'single_choice', 'multiple_choice'}
            if q.get('_caseKey'):
                key = q['_caseKey']
                q['material'] = {'id': key, 'revision': 1, **package['materials'][key]}
            issues = answers.validate_question(content.normalize_question_payload(q, subject='PMP'), require_analysis=True)
            if issues:
                raise ValueError(f"{q['id']}校验失败：{issues}")
            snapshots.append(q)
        groups.validate_case_groups(snapshots)
    return packages


async def validate_environment(db, actor_name):
    if settings.ENV != 'uat' or make_url(settings.DATABASE_URL).database != 'kg_graph_uat':
        raise RuntimeError('仅允许 ENV=uat 且数据库kg_graph_uat；已拒绝写入')
    if await db.scalar(text('select current_database()')) != 'kg_graph_uat':
        raise RuntimeError('实际数据库不符')
    actor = await db.get(User, actor_name)
    if actor is None or actor.role != 'admin' or actor.status != 'active':
        raise RuntimeError('必须指定现有启用的UAT管理员')
    return actor


async def ensure_asset(db, actor, filename, alt):
    path = (ROOT/filename).resolve()
    if not path.is_relative_to(ROOT/'assets'):
        raise ValueError('图片必须位于本包assets目录')
    data = path.read_bytes()
    name = BATCH + '-' + digest(data) + path.suffix.lower()
    existing = (await db.scalars(select(QuestionAsset).where(QuestionAsset.owner_id == actor.username, QuestionAsset.filename == name))).all()
    if existing:
        if len(existing) != 1 or existing[0].data != data:
            raise RuntimeError('同批来源图片冲突，已停止')
        return materials.asset_payload(existing[0])
    mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}[path.suffix.lower()]
    return await materials.upload_asset(db, actor, AssetInput(filename=name, mimeType=mime,
        dataBase64=base64.b64encode(data).decode(), alt=alt))


async def prepare_bank(db, actor, package):
    resolved = {}
    for key, value in package['materials'].items():
        title = '[PMP导入20261102] ' + value['title']
        existing = (await db.scalars(select(QuestionMaterial).where(QuestionMaterial.owner_id == actor.username, QuestionMaterial.title == title))).all()
        if existing:
            if len(existing) != 1 or existing[0].text != value['text'] or existing[0].images != value.get('images', []):
                raise RuntimeError(f'同批公共材料冲突：{key}')
            resolved[key] = materials.material_payload(existing[0])
        else:
            resolved[key] = await materials.save_material(db, actor, MaterialInput(title=title, text=value['text'], images=value.get('images', [])))
    bank = deepcopy(package['bank'])
    for q in bank['questions']:
        q['images'] = [await ensure_asset(db, actor, filename, q['title']+'：题目图表') for filename in q.pop('_assetFiles', [])]
        key = q.pop('_caseKey', None)
        if key:
            q['material'] = resolved[key]
            q['caseGroup']['id'] = resolved[key]['id']
    return bank


async def target_state(db, actor, packages):
    ids = [package['bank']['id'] for package in packages]
    banks = (await db.scalars(select(QuestionBank).where(QuestionBank.owner_id == actor.username, QuestionBank.source_id.in_(ids)))).all()
    result = []
    for bank in banks:
        rows = (await db.scalars(select(Question).where(Question.bank_id == bank.id))).all()
        if any((q.content_metadata.get('documentImport') or {}).get('batch') != BATCH for q in rows):
            raise RuntimeError('目标题库已有不属于本批的题目，拒绝覆盖')
        result.append({'bankId': bank.id, 'sourceId': bank.source_id, 'revision': bank.revision,
                       'questionCount': len(rows), 'questions': [{'id': q.id, 'sourceId': q.source_id, 'revision': q.revision, 'hash': q.content_hash} for q in rows]})
    return result


async def verify(db, actor, packages):
    result = []
    for package in packages:
        bank = await db.scalar(select(QuestionBank).where(QuestionBank.owner_id == actor.username, QuestionBank.source_id == package['bank']['id']))
        if bank is None:
            raise RuntimeError('题库尚未导入：'+package['bank']['name'])
        rows = (await db.scalars(select(Question).where(Question.bank_id == bank.id))).all()
        expected = {q['sourceId']: q for q in package['bank']['questions']}
        assert {q.source_id for q in rows} == set(expected)
        snapshots = []
        asset_count = case_count = 0
        for row in rows:
            original = expected[row.source_id]
            actual = questions.question_to_dict(row)
            for field in ('title', 'stemParts', 'analysis', 'type'):
                assert actual[field] == original[field], (row.source_id, field)
            assert [(v['id'],v['text']) for v in actual['options']] == [(v['id'],v['text']) for v in original['options']]
            assert answers.correct_option_ids(actual) == answers.correct_option_ids(original), row.source_id
            assert actual['metadata']['documentImport'] == original['metadata']['documentImport']
            assert actual['scope'] == 'internal'
            for asset, filename in zip(actual.get('images', []), original.get('_assetFiles', []), strict=True):
                stored = await db.get(QuestionAsset, asset['id'])
                assert stored and stored.data == (ROOT/filename).read_bytes()
                asset_count += 1
            if original.get('_caseKey'):
                key = original['_caseKey']
                value = actual['material']
                assert value['text'] == package['materials'][key]['text']
                assert actual['caseGroup'] == {**original['caseGroup'], 'id': value['id']}
                case_count += 1
            snapshots.append(actual)
        # Database order is unspecified; reconstruct package order for grouped validation.
        by_id = {q['sourceId']: q for q in snapshots}
        groups.validate_case_groups([by_id[q['sourceId']] for q in package['bank']['questions']])
        result.append({'bankId': bank.id, 'sourceId': bank.source_id, 'name': bank.name,
                       'questionCount': len(rows), 'caseChildCount': case_count, 'imageReferences': asset_count,
                       'verified': True})
    return result


async def main(args):
    packages = load_packages()
    try:
        async with AsyncSessionLocal() as db:
            actor = await validate_environment(db, args.actor)
            before = await target_state(db, actor, packages)
            if args.verify:
                result = {'environment': 'uat', 'banks': await verify(db, actor, packages)}
                (ROOT/'verified.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
                print(json.dumps(result, ensure_ascii=False))
                return
            plan = {'environment': 'uat', 'batch': BATCH, 'apply': args.apply, 'existing': before,
                    'incoming': [{'sourceId': p['bank']['id'], 'name': p['bank']['name'], 'questions': len(p['bank']['questions']),
                                  'materials': len(p['materials'])} for p in packages]}
            if not args.apply:
                print(json.dumps(plan, ensure_ascii=False))
                return
            (ROOT/'before-import.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2)+'\n')
            prepared = [await prepare_bank(db, actor, package) for package in packages]
            request = QuestionBankImportRequest.model_validate({'banks': prepared})
            receipt = await questions.import_question_banks(db, actor, request)
            # No replacement or duplicate-cleanup flags: unrelated content can never be removed.
            result = {'environment': 'uat', 'batch': BATCH, 'importPlan': receipt['importPlan'],
                      'banks': await verify(db, actor, packages)}
            (ROOT/'imported.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
            print(json.dumps(result, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--apply', action='store_true')
    modes.add_argument('--verify', action='store_true')
    asyncio.run(main(parser.parse_args()))
