"""Bounded, non-executing XMind parsing and atomic owner-scoped import.

Content detection follows the official loader: JSON wins over legacy XML.
Compatibility is object-specific; an accepted approximation never means fidelity.
"""
from __future__ import annotations
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import PurePosixPath
import re
import stat
import zipfile
import zlib
import lzma
from xml.etree import ElementTree as ET
from fastapi import HTTPException
from sqlalchemy import select
from app.core.image_validation import validate_image_bytes
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.xmind_import import MAX_IMPORT_WARNINGS
from app.services import file_service, graph_asset_service, subscription_service

MAX_UPLOAD = 50 * 1024 * 1024
MAX_EXPANDED = 60 * 1024 * 1024
MAX_ENTRIES = 1000
MAX_NODES = 2500
MAX_DEPTH = 128
MAX_CONVERTED_BYTES = 16 * 1024 * 1024
MAX_WARNING_BYTES = 2 * 1024 * 1024
MAX_WARNING_REFERENCES = 40000
CONTENT_NS = 'urn:xmind:xmap:xmlns:content:2.0'
STYLE_NS = 'urn:xmind:xmap:xmlns:style:2.0'
XHTML_NS = 'http://www.w3.org/1999/xhtml'


def reject(message, status=422):
    raise HTTPException(status_code=status, detail=message)



def estimated_json_bytes(value):
    """Conservative UTF-8/escaped JSON bound without serializing/copying strings.

    A Unicode code point needs at most6 UTF-8 JSON bytes with ensure_ascii=False;
    control characters need6 escaped bytes. Containers/scalars include separators.
    """
    if isinstance(value,str):return 2+6*len(value)
    if isinstance(value,dict):return 2+sum(estimated_json_bytes(k)+estimated_json_bytes(v)+2 for k,v in value.items())
    if isinstance(value,list):return 2+sum(estimated_json_bytes(v)+1 for v in value)
    return 32


class ConversionBudget:
    def __init__(self):self.converted=0;self.warning_bytes=0;self.warning_references=0
    def charge(self,size):
        if size>MAX_CONVERTED_BYTES-self.converted:reject('转换内容与来源记录超过16 MiB安全额度，请拆分文档后重试',413)
        self.converted+=size
    def warning(self,record,count):
        size=estimated_json_bytes(record)
        if count>=MAX_IMPORT_WARNINGS or size>MAX_WARNING_BYTES-self.warning_bytes:
            reject('转换差异超过2048项或2 MiB安全额度，请简化主题样式或拆分文档',413)
        self.warning_bytes+=size
        self.charge(size*2+256)  # Response, persisted warnings and bounded display count.
    def reference(self,record):
        size=estimated_json_bytes(record)
        if self.warning_references>=MAX_WARNING_REFERENCES or size>MAX_WARNING_BYTES-self.warning_bytes:
            reject('转换差异关联超过40000条或2 MiB安全额度，请拆分文档',413)
        self.warning_references+=1;self.warning_bytes+=size;self.charge(size*2)

def safe_path(name):
    if not isinstance(name, str) or not name or '\\' in name or '\x00' in name or ':' in name:
        reject('ZIP 资源路径非法')
    parts = name.rstrip('/').split('/')
    if name.startswith('/') or any(p in ('', '.', '..') for p in parts):
        reject('ZIP 资源路径逃逸或非规范路径')
    return name.rstrip('/')


