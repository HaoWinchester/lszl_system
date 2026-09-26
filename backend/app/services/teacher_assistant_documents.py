"""Bounded, model-free extraction. Legacy Office conversion requires a network-isolated runner."""
from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath
import re
import resource
import sys
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

MAX_UPLOAD = 20 * 1024 * 1024
MAX_EXPANDED = 100 * 1024 * 1024
MAX_PAGES = 200
MAX_TEXT = 8 * 1024 * 1024
ALLOWED = {'.json', '.docx', '.pptx', '.pdf', '.doc', '.ppt'}


class DocumentError(ValueError):
    pass


def validate_upload(filename: str, size: int) -> None:
    if Path(filename).suffix.lower() not in ALLOWED:
        raise DocumentError('不支持此文件类型；请上传 JSON、Word、PDF 或 PPT。')
    if size <= 0 or size > MAX_UPLOAD:
        raise DocumentError('文件为空或超过 20 MiB；请拆分后上传。')


def _xml(data: bytes):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise DocumentError('文档 XML 包含不安全实体。')
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise DocumentError('文档 XML 损坏。') from exc


def _tag(element):
    return element.tag.rsplit('}', 1)[-1]


def _text(element):
    return ' '.join(node.text or '' for node in element.iter() if _tag(node) in {'t', 'tab', 'br'}).strip()


def _process_limits():
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_EXPANDED, MAX_EXPANDED))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    # Linux deployment worker: bound virtual memory; macOS runtime mappings exceed this.
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))


def _run(arguments, timeout=60):
    executable = shutil.which(arguments[0])
    if not executable:
        raise DocumentError(f'服务器未安装 {arguments[0]}，无法处理此文档。')
    # File-backed stdout avoids accumulating unbounded command output in memory.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        try:
            process = subprocess.Popen([executable, *arguments[1:]], stdout=output, stderr=errors, stdin=subprocess.DEVNULL, start_new_session=True, preexec_fn=_process_limits)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                import signal
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise DocumentError('文档处理超时；请拆分或转换后重传。')
            if code:
                raise DocumentError(f'{arguments[0]} 文档处理失败；请检查文件或转换后重传。')
            if output.tell() > MAX_TEXT:
                raise DocumentError('文档提取文本超过安全上限。')
            output.seek(0)
            return output.read().decode('utf-8', errors='replace')
        except OSError as exc:
            raise DocumentError('无法启动文档处理工具。') from exc


