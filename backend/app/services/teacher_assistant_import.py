"""Lossless teacher plans and resumable calls through existing import boundaries."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import base64
from io import BytesIO
from pathlib import Path
import warnings
from PIL import Image
import json
import re

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from app.core.config import settings
from app.models.question_material import QuestionAsset
from app.schemas.question_material import AssetInput
from app.models.content_prep import Principle
from app.models.question import ExamPaper, Question, QuestionBank
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.teacher_assistant import TeacherAssistantSession
from app.schemas.paper import PaperImportPreflightRequest, PaperImportRequest, PaperUpdateRequest, PaperQuestionReplaceRequest
from app.schemas.question_catalog import QuestionBankImportRequest, QuestionPayload, QuestionBankImportQuestionPayload
from app.services import content_prep_shared_service, paper_import_service, paper_release_service, question_answer_service, question_content_service, question_service, teaching_content_projection_service, question_material_service, idempotency_service, paper_service, teaching_content_revision_service


def _error(status, code, message):
    return HTTPException(status_code=status, detail={'code': code, 'message': message})


def _identity(*parts):
    return hashlib.sha256('::'.join(str(part) for part in parts).encode()).hexdigest()[:40]


def _source_image(session_id, upload_id, filename):
    if any(not isinstance(value, str) or value in {'', '.', '..'} or Path(value).name != value or '/' in value or '\\' in value for value in (session_id, upload_id)):
        raise ValueError('来源图片归属路径无效。')
    if not isinstance(filename, str) or Path(filename).name != filename or '/' in filename or '\\' in filename:
        raise ValueError('来源图片路径无效。')
    directory = (Path(settings.TEACHER_ASSISTANT_STORAGE) / session_id / upload_id / 'extracted').resolve()
    path = (directory / filename).resolve()
    if path.parent != directory or not path.is_file():
        raise ValueError('来源图片不存在，请重新解析。')
    if path.stat().st_size > 5 * 1024 * 1024:
        raise ValueError('来源图片超过 5 MiB，请压缩或拆分。')
    data = path.read_bytes()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.width * image.height > 40_000_000:
                    raise ValueError('pixels')
                if getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('multiple frames')
                image_format = image.format
                if image_format not in {'PNG', 'JPEG', 'WEBP', 'GIF', 'BMP', 'TIFF'}:
                    raise ValueError('format')
                image.verify()
            if image_format not in {'PNG', 'JPEG', 'WEBP'}:
                with Image.open(BytesIO(data)) as image:
                    image.seek(0)
                    output = BytesIO()
                    image.convert('RGB').save(output, format='PNG')
                    data = output.getvalue()
                image_format = 'PNG'
    except Exception as exc:
        raise ValueError('来源图片格式无效或像素超过安全上限。') from exc
    if len(data) > 5 * 1024 * 1024:
        raise ValueError('转换后图片超过 5 MiB，请压缩或拆分。')
    mime = {'PNG': 'image/png', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp'}[image_format]
    return data, mime, hashlib.sha256(data).hexdigest()


async def _ensure_source_asset(db, actor, session_id, image):
    data, mime, digest = _source_image(session_id, image['uploadId'], image['filename'])
    if digest != image['digest'] or mime != image['mimeType']:
        raise _error(409, 'SOURCE_IMAGE_CHANGED', '来源图片已变化，请重新预览。')
    extension = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}[mime]
    name = 'ta-image-' + _identity(actor.username, session_id, image['uploadId'], image['filename'], digest) + extension
    await idempotency_service.lock(db, actor.username, name)
    existing = (await db.execute(select(QuestionAsset).where(QuestionAsset.owner_id == actor.username, QuestionAsset.filename == name).limit(2))).scalars().all()
    if existing:
        if len(existing) != 1 or existing[0].data != data or existing[0].mime_type != mime:
            raise _error(409, 'SOURCE_IMAGE_ASSET_CONFLICT', '来源图片资源冲突，请联系管理员。')
        return question_material_service.asset_payload(existing[0])
    return await question_material_service.upload_asset(db, actor, AssetInput(filename=name, mimeType=mime, dataBase64=base64.b64encode(data).decode(), alt=f"{image['location']} 来源图片"))


def _banks(data):
    if isinstance(data, list):
        if all(isinstance(item, dict) and isinstance(item.get('questions'), list) for item in data):
            return deepcopy(data)
        return [{'id': 'questions', 'questions': deepcopy(data)}]
    if isinstance(data, dict):
        if isinstance(data.get('banks'), list):
            return deepcopy(data['banks'])
        if isinstance(data.get('questions'), list):
            return [deepcopy(data)]
    return []


def _principle_bundle(data):
    return isinstance(data, dict) and (data.get("format") in {"kg-principle-card-bundle-v1", "pmp-principle-preset-bundle-v1"} or (("principles" in data or "principleRepository" in data) and any(key in data for key in ("synthesisPresets", "presets", "synthesisPresetRepository"))))


async def _reference_blockers(db, questions, incoming_principle_ids=None):
    identifiers = set()
    recall_ids = {str(clue['recallNodeId']) for question in questions for clue in (question.get('clues') or []) if isinstance(clue, dict) and clue.get('recallNodeId')}
    recall_blockers = []
    if recall_ids:
        if len(recall_ids) > 1000:
            recall_blockers.append('联想词关联超过检索上限。')
        else:
            existing_nodes = (await db.execute(text("SELECT DISTINCT node->>'id' FROM recall_association_libraries, jsonb_array_elements(nodes) node WHERE status = 'published' AND node->>'id' = ANY(CAST(:ids AS text[])) LIMIT 1000"), {'ids': sorted(recall_ids)})).scalars().all()
            recall_blockers.extend(f'引用联想词不存在或不可用：{value}' for value in sorted(recall_ids - set(existing_nodes)))
    for question in questions:
        metadata = question.get('metadata') or {}
        identifiers.update(metadata.get('principleIds') or [])
        identifiers.update(metadata.get('stemPrincipleIds') or [])
        for values in (metadata.get('optionPrincipleMap') or {}).values():
            identifiers.update(values or [])
    if not identifiers:
        return recall_blockers
    if len(identifiers) > 1000:
        return ['关联原则超过检索上限。']
    existing = (await db.execute(select(Principle.id).where(Principle.id.in_(identifiers), Principle.status == 'active').limit(1000))).scalars().all()
    missing = identifiers - set(existing) - set(incoming_principle_ids or [])
    return recall_blockers + [f'引用原则不存在或不可用：{value}' for value in sorted(missing)]


def _validated_model_result(result):
    if not isinstance(result, dict):
        raise _error(422, 'ASSISTANT_MODEL_INVALID', '模型结果必须是对象。')
    result = deepcopy(result)
    errors = []
    if not isinstance(result.get('blockers', []), list) or any(not isinstance(value, str) for value in result.get('blockers', [])):
        errors.append('模型 blockers 必须为字符串数组。')
        result['blockers'] = []
    raw_settings = result.get('settings', {})
    if not isinstance(raw_settings, dict):
        errors.append('模型 settings 必须为对象。')
        result['settings'] = {}
    else:
        for flag in ('publish', 'directPublish'):
            if flag in raw_settings and type(raw_settings[flag]) is not bool:
                errors.append(f'{flag} 必须为布尔值。')
                raw_settings[flag] = False
        for key in ('allowedRoles', 'enabledModes'):
            if key in raw_settings and (not isinstance(raw_settings[key], list) or any(not isinstance(value, str) for value in raw_settings[key])):
                errors.append(f'{key} 必须为字符串数组。')
                raw_settings[key] = []
        if 'names' in raw_settings and (not isinstance(raw_settings['names'], dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in raw_settings['names'].items())):
            errors.append('names 必须为名称字符串映射。')
            raw_settings['names'] = {}
        for key in ('nameSuffix', 'accessLevel', 'duplicatePolicy'):
            if key in raw_settings and not isinstance(raw_settings[key], str) and not (key == 'duplicatePolicy' and raw_settings[key] is None):
                errors.append(f'{key} 必须为字符串。')
                raw_settings[key] = {'nameSuffix': '', 'accessLevel': 'private', 'duplicatePolicy': None}[key]
    raw_items = result.get('items', [])
    if not isinstance(raw_items, list) or any(not isinstance(item, dict) for item in raw_items):
        errors.append('模型 items 必须为对象数组。')
        result['items'] = []
    else:
        for item in raw_items:
            if not isinstance(item.get('uploadId'), str):
                errors.append('模型 uploadId 必须为字符串。')
                item['uploadId'] = ''
            if 'questions' in item and (not isinstance(item['questions'], list) or any(not isinstance(question, dict) for question in item['questions'])):
                errors.append('模型 questions 必须为题目对象数组。')
                item['questions'] = []
            for key in ('selectedQuestionIds', 'excludedQuestionIds', 'reviewedQuestionIds'):
                if key in item and (not isinstance(item[key], list) or any(not isinstance(value, str) for value in item[key])):
                    errors.append(f'{key} 必须为 ID 字符串数组。')
                    item.pop(key)
            if 'questionPatches' in item and (not isinstance(item['questionPatches'], list) or any(not isinstance(value, dict) or not isinstance(value.get('questionId'), str) or not isinstance(value.get('patch'), dict) for value in item['questionPatches'])):
                errors.append('questionPatches 必须为题目 ID 与 patch 对象数组。')
                item['questionPatches'] = []
            if 'principleResolutions' in item and (not isinstance(item['principleResolutions'], list) or any(not isinstance(value, dict) or not isinstance(value.get('conflictId'), str) or not isinstance(value.get('resolution'), str) for value in item['principleResolutions'])):
                errors.append('principleResolutions 必须为对象数组。')
                item['principleResolutions'] = []
    if 'reviewedQuestionIds' in result and (not isinstance(result['reviewedQuestionIds'], list) or any(not isinstance(value, str) for value in result['reviewedQuestionIds'])):
        errors.append('reviewedQuestionIds 必须为 ID 字符串数组。')
        result['reviewedQuestionIds'] = []
    for key in ('reply', 'userInstruction'):
        if key in result and not isinstance(result[key], str):
            errors.append(f'{key} 必须为字符串。')
            result[key] = ''
    result.setdefault('blockers', []).extend(errors)
    return result


def _desired_question_hash(question, subject):
    raw = QuestionBankImportQuestionPayload.model_validate(question).model_dump(by_alias=True)
    normalized = question_content_service.normalize_question_payload(raw, subject=subject)
    normalized['scope'] = 'internal'
    return question_content_service.canonical_question_hash(normalized)


async def _bank_matches(db, bank, payload):
    if any(getattr(bank, field) != payload.get(field, {'subject': 'PMP', 'version': '1.0', 'visibility': 'private'}.get(field)) for field in ('name', 'subject', 'description', 'version', 'visibility')):
        return False
    rows = (await db.execute(select(Question).where(Question.bank_id == bank.id).limit(501).execution_options(populate_existing=True))).scalars().all()
    hashes = {str(row.source_id or row.id): row.content_hash for row in rows}
    return len(rows) == len(payload['questions']) and all(hashes.get(question['sourceId']) == _desired_question_hash(question, payload.get('subject') or 'PMP') for question in payload['questions'])


def _paper_view(payload):
    view = {key: deepcopy(payload.get(key)) for key in ('name', 'subject', 'description', 'paperType', 'totalCount', 'enabledModes', 'accessPolicy', 'purpose', 'modeConfigVersion')}
    view['questions'] = [{key: reference.get(key) for key in ('bankId', 'questionId', 'order', 'score')} for reference in payload.get('questions') or []]
    return view


async def _existing_bindings(db, actor, session_id, item_id, upload_id, payload):
    errors = []
    bank = (await db.execute(select(QuestionBank).where(QuestionBank.owner_id == actor.username, QuestionBank.source_id == payload['sourceId']).limit(1))).scalar_one_or_none()
    if bank is None:
        return {}, errors
    rows = (await db.execute(select(Question).where(Question.bank_id == bank.id).limit(501).execution_options(populate_existing=True))).scalars().all()
    if len(rows) > 500 or any((row.content_metadata.get('teacherAssistantSource') or {}).get('uploadId') != upload_id for row in rows):
        return {}, ['目标命名空间不是本会话创建的题库，禁止覆盖。']
    binding = {'bankId': bank.id, 'bankRevision': bank.revision, 'bankFingerprint': question_service.question_bank_import_fingerprint(bank, rows)}
    paper_id = 'tp_' + _identity(actor.username, session_id, item_id)
    current_session = await db.get(TeacherAssistantSession, session_id)
    if current_session is not None and current_session.owner_id == actor.username:
        entry = next((entry for entry in (current_session.receipt or {}).get('items', []) if entry.get('itemId') == item_id), {})
        paper_id = entry.get('paperId') or paper_id
    paper = await db.get(ExamPaper, paper_id)
    if paper is not None:
        paper_payload = await paper_service.get_paper(db, actor, paper.id)
        if paper.owner_id != actor.username or (paper.import_metadata or {}).get('sourcePaperId') != paper.id or paper_payload is None or any(reference.get('bankId') != bank.id for reference in paper_payload.get('questions', [])):
            errors.append('目标试卷不是本会话题库创建的自有试卷，禁止覆盖。')
        else:
            binding.update({'paperId': paper.id, 'paperRevision': paper.revision, 'paperView': _paper_view(paper_payload), 'releaseId': paper.published_release_id})
    return binding, errors


async def _release_matches(db, release_id, paper_id, bank_id, item, settings, payload):
    release = await db.get(PaperRelease, release_id)
    if release is None or release.paper_id != paper_id or release.name != item['name'] or release.access_level != settings['accessLevel'] or set(release.allowed_roles or []) != set(settings['allowedRoles']) or set(release.enabled_modes or []) != set(settings['enabledModes']):
        return False
    rows = (await db.execute(select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id).order_by(PaperReleaseQuestion.order_index).limit(501))).scalars().all()
    if len(rows) != len(payload['questions']):
        return False
    current = (await db.execute(select(Question).where(Question.bank_id == bank_id).limit(501).execution_options(populate_existing=True))).scalars().all()
    by_source = {str(question.source_id or question.id): question for question in current}
    return all(by_source.get(question['sourceId']) is not None and row.question_id == by_source[question['sourceId']].id and _desired_question_hash({key: value for key, value in row.snapshot.items() if key != 'releaseScore'}, payload.get('subject') or 'PMP') == _desired_question_hash(question_service.question_to_dict(by_source[question['sourceId']]), payload.get('subject') or 'PMP') for row, question in zip(rows, payload['questions']))


def _expand_bundle_sources(sources):
    expanded = []
    for source in sources:
        extracted = source['extracted']
        data = extracted.get('data')
        if extracted['kind'] != 'json' or not isinstance(data, dict) or 'principleBundles' not in data:
            expanded.append(source)
            continue
        bundles = data['principleBundles']
        if not isinstance(bundles, list) or len(bundles) > 5:
            raise _error(422, 'ASSISTANT_BUNDLE_INVALID', 'principleBundles 必须为不超过 5 个原则包的数组。')
        principles, presets = [], []
        for bundle in bundles:
            validated = teaching_content_projection_service.validate_principle_card_bundle(bundle)
            principles.extend(validated['principles']['items'])
            presets.extend(validated['synthesisPresets']['items'])
        if len(principles) > 1000 or len(presets) > 1000:
            raise _error(422, 'ASSISTANT_BUNDLE_INVALID', '组合原则或归纳卡超过 1000 条，请拆分。')
        if bundles:
            canonical = {'format': 'kg-principle-card-bundle-v1', 'principleCardBundleVersion': 1, 'principles': {'schemaVersion': 1, 'items': principles}, 'synthesisPresets': {'schemaVersion': 1, 'items': presets}}
            teaching_content_projection_service.validate_principle_card_bundle(canonical)
            expanded.append({**source, 'extracted': {**extracted, 'data': canonical}})
        banks = data.get('banks', [])
        if not isinstance(banks, list):
            raise _error(422, 'ASSISTANT_BUNDLE_INVALID', '组合 banks 必须为题库数组。')
        if banks:
            expanded.append({**source, 'extracted': {**extracted, 'data': {'banks': banks}}})
        elif not bundles:
            raise _error(422, 'ASSISTANT_BUNDLE_INVALID', '组合文件没有题库或原则包。')
    return expanded


def _patch_authorized(instruction, patch, original):
    text = re.sub(r'\s+', '', instruction)
    if re.search(r'不要修改(?!答案|解析|标题|选项|题干)|不修改(?!答案|解析|标题|选项|题干)|不改题目|不要改题目|原题.*原答案.*照搬|只改名称|只改名字|仅改名称', text):
        return False
    fields = {
        'correctAnswer': '答案|正确选项', 'correctOptionIds': '答案|正确选项',
        'options': '选项', 'analysis': '解析|分析|说明',
        'title': '标题|题名|题目名称', 'stemParts': '题干|题面',
    }
    verb = r'改为|改成|修改|更正|修正|补充|恢复'
    for field, value in patch.items():
        if value == original.get(field):
            continue
        aliases = fields.get(field, '')
        if field in {'correctAnswer', 'correctOptionIds'}:
            if re.search(r'(?:不改|不要改|不修改|不要修改).{0,8}(?:答案|正确选项)|(?:答案|正确选项).{0,8}(?:不改|不要改|不修改)|保留.{0,8}(?:原答案|原有答案|正确答案)', text):
                return False
            positive = bool(re.search(r'(?:答案|正确选项).{0,20}(?:' + verb + r'|是|为)|(?:' + verb + r').{0,20}(?:答案|正确选项)', text))
        else:
            positive = bool(aliases and re.search(r'(?:' + aliases + r').{0,20}(?:' + verb + r')|(?:' + verb + r').{0,20}(?:' + aliases + r')', text))
        # Synchronizing correctness flags changes no option text or identity.
        if field == 'options' and not positive and ('correctAnswer' in patch or 'correctOptionIds' in patch):
            old_options = original.get('options') or []
            positive = isinstance(value, list) and [{k: v for k, v in option.items() if k != 'correct'} for option in value if isinstance(option, dict)] == [{k: v for k, v in option.items() if k != 'correct'} for option in old_options if isinstance(option, dict)]
        if not positive:
            return False
    return True


def _apply_question_patches(questions, old, model_item, instruction, actor):
    original_by_id = {str(question['id']): deepcopy(question) for question in questions if isinstance(question, dict) and question.get('id')}
    stored = {entry['questionId']: deepcopy(entry['patch']) for entry in old.get('questionPatches', [])}
    provenance = {entry['questionId']: deepcopy(entry) for entry in old.get('correctionProvenance', [])}
    errors = []
    allowed = {'correctAnswer', 'correctOptionIds', 'options', 'analysis', 'title', 'stemParts'}
    for command in model_item.get('questionPatches') or []:
        question_id, patch = command['questionId'], command['patch']
        if question_id not in original_by_id or not patch or set(patch) - allowed:
            errors.append('题目更正包含无效题目 ID 或未授权字段。')
            continue
        changed_patch = {key: value for key, value in patch.items() if key not in stored.get(question_id, {}) or stored[question_id][key] != value}
        if not changed_patch:
            continue  # Repeating an approved correction changes no authority or provenance.
        if not _patch_authorized(instruction, changed_patch, original_by_id[question_id]):
            errors.append('题目更正需要本轮明确指定字段的用户修改指令；保留原文或不修改指令优先。')
            continue
        stored.setdefault(question_id, {}).update(deepcopy(patch))
        full_patch = stored[question_id]
        provenance[question_id] = {'questionId': question_id, 'actor': actor.username, 'kind': 'teacher_correction', 'instruction': instruction, 'originalValues': {key: deepcopy(original_by_id[question_id].get(key)) for key in full_patch}, 'correctedValues': deepcopy(full_patch)}
    for question in questions:
        if isinstance(question, dict) and str(question.get('id')) in stored:
            identifier = str(question['id'])
            patch = stored[identifier]
            question.update(deepcopy(patch))
            option_ids = [str(option.get('id') or '') for option in question.get('options') or [] if isinstance(option, dict)]
            case_ids = {value.casefold(): value for value in option_ids}
            if question.get('type', 'single_choice') == 'single_choice':
                answer = question.get('correctAnswer')
                if 'correctOptionIds' in patch and 'correctAnswer' not in patch and len(question.get('correctOptionIds') or []) == 1:
                    answer = question['correctOptionIds'][0]
                if isinstance(answer, str):
                    question['correctAnswer'] = case_ids.get(answer.casefold(), answer)
                selected = {question['correctAnswer']} if isinstance(question.get('correctAnswer'), str) else set()
                question['correctOptionIds'] = []
            else:
                if 'correctAnswer' in patch and 'correctOptionIds' not in patch:
                    question['correctOptionIds'] = question_answer_service.correct_option_ids({key: value for key, value in question.items() if key != 'correctOptionIds'})
                if isinstance(question.get('correctOptionIds'), list):
                    question['correctOptionIds'] = [case_ids.get(str(value).casefold(), value) for value in question['correctOptionIds']]
                selected = {value for value in question.get('correctOptionIds') or [] if isinstance(value, str)}
                question['correctAnswer'] = None
            for option in question.get('options') or []:
                if isinstance(option, dict):
                    option['correct'] = option.get('id') in selected
            if identifier in provenance:
                provenance[identifier]['correctedValues'] = {key: deepcopy(question.get(key)) for key in set(patch) | {'correctAnswer', 'correctOptionIds', 'options'}}
    patches = [{'questionId': identifier, 'patch': stored[identifier]} for identifier in sorted(stored)]
    return patches, [provenance[key] for key in sorted(provenance)], [original_by_id[key] for key in sorted(stored) if key in original_by_id], errors


async def build_plan(db, actor, sources: list[dict], model_result: dict, *, session_id: str, previous_plan: dict | None = None) -> dict:
    if actor.role not in {'teacher', 'admin'}:
        raise _error(403, 'TEACHER_REQUIRED', '仅教师或管理员可整理教学文件。')
    sources = _expand_bundle_sources(sources)
    model_result = _validated_model_result(model_result)
    settings = deepcopy((previous_plan or {}).get('settings') or {})
    settings.update(deepcopy(model_result.get('settings') or {}))
    settings.setdefault('publish', False)
    settings.setdefault('directPublish', False)
    settings.setdefault('accessLevel', 'private')
    settings.setdefault('allowedRoles', [])
    settings.setdefault('enabledModes', [])
    settings.setdefault('duplicatePolicy', None)
    blockers = list(model_result.get('blockers') or [])
    for flag in ('publish', 'directPublish'):
        if type(settings[flag]) is not bool:
            blockers.append(f'{flag} 必须为布尔值。')
    if settings['allowedRoles'] and (not isinstance(settings['allowedRoles'], list) or any(not isinstance(value, str) for value in settings['allowedRoles']) or set(settings['allowedRoles']) - {'teacher', 'student', 'admin', 'viewer'}):
        blockers.append('开放角色无效。')
    if not isinstance(settings['enabledModes'], list) or any(not isinstance(value, str) for value in settings['enabledModes']) or set(settings['enabledModes']) - {'deep_recall', 'multi_question_canvas', 'practice_mode'}:
        blockers.append('学习模式无效。')
    if settings['accessLevel'] not in {'private', 'free', 'member'}:
        blockers.append('收费方式无效。')
    if settings['duplicatePolicy'] not in {None, 'independent', 'reuse', 'cancel'}:
        blockers.append('重复处理策略无效。')
    if settings['publish'] and (settings['accessLevel'] == 'private' or not settings['allowedRoles'] or not settings['enabledModes'] or not settings['duplicatePolicy']):
        blockers.append('发布前需明确开放对象、收费方式、学习模式与重复处理。')
    if settings['directPublish'] and not settings['publish']:
        blockers.append('直接发布需要明确发布指令。')
    proposed = {str(item.get('uploadId')): item for item in model_result.get('items', []) if isinstance(item, dict)}
    previous = {item['id']: item for item in (previous_plan or {}).get('items', [])}
    items = []
    image_cache = {}
    incoming_principle_ids = set()
    for source in sources:
        data = source['extracted'].get('data') if source['extracted']['kind'] == 'json' else proposed.get(str(source['id']), {}).get('principleBundle')
        if _principle_bundle(data):
            validated = teaching_content_projection_service.validate_principle_card_bundle(data)
            incoming_principle_ids.update(str(principle['id']) for principle in validated['principles']['items'])
    for source in sources:
        upload_id = str(source['id'])
        extracted = source['extracted']
        model_item = proposed.get(upload_id, {})
        raw_banks = _banks(extracted.get('data')) if extracted['kind'] == 'json' else []
        principle_bundle = extracted.get('data') if extracted['kind'] == 'json' and _principle_bundle(extracted.get('data')) else model_item.get('principleBundle') if extracted['kind'] != 'json' else None
        if principle_bundle:
            preview = await content_prep_shared_service.preview_principle_merge(db, principle_bundle)
            item_id = upload_id + ':principles'
            conflicts = preview['plan'].get('conflicts') or []
            by_conflict = {str(conflict['conflictId']): conflict for conflict in conflicts}
            old_item = previous.get(item_id, {})
            old_conflicts = {str(conflict['conflictId']): conflict for conflict in (old_item.get('mergePreview') or {}).get('plan', {}).get('conflicts', [])}
            approved = {str(resolution['conflictId']): resolution['resolution'] for resolution in old_item.get('principleResolutions') or [] if by_conflict.get(str(resolution['conflictId'])) == old_conflicts.get(str(resolution['conflictId']))}
            item_blockers = []
            instruction = str(model_result.get('userInstruction') or '')
            for resolution in model_item.get('principleResolutions') or []:
                if not isinstance(resolution, dict) or str(resolution.get('conflictId')) not in by_conflict or resolution.get('resolution') not in {'keep-existing', 'take-incoming'}:
                    item_blockers.append('原则冲突处理包含无效冲突 ID 或策略。')
                    continue
                pattern = '保留现有|保留原有' if resolution['resolution'] == 'keep-existing' else '使用新值|采用新值|使用上传|采用上传|使用新原则'
                if not re.search(pattern, instruction):
                    item_blockers.append('原则冲突处理需要明确保留现有或使用新值的用户指令。')
                    continue
                approved[str(resolution['conflictId'])] = resolution['resolution']
            if set(by_conflict) - set(approved):
                item_blockers.append('原则合并存在冲突，请明确处理。')
            resolutions = [{'conflictId': key, 'resolution': approved[key]} for key in sorted(approved)]
            items.append({'id': item_id, 'name': source['name'], 'kind': 'principles', 'questions': [], 'principleBundle': deepcopy(principle_bundle), 'mergePreview': preview, 'principleResolutions': resolutions, 'source': {'uploadId': upload_id, 'location': '文件'}, 'warnings': extracted.get('warnings', []), 'blockers': item_blockers})
            continue
        if not raw_banks and extracted['kind'] != 'json':
            raw_banks = [{'id': upload_id, 'name': source['name'], 'questions': deepcopy(model_item.get('questions') or [])}]
        if not raw_banks:
            blockers.append(f'{source["name"]} 未识别为题库或原则包。')
        for index, bank in enumerate(raw_banks):
            item_id = upload_id + ':' + str(bank.get('id') or index)
            old = previous.get(item_id, {})
            questions = deepcopy(bank.get('questions') or [])
            original_question_starts = [(question.get('source') or {}).get('location') for question in questions]
            warnings = list(extracted.get('warnings') or [])
            item_blockers = []
            instruction = str(model_result.get('userInstruction') or '')
            patches, correction_provenance, source_originals, patch_errors = _apply_question_patches(questions, old, model_item, instruction, actor)
            item_blockers.extend(patch_errors)
            filter_keys = {'selectedQuestionIds', 'excludedQuestionIds'} & set(model_item)
            if filter_keys and re.search('删除|不要|去掉|只保留|排除|恢复|加回|重新加入|保留', instruction):
                known = {str(question.get('id')) for question in questions}
                selected = set(map(str, model_item.get('selectedQuestionIds', known)))
                excluded = set(map(str, model_item.get('excludedQuestionIds', [])))
                if (selected | excluded) - known:
                    item_blockers.append('筛选包含不存在的来源题目 ID。')
                else:
                    questions = [question for question in questions if str(question.get('id')) in selected - excluded]
            elif old.get('selectedQuestionIds') is not None:
                questions = [question for question in questions if str(question.get('id')) in old['selectedQuestionIds']]
            if not questions:
                item_blockers.append('没有可导入题目。')
            name = str((settings.get('names') or {}).get(upload_id) or bank.get('name') or source['name'].rsplit('.', 1)[0])
            suffix = str(settings.get('nameSuffix') or '')
            if suffix and suffix not in name:
                name += '｜' + suffix
            if not name or len(name) > 200:
                item_blockers.append('内容名称为空或超过 200 字符。')
            reviewed_ids = set(map(str, old.get('reviewedQuestionIds') or []))
            if re.search('已核对|核对无误|确认答案|核对.*确认', instruction):
                proposed_reviewed = set(map(str, model_item.get('reviewedQuestionIds') or model_result.get('reviewedQuestionIds') or []))
                if proposed_reviewed - {str(question.get('id')) for question in questions}:
                    item_blockers.append('核对确认包含不存在的题目 ID。')
                else:
                    reviewed_ids.update(proposed_reviewed)
            if extracted['kind'] != 'json':
                section_rows = extracted.get('sections') or []
                sections = {section['location']: section for section in section_rows}
                section_order = list(sections)
                starts = original_question_starts
                for question in questions:
                    source_ref = question.get('source') or {}
                    location = source_ref.get('location')
                    default_locations = [location]
                    if str(source.get('name') or '').lower().endswith(('.docx', '.doc')) and location in sections and starts.count(location) == 1:
                        start_index = section_order.index(location)
                        following = [section_order.index(value) for value in starts if value in sections and section_order.index(value) > start_index]
                        end_index = min(following) if following else len(section_order)
                        default_locations = section_order[start_index:end_index]
                    locations = source_ref.get('locations', question.get('sourceLocations', default_locations))
                    valid_span = isinstance(locations, list) and bool(locations) and all(isinstance(value, str) and value in sections for value in locations)
                    if valid_span:
                        indexes = [section_order.index(value) for value in locations]
                        valid_span = locations[0] == location and indexes == list(range(indexes[0], indexes[0] + len(indexes)))
                        valid_span = valid_span and not any(value in starts for value in locations[1:])
                        valid_span = valid_span and (len(locations) == 1 or starts.count(location) == 1)
                    if source_ref.get('uploadId', upload_id) != upload_id or not valid_span:
                        item_blockers.append('题目来源区段无效或跨越其他题目，请核对来源位置。')
                        locations = [location] if location in sections else []
                    # Model-provided asset IDs/paths cannot reference unrelated private resources.
                    for key in ('images', 'material', 'materialEdit', 'sourceImages'):
                        question.pop(key, None)
                    if isinstance(question.get('metadata'), dict):
                        question['metadata'].pop('_mixedContent', None)
                    question['sourceImages'] = []
                    source_files = [(value, filename) for value in locations for filename in sections[value].get('images') or []]
                    filenames = list(dict.fromkeys(filename for _, filename in source_files))
                    if len(filenames) > 20:
                        item_blockers.append('单题来源图片超过 20 张，请拆分。')
                        continue
                    for filename in filenames:
                        image_location = next(value for value, name in source_files if name == filename)
                        try:
                            key = (upload_id, filename)
                            if key not in image_cache:
                                _, mime, digest = _source_image(session_id, upload_id, filename)
                                image_cache[key] = {'uploadId': upload_id, 'filename': filename, 'mimeType': mime, 'digest': digest}
                            question['sourceImages'].append({**image_cache[key], 'location': image_location})
                        except ValueError as error:
                            item_blockers.append(str(error))
            normalized = []
            for number, question in enumerate(questions, 1):
                try:
                    QuestionPayload.model_validate(question)
                    value = question_content_service.normalize_question_payload(question, subject=str(bank.get('subject') or 'PMP'))
                    problems = question_answer_service.validate_question(value)
                    if value['type'] not in {'single_choice', 'multiple_choice', 'matching'}:
                        item_blockers.append(f'第 {number} 题题型不受支持。')
                    if value['type'] == 'single_choice':
                        option_ids = [str(option.get('id') or '') for option in value.get('options') or []]
                        answer = value.get('correctAnswer')
                        if len(option_ids) < 2 or len(option_ids) != len(set(option_ids)) or any(not identifier for identifier in option_ids):
                            item_blockers.append(f'第 {number} 题选项缺失或 ID 重复。')
                        if not isinstance(answer, str) or answer not in option_ids:
                            item_blockers.append(f'第 {number} 题缺少有效单选答案。')
                    if not any(str(part.get('text') or '').strip() or part.get('imageId') or part.get('url') for part in value.get('stemParts') or []):
                        item_blockers.append(f'第 {number} 题缺少题干。')
                    item_blockers.extend(f'第 {number} 题：{problem["message"]}' for problem in problems)
                    normalized.append(value)
                except (ValidationError, ValueError, TypeError, AttributeError) as exc:
                    item_blockers.append(f'第 {number} 题格式不正确：{type(exc).__name__}')
                if extracted['kind'] != 'json':
                    location = (question.get('source') or {}).get('location')
                    available = {section['location'] for section in extracted.get('sections') or []}
                    if not location or location not in available:
                        item_blockers.append(f'第 {number} 题缺少有效原文位置。')
                    if (question.get('uncertain') or question.get('needsReview') or any('OCR' in value or '公式' in value or '图表' in value for value in warnings)) and str(question.get('id')) not in reviewed_ids:
                        item_blockers.append(f'第 {number} 题识别结果需要教师核对。')
            item_blockers.extend(await _reference_blockers(db, questions, incoming_principle_ids))
            signatures = [question_content_service.duplicate_question_signature(value) for value in normalized]
            if len(signatures) != len(set(signatures)):
                item_blockers.append('文件内有完全重复题目；请先明确保留范围。')
            candidates = (await db.execute(select(Question).join(QuestionBank, Question.bank_id == QuestionBank.id).where(QuestionBank.owner_id == actor.username, Question.title.in_([q.get('title') or '' for q in questions])).limit(1001))).scalars().all()
            matching = sum(question_content_service.duplicate_question_signature(question_service.question_to_dict(candidate)) in set(signatures) for candidate in candidates[:1000])
            if matching:
                warnings.append(f'本人题库已有 {matching} 道完全相同题目；按明确重复策略处理。')
            if len(candidates) > 1000:
                warnings.append('相同标题候选超过 1000 条，仅检查前 1000 条。')
            namespace = 'ta_' + _identity(actor.username, session_id, item_id)
            policy = settings['duplicatePolicy']
            bank_payload = deepcopy(bank)
            bank_payload.update({'id': namespace, 'sourceId': namespace, 'name': name, 'visibility': 'private', 'questions': []})
            original_source_id = str(bank.get('sourceId') or bank.get('id') or index)
            reuse_bank_id = None
            if policy == 'reuse':
                existing = (await db.execute(select(QuestionBank).where(QuestionBank.owner_id == actor.username, QuestionBank.source_id == original_source_id).limit(1))).scalar_one_or_none()
                if existing is None:
                    item_blockers.append('找不到可复用的本人来源题库；请选择独立副本。')
                else:
                    bank_payload['id'] = bank_payload['sourceId'] = original_source_id
                    reuse_bank_id = existing.id
                    rows = (await db.execute(select(Question).where(Question.bank_id == existing.id).limit(501))).scalars().all()
                    existing_signatures = {str(row.source_id or row.id): row.content_hash for row in rows}
                    if len(rows) != len(questions) or any(existing_signatures.get(str(question.get('sourceId') or question['id'])) != question_content_service.canonical_question_hash(question) for question in questions):
                        item_blockers.append('复用目标内容不同，禁止未经授权覆盖。')
            elif policy != 'independent':
                item_blockers.append('请选择保留独立副本、复用或取消。')
            for question in questions:
                transformed = deepcopy(question)
                original_id = str(question.get('sourceId') or question['id'])
                target_id = 'tq_' + _identity(namespace, original_id) if policy != 'reuse' else original_id
                transformed['id'] = target_id[:64]
                transformed['sourceId'] = target_id
                if policy != 'reuse':
                    transformed.setdefault('metadata', {})['teacherAssistantSource'] = {'uploadId': upload_id, 'sourceBankId': original_source_id, 'sourceQuestionId': original_id, 'originalId': question['id']}
                correction = next((entry for entry in correction_provenance if entry['questionId'] == question['id']), None)
                if correction:
                    transformed.setdefault('metadata', {})['teacherAssistantCorrection'] = deepcopy(correction)
                bank_payload['questions'].append(transformed)
            bindings, binding_errors = await _existing_bindings(db, actor, session_id, item_id, upload_id, bank_payload) if policy == 'independent' else ({}, [])
            item_blockers.extend(binding_errors)
            changes = {'previousName': (bindings.get('paperView') or {}).get('name'), 'name': name, 'questionCorrections': deepcopy(correction_provenance), 'questionSelection': [question['id'] for question in questions], 'previousPaper': bindings.get('paperView'), 'accessLevel': settings['accessLevel'], 'allowedRoles': settings['allowedRoles'], 'enabledModes': settings['enabledModes']}
            items.append({'id': item_id, 'name': name, 'kind': 'questions', 'questions': questions, 'questionPatches': patches, 'correctionProvenance': correction_provenance, 'sourceOriginalQuestions': source_originals, 'selectedQuestionIds': [question['id'] for question in questions], 'reviewedQuestionIds': sorted(reviewed_ids), 'bankPayload': bank_payload, 'existingObjects': bindings, 'changePreview': changes, 'sourceKind': extracted['kind'], 'reuseBankId': reuse_bank_id, 'source': {'uploadId': upload_id, 'location': 'JSON 原题库' if extracted['kind'] == 'json' else '文档'}, 'warnings': warnings, 'blockers': item_blockers, 'cancelled': policy == 'cancel'})
    items.sort(key=lambda item: item['kind'] != 'principles')
    total = sum(len(item['questions']) for item in items)
    if total > 500:
        blockers.append('单任务超过 500 题；请拆分。')
    result = {'settings': settings, 'items': items, 'questionCount': total, 'blockers': list(dict.fromkeys(blockers)), 'reply': str(model_result.get('reply') or '')}
    result['digest'] = hashlib.sha256(json.dumps(result, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return result


async def _checkpoint(db, session, receipt):
    await db.refresh(session)
    session.receipt = deepcopy(receipt)
    await db.commit()
    await db.refresh(session)


async def execute_plan(db, actor, session, revision, *, before_step=None) -> dict:
    async def guard():
        if before_step is not None:
            await before_step()
    if actor.role not in {'teacher', 'admin'} or session.owner_id != actor.username:
        raise _error(403, 'ASSISTANT_OWNER_REQUIRED', '无权执行此会话。')
    if revision != session.revision:
        raise _error(409, 'ASSISTANT_REVISION_CONFLICT', '方案已更新，请刷新后确认。')
    plan = deepcopy(session.plan or {})
    session_id = str(session.id)
    if plan.get('blockers'):
        raise _error(422, 'ASSISTANT_PLAN_BLOCKED', '方案有待处理问题。')
    settings = plan['settings']
    prior = deepcopy(session.receipt or {})
    previous_entries = {entry['itemId']: entry for entry in prior.get('items', [])}
    if prior and prior.get('revision') != revision:
        prior = {}
    receipt = {'revision': revision, 'items': prior.get('items') or [], 'status': 'partial'}
    entries = {entry['itemId']: entry for entry in receipt['items']}
    for item in sorted(plan.get('items', []), key=lambda item: item['kind'] != 'principles'):
        await guard()
        entry = entries.get(item['id'])
        if entry and entry.get('status') in {'succeeded', 'cancelled'}:
            continue
        if entry is None:
            entry = {'itemId': item['id'], 'name': item['name'], 'status': 'pending', 'links': []}
            old_entry = previous_entries.get(item['id'], {})
            if (item.get('existingObjects') or {}).get('bankId') == old_entry.get('bankId') and old_entry.get('assets'):
                entry['assets'] = deepcopy(old_entry['assets'])
            receipt['items'].append(entry)
        if item.get('cancelled'):
            entry['status'] = 'cancelled'
            await _checkpoint(db, session, receipt)
            continue
        if item.get('blockers'):
            entry.update(status='blocked', error='；'.join(item['blockers']))
            await _checkpoint(db, session, receipt)
            continue
        try:
            if item['kind'] == 'principles':
                preview = await content_prep_shared_service.preview_principle_merge(db, item['principleBundle'])
                approved_conflicts = {str(conflict['conflictId']): conflict for conflict in item['mergePreview']['plan'].get('conflicts') or []}
                current_conflicts = {str(conflict['conflictId']): conflict for conflict in preview['plan'].get('conflicts') or []}
                approved = {str(resolution['conflictId']): resolution['resolution'] for resolution in item.get('principleResolutions') or []}
                if any(identifier not in approved or conflict != approved_conflicts.get(identifier) for identifier, conflict in current_conflicts.items()):
                    raise _error(409, 'PRINCIPLE_CONFLICT_CHANGED', '原则冲突已变化或未经确认，请重新预览。')
                resolutions = [{'conflictId': identifier, 'resolution': approved[identifier]} for identifier in sorted(current_conflicts)]
                await guard()
                result = await content_prep_shared_service.apply_principle_merge(db, actor, content_revision=preview['contentRevision'], bundle=item['principleBundle'], resolutions=resolutions)
                entry.update(status='succeeded', result={'contentRevision': result['contentRevision'], 'summary': result['summary']})
                for error_key in ('error', 'errorStatus', 'errorCode'):
                    entry.pop(error_key, None)
                await _checkpoint(db, session, receipt)
                continue
            reference_errors = await _reference_blockers(db, item['questions'])
            if reference_errors:
                raise _error(422, 'SOURCE_REFERENCE_INVALID', '；'.join(reference_errors))
            payload = deepcopy(item['bankPayload'])
            bank_source = payload['sourceId']
            binding = item.get('existingObjects') or {}
            if binding.get('paperId'):
                current_paper = await db.get(ExamPaper, binding['paperId'])
                if current_paper is None or current_paper.owner_id != actor.username:
                    raise _error(409, 'PAPER_REVISION_CONFLICT', '原试卷不存在或权限已变化，请重新预览。')
                await db.refresh(current_paper)
                if current_paper.revision != binding['paperRevision'] and current_paper.revision != entry.get('paperMutationRevision'):
                    actual = _paper_view(await paper_service.get_paper(db, actor, current_paper.id))
                    # Full semantic equality recovers a committed mutation/publish whose receipt was lost.
                    expected = deepcopy(binding['paperView'])
                    expected.update(name=item['name'], enabledModes=settings['enabledModes'], accessPolicy={'accessLevel': settings['accessLevel'], 'allowedRoles': settings['allowedRoles']}, totalCount=len(payload['questions']))
                    question_rows = (await db.execute(select(Question).where(Question.bank_id == binding['bankId']).limit(501))).scalars().all()
                    by_source = {str(row.source_id or row.id): row.id for row in question_rows}
                    expected['questions'] = [{'bankId': binding['bankId'], 'questionId': by_source.get(question['sourceId']), 'order': order, 'score': 1.0} for order, question in enumerate(payload['questions'], 1)]
                    if actual != expected:
                        raise _error(409, 'PAPER_REVISION_CONFLICT', '试卷已被其他操作修改，请重新预览后确认。')
            if item.get('sourceKind') == 'document':
                for question in payload['questions']:
                    if question.get('sourceImages'):
                        question['images'] = []
                        for image in question['sourceImages']:
                            asset_key = image['uploadId'] + ':' + image['filename'] + ':' + image['digest']
                            asset = (entry.get('assets') or {}).get(asset_key)
                            if asset is None:
                                await guard()
                                asset = await _ensure_source_asset(db, actor, session_id, image)
                                entry.setdefault('assets', {})[asset_key] = asset
                                await _checkpoint(db, session, receipt)
                            question['images'].append(asset)
            if not entry.get('bankId'):
                if item.get('reuseBankId'):
                    bank = await db.get(QuestionBank, item['reuseBankId'])
                    if bank is None or bank.owner_id != actor.username:
                        raise _error(403, 'BANK_OWNER_REQUIRED', '无权复用目标题库。')
                    rows = (await db.execute(select(Question).where(Question.bank_id == bank.id).limit(501).execution_options(populate_existing=True))).scalars().all()
                    hashes = {str(row.source_id or row.id): row.content_hash for row in rows}
                    if len(rows) != len(payload['questions']) or any(hashes.get(question['sourceId']) != question_content_service.canonical_question_hash(question) for question in payload['questions']):
                        raise _error(409, 'REUSE_CONTENT_CHANGED', '复用目标已变化，请重新预览。')
                    entry['bankId'] = bank.id
                else:
                    existing_bank = (await db.execute(select(QuestionBank).where(QuestionBank.owner_id == actor.username, QuestionBank.source_id == bank_source).limit(1).execution_options(populate_existing=True))).scalar_one_or_none()
                    if existing_bank is not None and await _bank_matches(db, existing_bank, payload):
                        entry['bankId'] = existing_bank.id
                    else:
                        if existing_bank is not None and binding.get('bankId') != existing_bank.id:
                            raise _error(409, 'ASSISTANT_BANK_CONFLICT', '目标命名空间已有不同内容，禁止覆盖。')
                        if binding.get('bankId') and existing_bank is None:
                            raise _error(409, 'QUESTION_BANK_REVISION_CONFLICT', '原题库已移除，请重新预览。')
                        expected_revisions = {bank_source: binding['bankRevision']} if binding.get('bankId') else None
                        expected_fingerprints = {bank_source: binding['bankFingerprint']} if binding.get('bankId') else None
                        # Close read transaction to retain loaded actor attributes in owned-image validation.
                        await db.commit()
                        await guard()
                        result = await question_service.import_question_banks(db, actor, QuestionBankImportRequest(banks=[payload], confirmReplace=bool(binding.get('bankId'))), expected_bank_revisions=expected_revisions, expected_bank_fingerprints=expected_fingerprints)
                        entry['bankId'] = result['sourceBankIdMap'][bank_source]
                        await db.refresh(actor)
                await _checkpoint(db, session, receipt)
            paper_id = binding.get('paperId') or 'tp_' + _identity(actor.username, session_id, item['id'])
            if not entry.get('paperId') or not entry.get('paperReady'):
                package = {'schema': 'kg-paper-package-v1', 'schemaVersion': 1, 'paper': {'id': paper_id, 'name': item['name'], 'subject': payload.get('subject') or 'PMP', 'paperType': 'mixed' if len({q.get('type', 'single_choice') for q in item['questions']}) > 1 or any(q.get('type') == 'matching' for q in item['questions']) else 'multiple_choice' if item['questions'][0].get('type') == 'multiple_choice' else 'standard', 'totalCount': len(payload['questions']), 'enabledModes': settings['enabledModes'], 'accessPolicy': {'accessLevel': settings['accessLevel'], 'allowedRoles': settings['allowedRoles']}, 'questions': [{'bankId': bank_source, 'questionId': question['sourceId'], 'order': index} for index, question in enumerate(payload['questions'], 1)]}, 'sourceBanks': [{'sourceBankId': bank_source, 'name': item['name']}]}
                request = PaperImportPreflightRequest(fileName=item['name'] + '.json', package=package)
                preflight = await paper_import_service.preflight_package(db, actor, request)
                if not preflight['valid']:
                    raise _error(422, 'PAPER_IMPORT_INVALID', '；'.join(problem['message'] for problem in preflight['errors']))
                desired = {**package['paper'], 'description': None, 'purpose': 'learning', 'modeConfigVersion': 2, 'questions': [{key: reference[key] for key in ('bankId', 'questionId', 'order', 'score')} for reference in preflight['references']]}
                current = await db.get(ExamPaper, paper_id)
                current_payload = await paper_service.get_paper(db, actor, paper_id) if current is not None else None
                if current is not None and (current.owner_id != actor.username or (current.import_metadata or {}).get('sourcePaperId') != paper_id):
                    raise _error(403, 'ASSISTANT_PAPER_OWNER_CONFLICT', '试卷不属于本会话，禁止修改。')
                if current_payload is not None and _paper_view(current_payload) == _paper_view(desired):
                    entry['paperId'] = paper_id
                elif current is not None and not binding.get('paperId'):
                    raise _error(409, 'ASSISTANT_PAPER_CONFLICT', '已有试卷内容不同，请重新预览。')
                elif current is not None and current.status != 'draft':
                    expected_revision = entry.get('paperMutationRevision') or binding['paperRevision']
                    if current.revision != expected_revision:
                        raise _error(409, 'PAPER_REVISION_CONFLICT', '试卷版本已变化，请重新预览。')
                    if current_payload['paperType'] != desired['paperType'] and current_payload['paperType'] != 'mixed':
                        await guard()
                        current_payload = await paper_service.update_paper(db, actor, paper_id, PaperUpdateRequest(revision=expected_revision, paperType='mixed'), allow_type_promotion=True)
                        expected_revision = current_payload['revision']
                        entry.update(paperId=paper_id, paperMutationRevision=expected_revision, paperReady=False)
                        await _checkpoint(db, session, receipt)
                    if _paper_view(current_payload)['questions'] != desired['questions']:
                        await guard()
                        current_payload = await paper_service.replace_questions(db, actor, paper_id, PaperQuestionReplaceRequest(revision=expected_revision, questions=desired['questions']))
                        expected_revision = current_payload['revision']
                        entry.update(paperId=paper_id, paperMutationRevision=expected_revision, paperReady=False)
                        await _checkpoint(db, session, receipt)
                    current_view = _paper_view(current_payload)
                    fields = {key: desired[key] for key in ('name', 'subject', 'description', 'paperType', 'totalCount', 'enabledModes', 'accessPolicy', 'purpose', 'modeConfigVersion') if current_view.get(key) != desired[key]}
                    if fields:
                        await guard()
                        current_payload = await paper_service.update_paper(db, actor, paper_id, PaperUpdateRequest(revision=expected_revision, **fields))
                        entry.update(paperMutationRevision=current_payload['revision'])
                    entry['paperId'] = paper_id
                else:
                    await guard()
                    result = await paper_import_service.import_package(db, actor, PaperImportRequest(fileName=request.file_name, package=package, preflightHash=preflight['payloadHash'], conflictAction='replace_draft' if current is not None else 'create', expectedRevision=binding.get('paperRevision') if current is not None else None, idempotencyKey='ta-paper-' + _identity(session_id, item['id'], revision)), allow_type_promotion=bool(binding.get('paperId')))
                    entry['paperId'] = result['paper']['id']
                ready_paper = await db.get(ExamPaper, entry['paperId'])
                if ready_paper is not None:
                    await db.refresh(ready_paper)
                    entry['paperReadyRevision'] = ready_paper.revision
                entry['paperReadyView'] = _paper_view(desired)
                entry['paperReady'] = True
                await _checkpoint(db, session, receipt)
            if settings['publish'] and not entry.get('releaseId'):
                await guard()
                # The final preview comparison and snapshot freeze share the
                # existing global content write lock until publish commits.
                await teaching_content_revision_service.acquire_lock(db)
                bank = await db.get(QuestionBank, entry['bankId'])
                if bank is None or bank.owner_id != actor.username:
                    raise _error(409, 'QUESTION_BANK_REVISION_CONFLICT', '发布题库不存在或权限已变化。')
                await db.refresh(bank)
                if not await _bank_matches(db, bank, payload):
                    raise _error(409, 'QUESTION_PREVIEW_CHANGED', '题目已被其他操作修改，不能发布未预览的内容。')
                paper = await db.get(ExamPaper, entry['paperId'])
                if paper is not None:
                    await db.refresh(paper)
                if paper is None or paper.owner_id != actor.username:
                    raise _error(403, 'PAPER_OWNER_REQUIRED', '无权发布目标试卷。')
                current_view = _paper_view(await paper_service.get_paper(db, actor, paper.id))
                if entry.get('paperReadyView') and current_view != entry['paperReadyView']:
                    raise _error(409, 'PAPER_PREVIEW_CHANGED', '试卷配置已被其他操作修改，不能发布未预览的内容。')
                # A commit may succeed before the receipt: recover the persisted paper release.
                if paper.published_release_id and await _release_matches(db, paper.published_release_id, paper.id, entry['bankId'], item, settings, payload):
                    entry['releaseId'] = paper.published_release_id
                else:
                    if entry.get('paperReadyRevision') is not None and paper.revision != entry['paperReadyRevision']:
                        raise _error(409, 'PAPER_REVISION_CONFLICT', '试卷版本已变化，请重新预览。')
                    release = await paper_release_service.publish(db, actor, paper.id, expected_revision=paper.revision, access_level=settings['accessLevel'], enabled_modes=settings['enabledModes'], allowed_roles=settings['allowedRoles'], metadata={'teacherAssistantSessionId': session_id, 'teacherAssistantItemId': item['id'], 'teacherAssistantRevision': revision})
                    entry['releaseId'] = release.id
                await _checkpoint(db, session, receipt)
            entry.update(status='succeeded', links=[{'label': '试卷管理', 'url': '/paper-management.html?paperId=' + entry['paperId']}])
            if entry.get('releaseId'):
                entry['links'].append({'label': '回忆画布', 'url': '/knowledge-recall.html?releaseId=' + entry['releaseId']})
            for error_key in ('error', 'errorStatus', 'errorCode'):
                entry.pop(error_key, None)
            await _checkpoint(db, session, receipt)
        except Exception as exc:
            await db.rollback()
            await db.refresh(actor)
            message = exc.detail.get('message', exc.detail.get('code', '导入失败')) if isinstance(exc, HTTPException) and isinstance(exc.detail, dict) else '导入失败，请检查方案后重试。'
            entry.update(status='failed', error=message)
            if isinstance(exc, HTTPException):
                entry['errorStatus'] = exc.status_code
                entry['errorCode'] = exc.detail.get('code') if isinstance(exc.detail, dict) else None
            await _checkpoint(db, session, receipt)
    receipt['status'] = 'succeeded' if receipt['items'] and all(entry['status'] in {'succeeded', 'cancelled'} for entry in receipt['items']) else 'partial'
    await _checkpoint(db, session, receipt)
    return receipt