def unpack(data, filename):
    if not filename.lower().endswith('.xmind'):
        reject('请选择 .xmind 文件')
    if len(data) > MAX_UPLOAD:
        reject('压缩文件超过 50 MiB', 413)
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ENTRIES:
                reject('ZIP 条目超过 1000', 413)
            seen, result, total = set(), {}, 0
            for entry in entries:
                name = safe_path(entry.filename)
                if name in seen:
                    reject('ZIP 存在重复路径')
                seen.add(name)
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    reject('ZIP 不允许符号链接或特殊文件')
                if entry.flag_bits & 1:
                    reject('不支持加密 XMind 文件')
                if entry.is_dir():
                    continue
                if total + entry.file_size > MAX_EXPANDED:
                    reject('解压总量超过 60 MiB', 413)
                chunks = []
                with archive.open(entry) as stream:
                    while True:
                        chunk = stream.read(min(65536, MAX_EXPANDED - total + 1))
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_EXPANDED:
                            reject('真实解压总量超过 60 MiB', 413)
                        chunks.append(chunk)
                result[name] = b''.join(chunks)
            return result
    except (zipfile.BadZipFile, RuntimeError, ValueError, NotImplementedError, EOFError, OSError, zlib.error, lzma.LZMAError) as exc:
        reject('损坏或不支持的 ZIP 文件：' + type(exc).__name__)


def bounded(value):
    """Bound structure depth/count before recursive conversion, including metadata."""
    stack = [(value, 0)]; count = 0
    while stack:
        item, depth = stack.pop(); count += 1
        if depth > MAX_DEPTH or count > 200000:
            reject('文档结构深度或对象数量超限')
        if isinstance(item, dict):
            stack.extend((v, depth + 1) for v in item.values())
        elif isinstance(item, list):
            stack.extend((v, depth + 1) for v in item)


def read_json(data):
    def pairs(items):
        result = {}
        for key, val in items:
            if key in result: reject('JSON 存在重复键')
            result[key] = val
        return result
    try:
        value = json.loads(data.decode('utf-8-sig'), object_pairs_hook=pairs,
                           parse_constant=lambda _: reject('JSON 不允许非有限数字'))
        bounded(value)
        return value
    except (ValueError, UnicodeError, RecursionError):
        reject('JSON 内容损坏或已加密')


def read_xml(data):
    # UTF-16/32 input may hide declaration bytes; decode strictly before inspection.
    if b'\x00' in data: reject('XML 仅支持 UTF-8，禁止隐藏声明')
    try:
        text = data.decode('utf-8-sig')
        if re.search(r'<!\s*(DOCTYPE|ENTITY)', text, re.I):
            reject('XML 禁止 DTD 与实体声明')
        root = ET.fromstring(text)
        stack = [(root, 0)]; count = 0
        while stack:
            element, depth = stack.pop(); count += 1
            if depth > MAX_DEPTH or count > 200000: reject('XML 结构超限')
            stack.extend((child, depth + 1) for child in element)
        return root
    except (UnicodeError, ET.ParseError, RecursionError):
        reject('XML 内容损坏')


def local_attributes(element):
    return {k.split('}')[-1]: v for k, v in element.attrib.items()}