def _office(path, extension, output_dir):
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise DocumentError('文件不是有效的 Office 文档。') from exc
    sections, warnings = [], []
    with archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(item.file_size for item in entries) > MAX_EXPANDED:
            raise DocumentError('文档展开超过 100 MiB 或文件数上限。')
        names = [item.filename for item in entries]
        if len(set(names)) != len(names):
            raise DocumentError('文档包含重复 ZIP 路径。')
        for item in entries:
            name = item.filename
            if '\\' in name or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
                raise DocumentError('文档含不安全 ZIP 路径。')
            if item.flag_bits & 1 or any(value in name.lower() for value in ('vbaproject', '/embeddings/', 'activex')):
                raise DocumentError('文档包含宏、加密内容或嵌入程序。')
        xmls = {}
        try:
            for name in names:
                if name.endswith(('.xml', '.rels')):
                    xmls[name] = _xml(archive.read(name))
                    if name.endswith('.rels'):
                        if any(node.attrib.get('TargetMode', '').lower() == 'external' or re.match(r'^[a-zA-Z]+:', node.attrib.get('Target', '')) for node in xmls[name].iter()):
                            raise DocumentError('文档包含外部引用；请移除外链后重传。')
        except (zipfile.BadZipFile, RuntimeError) as exc:
            raise DocumentError('文档 ZIP 内容损坏。') from exc
        if extension == '.docx':
            root = xmls.get('word/document.xml')
            if root is None:
                raise DocumentError('缺少 Word 正文。')
            body = next((node for node in root.iter() if _tag(node) == 'body'), None)
            if body is None:
                raise DocumentError('缺少 Word 正文结构。')
            page_breaks = sum(1 for node in root.iter() if _tag(node) == 'lastRenderedPageBreak' or (_tag(node) == 'br' and any(key.endswith('}type') and value == 'page' for key, value in node.attrib.items())))
            if page_breaks + 1 > MAX_PAGES:
                raise DocumentError('文档超过 200 页；请拆分。')
            for index, node in enumerate(body, 1):
                if _tag(node) in {'p', 'tbl'}:
                    text = _text(node)
                    sections.append({'location': f'段落/表格 {index}', 'text': text, 'images': []})
            if not sections:
                raise DocumentError('Word 文档没有可提取的段落或表格。')
            warnings.append('Word 页码依赖排版；来源按段落/表格定位，请核对分页和表格布局。')
            parts = [('word/document.xml', root)]
        else:
            slide_names = sorted((name for name in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', name)), key=lambda name: int(re.search(r'slide(\d+)', name).group(1)))
            # Honor presentation relationship order, which need not match slide filenames.
            presentation = xmls.get('ppt/presentation.xml')
            rels = xmls.get('ppt/_rels/presentation.xml.rels')
            if presentation is not None and rels is not None:
                mapping = {node.attrib.get('Id'): 'ppt/' + node.attrib.get('Target', '').lstrip('/') for node in rels if _tag(node) == 'Relationship'}
                ordered = [mapping.get(next((value for key, value in node.attrib.items() if key.endswith('}id')), '')) for node in presentation.iter() if _tag(node) == 'sldId']
                if ordered:
                    slide_names = ordered
            if not slide_names or len(slide_names) > MAX_PAGES:
                raise DocumentError('PPT 缺少幻灯片或超过 200 页。')
            parts = []
            for index, name in enumerate(slide_names, 1):
                root = xmls.get(name)
                if root is None:
                    raise DocumentError('PPT 幻灯片引用损坏。')
                parts.append((name, root))
                sections.append({'location': f'幻灯片 {index}', 'text': '\n'.join(_text(node) for node in root.iter() if _tag(node) == 'p'), 'images': []})
        for index, (name, root) in enumerate(parts):
            if any(_tag(node) in {'oMath', 'oMathPara', 'chart', 'graphicFrame'} for node in root.iter()):
                warnings.append(f'{sections[min(index, len(sections)-1)]["location"]} 包含公式或图表，须人工核对。')
            relname = str(PurePosixPath(name).parent / '_rels' / (PurePosixPath(name).name + '.rels'))
            rels = xmls.get(relname)
            targets = {node.attrib.get('Id'): node.attrib.get('Target', '') for node in rels} if rels is not None else {}
            nodes = list(body) if extension == '.docx' else [root]
            for section_index, node in enumerate(nodes):
                if extension == '.docx' and _tag(node) not in {'p', 'tbl'}:
                    continue
                section = sections[sum(_tag(previous) in {'p', 'tbl'} for previous in nodes[:section_index])] if extension == '.docx' else sections[index]
                for picture in node.iter():
                    if _tag(picture) not in {'blip', 'imagedata'}:
                        continue
                    rid = next((value for key, value in picture.attrib.items() if key.endswith('}embed') or key.endswith('}id')), '')
                    target = targets.get(rid, '')
                    import posixpath
                    member = posixpath.normpath(str(PurePosixPath(name).parent / target))
                    if member not in names:
                        warnings.append(f'{section["location"]} 图片引用缺失。')
                        continue
                    suffix = Path(member).suffix.lower()
                    if suffix not in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'}:
                        warnings.append(f'{section["location"]} 图片格式 {suffix} 需人工核对。')
                        continue
                    filename = f'image-{len(list(output_dir.glob("image-*"))) + 1}{suffix}'
                    (output_dir / filename).write_bytes(archive.read(member))
                    section['images'].append(filename)
    if sum(len(section['text'].encode()) for section in sections) > MAX_TEXT:
        raise DocumentError('提取文本超过安全上限。')
    return {'kind': 'document', 'data': None, 'sections': sections, 'warnings': list(dict.fromkeys(warnings))}


def _pdf(path, output_dir):
    info = _run(['pdfinfo', str(path)])
    match = re.search(r'^Pages:\s+(\d+)', info, re.MULTILINE)
    if not match or not 0 < int(match.group(1)) <= MAX_PAGES:
        raise DocumentError('PDF 无法读取页数或超过 200 页；请拆分。')
    sections, warnings = [], []
    for page in range(1, int(match.group(1)) + 1):
        text = _run(['pdftotext', '-f', str(page), '-l', str(page), '-layout', str(path), '-']).strip()
        prefix = output_dir / f'page-{page}'
        _run(['pdftoppm', '-f', str(page), '-l', str(page), '-singlefile', '-scale-to', '1600', '-png', str(path), str(prefix)])
        image = prefix.with_suffix('.png')
        if sum(item.stat().st_size for item in output_dir.glob('page-*.png')) > MAX_EXPANDED:
            raise DocumentError('PDF 页面图像超过 100 MiB；请拆分。')
        if not text:
            languages = _run(['tesseract', '--list-langs'])
            if not all(language in languages.split() for language in ('chi_sim', 'eng')):
                raise DocumentError('扫描 PDF OCR 需要安装 tesseract chi_sim 和 eng 语言包。')
            text = _run(['tesseract', str(image), 'stdout', '-l', 'chi_sim+eng'], timeout=90).strip()
            warnings.append(f'第 {page} 页为 OCR 结果；文字、数字、答案、公式和表格必须核对。')
        sections.append({'location': f'第 {page} 页', 'text': text, 'images': [image.name]})
        if sum(len(section['text'].encode()) for section in sections) > MAX_TEXT:
            raise DocumentError('提取文本超过安全上限。')
    return {'kind': 'document', 'data': None, 'sections': sections, 'warnings': warnings}


def extract_document(path: Path, filename: str, output_dir: Path) -> dict:
    path, output_dir = Path(path).resolve(), Path(output_dir).resolve()
    validate_upload(filename, path.stat().st_size)
    extension = Path(filename).suffix.lower()
    output_dir.mkdir(parents=True, exist_ok=True)
    if extension == '.json':
        try:
            data = json.loads(path.read_text(encoding='utf-8-sig'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))
        except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
            raise DocumentError('JSON 编码或格式不正确。') from exc
        return {'kind': 'json', 'data': data, 'sections': [], 'warnings': []}
    if extension in {'.docx', '.pptx'}:
        return _office(path, extension, output_dir)
    if extension == '.pdf':
        if path.read_bytes()[:5] != b'%PDF-':
            raise DocumentError('文件不是有效 PDF。')
        return _pdf(path, output_dir)
    # Do not run legacy Office with the worker's network or profile privileges.
    # The deployer supplies a network-disabled container runner, never arbitrary shell.
    with path.open('rb') as original:
        if original.read(8) != bytes.fromhex('D0CF11E0A1B11AE1'):
            raise DocumentError('文件不是有效的旧版 Office 文档。')
    runner = os.environ.get('TEACHER_DOCUMENT_CONVERTER_RUNNER')
    if not runner or not Path(runner).is_absolute() or not Path(runner).is_file():
        raise DocumentError('DOC/PPT 隔离转换器未配置；请转换为 DOCX/PPTX 后重传。')
    with tempfile.TemporaryDirectory(dir=output_dir) as directory:
        destination = Path(directory)
        target_extension = '.docx' if extension == '.doc' else '.pptx'
        _run([runner, str(path), str(destination), target_extension[1:]], timeout=120)
        converted = destination / (path.stem + target_extension)
        if not converted.is_file():
            raise DocumentError('隔离转换未生成文档；请转换后重传。')
        validate_upload(converted.name, converted.stat().st_size)
        return _office(converted, target_extension, output_dir)
