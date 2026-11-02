"""Prepare the explicitly supplied PMP documents; never connects to a database.

Run with the existing backend Python (Pillow is already installed).
Source screenshots/OCR stay local; only isolated diagrams enter the package.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def text_of(node):
    return ''.join(n.text or '' for n in node.findall('.//w:t', NS)).strip()


def document_rows(path):
    with ZipFile(path) as archive:
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(archive.read('word/_rels/document.xml.rels'))}
        body = ET.fromstring(archive.read('word/document.xml')).find('w:body', NS)
        rows = []
        for index, node in enumerate(body):
            if node.tag.endswith('}tbl'):
                cells = [[text_of(cell) for cell in row.findall('w:tc', NS)] for row in node.findall('w:tr', NS)]
                value = '\n'.join(' | '.join(row) for row in cells)
            else:
                value = text_of(node)
            images = []
            for blip in node.findall('.//a:blip', NS):
                target = rels[blip.attrib['{' + NS['r'] + '}embed']]
                data = archive.read('word/' + target)
                name = 'pmp-' + Path(target).name
                (ROOT / 'assets' / name).write_bytes(data)
                images.append('assets/' + name)
            rows.append({'index': index, 'text': value, 'images': images})
        return rows


def make_question(identifier, title, stem, options, answer, analysis, metadata):
    ids = list(answer)
    multiple = len(ids) > 1
    return {'id': identifier, 'sourceId': identifier, 'title': title,
            'type': 'multiple_choice' if multiple else 'single_choice', 'subject': 'PMP',
            'difficulty': '中等', 'scope': 'internal', 'teacherNumber': identifier.rsplit('-', 1)[-1],
            'stemParts': [{'text': stem}],
            'options': [{'id': chr(65+i), 'text': value, 'correct': chr(65+i) in ids} for i, value in enumerate(options)],
            'correctAnswer': None if multiple else ids[0], 'correctOptionIds': ids if multiple else [],
            'analysis': analysis, 'metadata': metadata, 'tags': [],
            'lifecycle': {'status': 'active'}}


def build_text(path):
    rows = document_rows(path)
    starts = [(i, re.match(r'^Q(\d{2})\s{2,}(.+)$', row['text'])) for i, row in enumerate(rows)]
    starts = [(i, m) for i, m in starts if m]
    assert len(starts) == 93
    backgrounds = [(1, '海岸与海上设施升级', [23, 24, 25], ['24', '25', '26']),
                   (2, '银行应用发布与安全审查', [62, 63, 64], ['32', '33', '34']),
                   (3, '理赔系统项目挽救', [100, 101, 102], ['39', '40', '41']),
                   (4, '诊所预约系统上线', [138, 139], ['45', '46', '47']),
                   (5, '志愿者搜寻中的AI辅助', [345], ['20', '21', '22'])]
    materials, groups = {}, {}
    for n, title, positions, members in backgrounds:
        key = f'pmp-case-{n}'
        materials[key] = {'title': title, 'text': '\n\n'.join(rows[i]['text'] for i in positions), 'images': []}
        for order, member in enumerate(members, 1):
            groups[member] = (key, order, len(members))
    questions = []
    for n, (start, match) in enumerate(starts):
        number, title = match.groups()
        stop = starts[n+1][0] if n+1 < len(starts) else len(rows)
        block = rows[start+1:stop]
        marker = next(i for i, row in enumerate(block) if row['text'].startswith(('选项（', '匹配候选区域', '下拉候选项', '图中可点击任务')))
        raw_answer = next(row['text'] for row in block if row['text'].startswith('参考答案：'))
        answer = ''.join(re.findall(r'[A-Z]', raw_answer.split('。')[0]))
        options = []
        for row in block[marker+1:]:
            if row['text'].startswith('参考答案：'):
                break
            option = re.match(r'^([A-Z])[．.、]\s*(.+)', row['text'])
            if option:
                options.append(option.group(2))
        if number == '30':
            options, answer = [row['text'] for row in block[marker+1:marker+5]], 'D'
        elif number == '35':
            options, answer = ['第6次迭代', '第7次迭代', '第8次迭代', '第9次迭代'], 'C'
        analysis = []
        in_analysis = False
        for row in block:
            value = row['text']
            if value.startswith('解析：'):
                in_analysis = True
            if in_analysis and value.startswith('来源：'):
                break
            if in_analysis:
                analysis.append(value.removeprefix('解析：'))
        source = next((row['text'].removeprefix('来源：') for row in block if row['text'].startswith('来源：')), '')
        stem = '\n\n'.join(row['text'].removeprefix('题目：') for row in block[:marker] if row['text'] and not row['text'].startswith('依据原题'))
        metadata = {'documentImport': {'batch': 'pmp-documents-20261102', 'sourceDocument': path.name,
                     'originalNumber': 'Q'+number, 'sourceParagraph': start+1, 'source': source,
                     'extraction': '原文结构化提取', 'answerSource': raw_answer}}
        if number in {'30', '35', '36'}:
            metadata['documentImport']['interactionAdaptation'] = {'30': '风险区域选择转换为单选', '35': '下拉选择转换为单选', '36': '图上点击任务转换为看图单选'}[number]
        question = make_question('pmp-cn-20261102-Q'+number, 'Q'+number+' '+title, stem, options, answer, '\n'.join(analysis), metadata)
        question['teacherNumber'] = 'Q'+number
        question['_assetFiles'] = [image for row in block[:marker] for image in row['images']]
        if number in groups:
            key, order, total = groups[number]
            question['_caseKey'] = key
            question['caseGroup'] = {'id': key, 'order': order, 'total': total}
        questions.append(question)
    return {'bank': {'id': 'pmp-cn-reviewed-20261102', 'name': 'PMP新版中文题库（原96题版·实收93题）',
                     'subject': 'PMP', 'description': '用户提供优化解析、删除超纲版。保留原题号，原文缺Q16/Q49/Q72。共享案例15小题；三道特殊交互改为单选。原资料声明并非PMI真实考试题。',
                     'visibility': 'private', 'version': '2026.11.02', 'questions': questions}, 'materials': materials}


def build_mini(assessment):
    review = json.loads((ROOT / 'mini-review.json').read_text())
    questions, materials, exclusions = [], {}, review['excluded']
    for entry in review['questions']:
        head = entry['screenshots'][0]
        stem, options = entry['stem'], entry['options']
        question = make_question(f'pmp-mini-20261102-{head:03d}', entry['title'], stem, options,
                                 entry['answer'], entry['analysis'], {'documentImport': {
                                     'batch': 'pmp-documents-20261102', 'sourceDocument': '小程序新题型合集.docx',
                                     'screenshots': entry['screenshots'], 'extraction': 'OCR后对照截图校订；解析精简整理',
                                     'reviewMode': '逐图人工校订', 'originalAnswer': entry['answer'], 'reviewStatus': 'prepared-for-teacher-uat'}})
        if entry.get('case'):
            key = entry['case']
            material = review['materials'][key]
            materials[key] = material
            question['_caseKey'] = key
        question['_assetFiles'] = []
        for crop in entry.get('diagrams', []):
            from PIL import Image
            image = Image.open(assessment/f'mini-{crop[0]:03d}.png')
            target = f'assets/mini-{head:03d}-diagram.png'
            image.crop(tuple(crop[1:])).save(ROOT / target)
            question['_assetFiles'].append(target)
        questions.append(question)
    for key in materials:
        members = [q for q in questions if q.get('_caseKey') == key]
        for order, q in enumerate(members, 1):
            q['caseGroup'] = {'id': key, 'order': order, 'total': len(members)}
    return {'bank': {'id': 'pmp-mini-screenshots-20261102', 'name': 'PMP小程序新题型合集（截图整理版）',
                     'subject': 'PMP', 'visibility': 'private', 'version': '2026.11.02',
                     'description': '用户提供截图题库的结构化整理。题面、答案与解析分离；仅附无答案图表。原截图重复合并，已知答案矛盾题单列待教师核定。',
                     'questions': questions}, 'materials': materials, 'excluded': exclusions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--text-doc', type=Path, required=True)
    parser.add_argument('--assessment', type=Path, required=True)
    parser.add_argument('--screenshot-doc', type=Path, required=True)
    args = parser.parse_args()
    (ROOT / 'assets').mkdir(exist_ok=True)
    text = build_text(args.text_doc)
    write_json(ROOT/'text-package.json', text)
    if (ROOT/'mini-review.json').exists():
        mini = build_mini(args.assessment)
        write_json(ROOT/'mini-package.json', mini)
    else:
        mini = None
    manifest = {'batch': 'pmp-documents-20261102', 'textQuestionCount': len(text['bank']['questions']),
                'textMissingNumbers': ['Q16','Q49','Q72'], 'textMaterialCount': len(text['materials']),
                'miniQuestionCount': len(mini['bank']['questions']) if mini else 0,
                'sourceTextSha256': hashlib.sha256(args.text_doc.read_bytes()).hexdigest(),
                'sourceScreenshotSha256': hashlib.sha256(args.screenshot_doc.read_bytes()).hexdigest(),
                'packages': [{'file': name, 'sha256': hashlib.sha256((ROOT/name).read_bytes()).hexdigest()} for name in ['text-package.json', 'mini-package.json'] if (ROOT/name).exists()],
                'assets': [{'file': str(p.relative_to(ROOT)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((ROOT/'assets').glob('*'))]}
    write_json(ROOT/'manifest.json', manifest)
    print(json.dumps({k: v for k, v in manifest.items() if k not in {'assets'}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