def xml_sheets(entries):
    if 'META-INF/manifest.xml' not in entries: reject('XML 包缺少 META-INF/manifest.xml')
    read_xml(entries['META-INF/manifest.xml'])
    root = read_xml(entries['content.xml'])
    if root.tag != '{' + CONTENT_NS + '}xmap-content': reject('不支持的 XML 内容命名空间')
    styles, themes = {}, {}
    if 'styles.xml' in entries:
        style_root = read_xml(entries['styles.xml'])
        if style_root.tag != '{' + STYLE_NS + '}xmap-styles': reject('不支持的 XML 样式命名空间')
        for el in style_root.findall('.//{' + STYLE_NS + '}style'):
            props = el.find('{' + STYLE_NS + '}topic-properties')
            if props is not None:
                p = {}
                for key, val in props.attrib.items():
                    ns, _, local = key[1:].partition('}') if key.startswith('{') else ('', '', key)
                    p[('fo:' if ns == 'http://www.w3.org/1999/XSL/Format' else 'svg:' if ns == 'http://www.w3.org/2000/svg' else '') + local] = val
                styles[el.get('id')] = p
        for theme in style_root.findall('.//{' + STYLE_NS + '}theme'):
            themes[theme.get('id')] = {el.get('style-family'): {'properties': styles.get(el.get('style-id'), {})} for el in theme.findall('{' + STYLE_NS + '}default-style')}
    ns = '{' + CONTENT_NS + '}'
    def structural(element,tags):
        for tag in tags:
            if len(element.findall(tag))>1:reject('XML 存在重复结构元素，未丢弃内容')
    def attributes(element,known):return {k:v for k,v in element.attrib.items() if k not in known}
    def child_attributes(element):
        result={}
        for child in element:
            attrs=attributes(child,{'src','{'+XHTML_NS+'}src'} if child.tag=='{'+XHTML_NS+'}img' else set())
            if attrs:result[child.tag]=attrs
            if child.tag==ns+'notes':
                for field in child:
                    if field.attrib:result[child.tag+'/'+field.tag]=dict(field.attrib)
        return result
    def topic(el):
        if el is None: reject('工作表缺少根主题')
        structural(el,[ns+'title',ns+'notes',ns+'children','{'+XHTML_NS+'}img'])
        title_element=el.find(ns+'title')
        if title_element is not None and len(title_element):reject('XML 结构化标题暂不支持，未丢弃内容')
        result = {'id': el.get('id'), 'title': el.findtext(ns + 'title', ''), 'style': {'properties': styles.get(el.get('style-id'), {})}}
        result['xmlAttributes']=attributes(el,{'id','style-id'})
        result['xmlElementAttributes']=child_attributes(el)
        href=el.get('{http://www.w3.org/1999/xlink}href')
        if href is not None:result['href']=href
        plain = el.find(ns + 'notes/' + ns + 'plain')
        if plain is not None:
            if len(plain):reject('XML 结构化纯文本备注暂不支持，未丢弃内容')
            result['notes'] = {'plain': {'content': ''.join(plain.itertext())}}
            for field in el.find(ns+'notes'):
                if field.tag!=ns+'plain':result.setdefault('xmlUnsupported',[]).append(ET.tostring(field,encoding='unicode'))
        elif el.find(ns + 'notes') is not None: reject('XML 富文本备注暂不支持，请先转换为纯文本')
        img = el.find('{' + XHTML_NS + '}img')
        if img is not None:
            result['image'] = {'src': img.get('{' + XHTML_NS + '}src') or img.get('src') or ''}
        children = {}
        container=el.find(ns+'children')
        if container is not None and any(child.tag!=ns+'topics' for child in container):reject('XML 子主题容器存在不支持元素，未丢弃内容')
        for group in el.findall(ns + 'children/' + ns + 'topics'):
            if any(child.tag!=ns+'topic' for child in group):reject('XML 子主题组存在不支持元素，未丢弃内容')
            kind=group.get('type','attached')
            if kind in children:reject('XML 存在重复子主题组，未丢弃任何主题')
            group_attrs=attributes(group,{'type'})
            if group_attrs:result['xmlElementAttributes']['children/topics:'+kind]=group_attrs
            children[kind] = [topic(child) for child in group.findall(ns + 'topic')]
        result['children'] = children
        known = {ns+'title',ns+'notes',ns+'children','{'+XHTML_NS+'}img'}
        for child in el:
            name = child.tag.split('}')[-1]
            if child.tag not in known:
                result.setdefault('xmlUnsupported', []).append(ET.tostring(child, encoding='unicode'))
        return result
    sheets = []
    for el in root.findall(ns + 'sheet'):
        structural(el,[ns+'title',ns+'topic',ns+'relationships'])
        s = {'id': el.get('id'), 'title': el.findtext(ns + 'title', ''), 'rootTopic': topic(el.find(ns + 'topic')), 'theme': themes.get(el.get('theme'), {})}
        s['xmlAttributes']=attributes(el,{'id','theme'})
        s['xmlDocumentAttributes']=attributes(root,{'version'})
        s['xmlElementAttributes']={child.tag:dict(child.attrib) for child in el if child.tag==ns+'title' and child.attrib}
        for child in el:
            if child.tag not in (ns+'title',ns+'topic'):
                s.setdefault('xmlUnsupported',[]).append(ET.tostring(child,encoding='unicode'))
        sheets.append(s)
    return sheets


def parse(data, filename):
    try:
        return _parse(data, filename)
    except (AttributeError, TypeError, KeyError, RecursionError):
        reject("文档字段类型或结构非法")


def _parse(data, filename):
    entries = unpack(data, filename)
    if 'content.json' in entries:
        fmt, sheets = 'json', read_json(entries['content.json'])
    elif 'content.xml' in entries:
        fmt, sheets = 'xml', xml_sheets(entries)
    else: reject('包内缺少 content.json 或 content.xml')
    if not isinstance(sheets, list) or not sheets or len(sheets) > 100:
        reject('工作表必须为非空数组，最多 100 张')
    result = {'format': fmt, 'sha256': sha256(data).hexdigest(), 'sheets': [], 'warnings': [], 'resources': {}}
    labels = {}
    budget = ConversionBudget()
    warning_index={};warning_refs={}
    def warn(sheet_id, object_id, code, detail):
        key=(sheet_id,code,detail)
        ref={'id':object_id,'title':labels.get(object_id,object_id)}
        if key in warning_index:
            record=warning_index[key]
            if object_id in warning_refs[key]:return
            budget.reference(ref)
            warning_refs[key].add(object_id);record['affectedObjects'].append(ref)
            record['objectTitle']=record['affectedObjects'][0]['title']+f" 等{len(record['affectedObjects'])}个主题"
            return
        index=len(result['warnings'])
        record={'id':f'{result["sha256"][:16]}-w{index}','sheetId':sheet_id,'objectId':object_id,'code':code,'detail':detail,'sheetTitle':labels.get(sheet_id,sheet_id),'objectTitle':ref['title'],'affectedObjects':[]}
        budget.warning(record,index);budget.reference(ref)
        record['affectedObjects'].append(ref)
        warning_index[key]=record;warning_refs[key]={object_id};result['warnings'].append(record)
    used_sheets = set()
    for sheet in sheets:
        if not isinstance(sheet, dict): reject('工作表结构非法')
        sid = sheet.get('id')
        if not isinstance(sid, str) or not sid or len(sid) > 100 or sid in used_sheets: reject('工作表 ID 缺失、重复或过长')
        used_sheets.add(sid)
        title = sheet.get('title', '')
        if not isinstance(title, str) or len(title) > 100: reject('工作表标题必须为文本且不超过 100 字')
        labels[sid] = title or '未命名工作表'
        stem = PurePosixPath(filename.replace('\\', '/')).stem
        name = f'{stem}—{title or sid}'
        if len(name) > 100: reject('导入文件名超过 100 字，请先缩短原文件名或工作表名称')
        graph = file_service.blank_graph_data(name)
        graph['meta']['xmindSource'] = {'format': fmt, 'sha256': result['sha256'], 'sheetId': sid}
        ids = set(); image_count = 0; notes_count = 0
        warn(sid, sid, 'layout', '原始主题布局改为可编辑的向右层级布局；坐标、主题几何及排版不等价。')
        if sheet.get('extensions') or sheet.get('xmlUnsupported'):
            warn(sid, sid, 'sheet-objects', '工作表扩展或 XML 关系仅保留来源记录，未转为可交互对象。')
        extras={k:v for k,v in sheet.items() if k!='rootTopic'}
        budget.charge(estimated_json_bytes(extras)+2048)
        graph['meta']['xmindSource']['sheetExtras']=extras
        if sheet.get('xmlAttributes') or sheet.get('xmlDocumentAttributes') or sheet.get('xmlElementAttributes'):
            warn(sid,sid,'xml-attributes','工作表或文档的未映射 XML 属性保留在来源记录，未应用其行为。')
        theme = sheet.get('theme') if sheet.get('theme') is not None else {}
        if not isinstance(theme, dict): reject('主题样式结构非法')
        if theme.get('map', {}).get('properties'):
            warn(sid, sid, 'map-style', '背景、调色板与主题自动继承按系统默认替代；各主题原始样式保留在来源记录。')
        for entry in theme.values():
            if isinstance(entry,dict) and 'properties' in entry and not isinstance(entry['properties'],dict):reject('主题样式 properties 必须为对象')
        if 'relationships' in sheet and not isinstance(sheet['relationships'],list):reject('工作表关系必须为数组')
        def visit(topic, parent=None, depth=0, parent_line=None):
            nonlocal image_count, notes_count
            if not isinstance(topic, dict): reject('主题结构非法')
            for key in ('children','notes','style','image'):
                if key in topic and topic[key] is not None and not isinstance(topic[key],dict):reject(f'主题 {key} 必须为对象')
            if 'attributedTitle' in topic and (not isinstance(topic['attributedTitle'],list) or any(not isinstance(v,dict) for v in topic['attributedTitle'])):reject('分段标题结构非法')
            if depth > MAX_DEPTH or len(ids) >= MAX_NODES: reject('每工作表最多 2500 主题或层级超限')
            tid = topic.get('id')
            if not isinstance(tid, str) or not tid or len(tid)>100 or tid in ids: reject('主题 ID 缺失、重复或过长')
            ids.add(tid)
            text = topic.get('title', '')
            if not isinstance(text, str): reject('主题标题必须为文本')
            labels[tid] = text or '未命名主题'
            if len(text)>80: reject('主题标题超过当前可编辑卡牌 80 字上限；请缩短后重试，未截断')
            notes = topic.get('notes') or {}
            if not isinstance(notes, dict): reject('备注结构非法')
            if 'plain' in notes and not isinstance(notes['plain'],dict):reject('纯文本备注必须为对象')
            plain = notes.get('plain', {}).get('content', '')
            if not isinstance(plain, str) or len(plain)>100000: reject('备注必须为文本且不超过 100000 字')
            if notes and 'plain' not in notes: reject('仅富文本备注暂不支持，请转换为纯文本')
            if notes.get('realHTML') or notes.get('html'):
                warn(sid, tid, 'notes-format', '完整纯文本备注保留并可编辑；富文本备注排版未映射。')
            notes_count += bool(plain)
            kind = 'centralTopic' if depth == 0 else 'mainTopic' if depth == 1 else 'subTopic'
            inherited = theme.get(kind, {}).get('properties', {})
            own = (topic.get('style') or {}).get('properties', {})
            if not isinstance(inherited, dict) or not isinstance(own, dict): reject('主题样式必须为对象')
            topic_source={k:v for k,v in topic.items() if k!='children'}
            # Reserve all replicated source/style/content BEFORE merge, deepcopy or warnings.
            budget.charge(estimated_json_bytes(topic_source)+estimated_json_bytes(inherited)+estimated_json_bytes(own)+estimated_json_bytes(parent_line or {})+6*(len(text)+len(plain))+4096)
            props = {**(parent_line or {}), **inherited, **own}
            appearance, edge = map_style(props, lambda code, detail: warn(sid, tid, code, detail))
            node = {'id': tid, 'content': {'title': text, 'notes': plain, 'images': []}, 'appearance': appearance,
                    'geometry': {'x': 100+depth*260, 'y': 80+len(graph['nodes'])*190, 'width':160, 'height':166},
                    'xmindSource': {'topic': deepcopy(topic_source), 'style': props}}
            if topic.get('image'):
                image = topic['image']
                if not isinstance(image, dict) or not isinstance(image.get('src'), str): reject('图片引用非法')
                src = image['src']
                if not src.startswith('xap:'): reject('图片必须引用包内资源，禁止外部图片链接')
                path = safe_path(src[4:])
                if path not in entries: reject('缺失图片资源：'+path)
                ext = PurePosixPath(path).suffix.lower()
                mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}.get(ext)
                if not mime: reject('不支持图片格式：'+ext+'；未丢弃图片，请先转换为 PNG/JPEG/WebP')
                width,height = validate_image_bytes(entries[path], mime)
                result['resources'][path] = (entries[path],mime,width,height)
                node['content']['images'] = [{'resourcePath':path,'alt':text,'width':width,'height':height}]
                image_count += 1
            font_size = appearance['fontSize']
            card_width = max(160, min(420, round(font_size * 10)))
            if depth == 0 or node['content']['images']:card_width = max(320,card_width)
            rows = max(1, math.ceil(len(text) * font_size * .75 / (card_width - 28)))
            text_height = rows * font_size * 1.3 + 32
            card_height = max(166,math.ceil(text_height / .52) if node['content']['images'] else math.ceil(text_height))
            if node['content']['images']:card_height = max(300,card_height)
            node['geometry'].update(width=card_width,height=card_height)
            if topic.get('xmlAttributes') or topic.get('xmlElementAttributes'):
                warn(sid,tid,'xml-attributes','主题的未映射 XML 属性保留在来源记录：'+', '.join((topic.get('xmlAttributes') or {}).keys())+'；未应用其行为。')
            ignored = [k for k in ('markers','labels','boundaries','summaries','numbering','extensions','href','xmlUnsupported') if topic.get(k)]
            if ignored: warn(sid,tid,'special-objects','对象 '+', '.join(ignored)+' 仅保留原始来源记录，未转为交互对象。')
            if topic.get('attributedTitle') and any(set(span)-{'text'} for span in topic['attributedTitle']):
                warn(sid,tid,'title-format','标题保留纯文本；分段富文本样式未映射。')
            graph['nodes'].append(node)
            if parent: graph['links'].append({'id':f'h{len(graph["links"])}','from':parent,'to':tid,'hierarchy':True,**edge})
            children = topic.get('children') or {}
            if not isinstance(children, dict): reject('子主题结构非法')
            for child_type, group in children.items():
                if not isinstance(group, list): reject('子主题组必须为数组')
                if group and child_type != 'attached':
                    warn(sid,tid,'special-topics',f'{child_type} 的 {len(group)} 个主题改为独立可编辑主题，特殊关联不等价。')
                for child in group: visit(child, tid if child_type=='attached' else None, depth+1, {k:v for k,v in props.items() if k.startswith('line-')})
        visit(sheet.get('rootTopic'))
        for rel in sheet.get('relationships') or []:
            if not isinstance(rel,dict): reject('关系结构非法')
            a,b=rel.get('end1Id'),rel.get('end2Id') or rel.get('end2id')
            if a not in ids or b not in ids: reject('关系引用缺失主题')
            labels[rel.get('id','relationship')] = rel.get('title') or '主题关系'
            if not isinstance(rel.get('title',''),str) or len(rel.get('title',''))>60:reject('关系标题必须为文本且不超过 60 字，未截断')
            inherited=theme.get('relationship',{}).get('properties',{});own=(rel.get('style') or {}).get('properties',{})
            budget.charge(estimated_json_bytes(rel)+estimated_json_bytes(inherited)+estimated_json_bytes(own)+2048)
            props={**inherited,**own}
            _,edge=map_style(props,lambda code,detail:warn(sid,rel.get('id','relationship'),code,detail))
            graph['links'].append({'id':f'r{len(graph["links"])}','from':a,'to':b,'hierarchy':False,'type':str(rel.get('title','')),**edge,'xmindSource':rel})
            warn(sid,rel.get('id','relationship'),'relationship','关系端点和文字保留；原始控制点、箭头和曲线几何改为系统关系。')
        if len(graph['links'])>5000: reject('关系数量超过 5000，未截断')
        position_hierarchy(graph)
        result['sheets'].append({'id':sid,'title':title,'name':name,'nodeCount':len(ids),'imageCount':image_count,'notesCount':notes_count,'graph':graph})
    return result


def map_style(props, warn):
    appearance={'cardStyle':'rounded','size':'big','fontFamily':'system','fontWeight':'normal','fontSize':15,'textColor':'#0f172a','fillColor':'#eff6ff'}
    edge={'lineStyle':'solid','pathStyle':'curve','color':'#2563eb','strokeWidth':2}
    for key,val in props.items():
        if val in ('inherited','auto',None):
            warn('inherited-style',f'{key}={val} 的自动继承改为系统默认样式。');continue
        if key=='fo:font-family':
            warn('font-family',f'原字体 {val} 替换为系统字体；当前未验证原字体可用。')
        elif key in ('fo:font-size','line-width'):
            match=re.fullmatch(r'(\d+(?:\.\d+)?)(pt|px)?',str(val))
            if not match: warn('style-value',f'{key}={val} 无法映射，使用系统默认。');continue
            size=float(match[1])*(4/3 if match[2]=='pt' else 1)
            maximum=288 if key=='fo:font-size' else 8
            minimum=6 if key=='fo:font-size' else 1
            if not minimum<=size<=maximum:
                warn('style-value',f'{key}={val} 超出系统范围，使用默认值。');continue
            if key=='fo:font-size':appearance['fontSize']=round(size,2)
            else:edge['strokeWidth']=round(size,2)
        elif key in ('fo:color','svg:fill','line-color') and re.fullmatch(r'#[0-9a-fA-F]{6}',str(val)):
            if key=='line-color':edge['color']=val
            else:appearance['textColor' if key=='fo:color' else 'fillColor']=val
        elif key=='fo:font-weight':
            appearance['fontWeight']='bold' if str(val) in ('bold','700') else 'normal'
            if str(val) not in ('bold','700','normal','400'):warn('font-weight',f'字重 {val} 近似为 normal。')
        elif key=='fo:font-style' and val in ('italic','normal'):appearance['fontStyle']=val
        elif key=='fo:text-align' and val in ('left','center','right'):appearance['textAlign']=val
        elif key=='fo:text-decoration' and val in ('none','underline','line-through'):
            appearance['underline']=val=='underline';appearance['strikeThrough']=val=='line-through'
        elif key=='shape-class':
            shapes={'org.xmind.topicShape.roundedRect':'rounded','org.xmind.topicShape.rect':'rectangle','org.xmind.topicShape.ellipse':'circle'}
            appearance['cardStyle']=shapes.get(val,'rounded')
            warn('shape',f'形状 {val} 改为系统 {appearance["cardStyle"]} 卡牌；尺寸、圆角比例不等价。')
        elif key=='line-pattern' and val in ('solid','dash','dot'):
            edge['lineStyle']={'solid':'solid','dash':'dashed','dot':'dotted'}[val]
        elif key=='line-class':
            edge['pathStyle']='elbow' if 'Elbow' in str(val) or 'elbow' in str(val) else 'straight' if 'straight' in str(val) else 'curve'
            warn('line-geometry',f'连接线 {val} 近似为 {edge["pathStyle"]}，路径和圆角不等价。')
        else:warn('style-property',f'样式 {key}={val} 未映射，保留来源值并使用系统默认。')
    if not re.fullmatch(r'#[0-9a-fA-F]{6}',str(props.get('fo:color',''))):
        fill=appearance['fillColor'];rgb=[int(fill[i:i+2],16) for i in (1,3,5)]
        appearance['textColor']='#ffffff' if sum(c*w for c,w in zip(rgb,(.299,.587,.114)))<150 else '#0f172a'
    return appearance,edge


def position_hierarchy(graph):
    """Fixed import-only tree coordinates; interactive layouts remain the shared T10 UI."""
    nodes={n['id']:n for n in graph['nodes']};children={id:[] for id in nodes};parented=set()
    for link in graph['links']:
        if link['hierarchy']:
            children[link['from']].append(link['to']);parented.add(link['to'])
    spans={}
    def span(id):
        value=max(nodes[id]['geometry']['height'],sum(span(c) for c in children[id])+32*max(0,len(children[id])-1))
        spans[id]=value;return value
    def place(id,x,top):
        geometry=nodes[id]['geometry'];geometry['x']=round(x);geometry['y']=round(top+(spans[id]-geometry['height'])/2)
        cursor=top+(spans[id]-sum(spans[c] for c in children[id])-32*max(0,len(children[id])-1))/2
        for child in children[id]:
            place(child,x+geometry['width']+80,cursor);cursor+=spans[child]+32
    top=80
    for id in nodes:
        if id not in parented:
            span(id);place(id,100,top);top+=spans[id]+80


async def check_quota(db,user,parsed):
    subscription=await db.get(Subscription,user.username)
    paid=subscription_service.entitlements_for(user.role,subscription)['allExamPapers']
    limit=MAX_NODES if paid else 50
    for sheet in parsed['sheets']:
        if sheet['nodeCount']>limit:reject(f'工作表「{sheet["title"]}」超过当前账号每图谱 {limit} 卡牌额度，未截断')
    return {'maxNodesPerSheet':limit,'maxSheets':100,'maxFiles':None,'fileQuotaNote':'每次最多导入 100 张工作表，每张生成一个新图谱。'}


def public_preview(parsed,quota):
    return {'format':parsed['format'],'sha256':parsed['sha256'],'quota':quota,'sheets':[{k:v for k,v in s.items() if k!='graph'}|{'sample':[{'title':n['content']['title'],'notesLength':len(n['content']['notes']),'imageCount':len(n['content']['images'])} for n in s['graph']['nodes'][:5]]} for s in parsed['sheets']], 'warnings':parsed['warnings'],'compatibility':'仅按包内 JSON/XML 结构识别；不声明所有 XMind 版本完全支持。'}


async def import_parsed(db,user,parsed,sheet_ids,accepted):
    selected=[s for s in parsed['sheets'] if s['id'] in sheet_ids]
    if not sheet_ids or len(set(sheet_ids))!=len(sheet_ids) or len(selected)!=len(sheet_ids):reject('工作表选择为空、重复或不存在')
    relevant=[w for w in parsed['warnings'] if w['sheetId'] in sheet_ids]
    if not {w['id'] for w in relevant}.issubset(set(accepted)):reject('请明确接受所有所选工作表的保真差异，或取消导入')
    if not set(accepted).issubset({w['id'] for w in parsed['warnings']}):reject('确认差异 ID 与当前文件不匹配')
    # Serialize this account's quota checks and import writes together.
    await db.scalar(select(User).where(User.username==user.username).with_for_update())
    await check_quota(db,user,{'sheets':selected})
    files=[]; refs={}
    try:
        for sheet in selected:
            graph=deepcopy(sheet['graph'])
            graph['meta']['xmindSource']['acceptedWarnings']=[w for w in relevant if w['sheetId']==sheet['id']]
            for node in graph['nodes']:
                for index,image in enumerate(node['content']['images']):
                    path=image['resourcePath']
                    if path not in refs:
                        data,mime,_,_=parsed['resources'][path]
                        refs[path]=await graph_asset_service.create_asset(db,user.username,image_bytes=data,mime_type=mime,filename=PurePosixPath(path).name,commit=False)
                    node['content']['images'][index]={**refs[path],'alt':image['alt']}
            file=await file_service.create_file(db,user.username,name=sheet['name'],graph_data=graph,source='xmind-import',commit=False)
            files.append((sheet['id'],file))
        await db.commit()
        for _,file in files:await db.refresh(file)
    except BaseException:
        await db.rollback()
        raise
    return {'format':parsed['format'],'warnings':relevant,'files':[{'sheetId':sid,'file':file_service.file_meta(file)} for sid,file in files]}
