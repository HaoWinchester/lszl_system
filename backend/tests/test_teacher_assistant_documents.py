import json
import zipfile
from pathlib import Path
import pytest
from app.services.teacher_assistant_documents import DocumentError, extract_document, validate_upload


def package(path, entries):
    with zipfile.ZipFile(path, 'w') as archive:
        for name, value in entries.items():
            archive.writestr(name, value)
    return path


def test_json_preserves_payload(tmp_path):
    payload = {'questions': [{'answer': ['A', 'C'], 'principleIds': [2]}]}
    path = tmp_path / 'input.json'
    path.write_text(json.dumps(payload))
    assert extract_document(path, path.name, tmp_path / 'out')['data'] == payload


def test_upload_limits():
    with pytest.raises(DocumentError): validate_upload('x.json', 20 * 1024 * 1024 + 1)
    with pytest.raises(DocumentError): validate_upload('x.exe', 1)


def test_docx_paragraph_table_formula_and_image(tmp_path):
    xml = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:t>题目一</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A 选项</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p></w:body></w:document>'''
    path = package(tmp_path / 'x.docx', {'word/document.xml': xml})
    result = extract_document(path, path.name, tmp_path / 'out')
    assert result['sections'][0]['text'] == '题目一'
    assert 'A 选项' in result['sections'][1]['text']
    assert result['warnings']


@pytest.mark.parametrize('entries', [ {'../evil': 'bad', 'word/document.xml': '<x/>'}, {'word/document.xml': '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>'}, {'word/document.xml': '<broken'}, {'word/document.xml': '<x/>', 'word/vbaProject.bin': 'macro'}, {'word/document.xml': '<x/>', 'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>'} ])
def test_unsafe_packages_rejected(tmp_path, entries):
    path = package(tmp_path / 'x.docx', entries)
    with pytest.raises(DocumentError): extract_document(path, path.name, tmp_path / 'out')


def test_pptx_slide_order(tmp_path):
    xml = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:sld>'
    path = package(tmp_path / 'x.pptx', {'ppt/slides/slide2.xml': xml.format('二'), 'ppt/slides/slide1.xml': xml.format('一')})
    result = extract_document(path, path.name, tmp_path / 'out')
    assert [section['text'] for section in result['sections']] == ['一', '二']


def test_expansion_limit(tmp_path, monkeypatch):
    import app.services.teacher_assistant_documents as parser
    monkeypatch.setattr(parser, 'MAX_EXPANDED', 64)
    path = package(tmp_path / 'x.docx', {'word/document.xml': '<x>' + 'a' * 100 + '</x>'})
    with pytest.raises(DocumentError): extract_document(path, path.name, tmp_path / 'out')


def test_legacy_requires_isolation(tmp_path, monkeypatch):
    monkeypatch.delenv('TEACHER_DOCUMENT_CONVERTER_RUNNER', raising=False)
    path = tmp_path / 'old.doc'
    path.write_bytes(bytes.fromhex('D0CF11E0A1B11AE1'))
    with pytest.raises(DocumentError, match='隔离转换器'): extract_document(path, path.name, tmp_path / 'out')


def test_docx_image_location(tmp_path, monkeypatch):
    import app.services.teacher_assistant_documents as parser
    monkeypatch.setattr(parser, "_run", lambda args, **kwargs: "chi_sim eng" if "--list-langs" in args else "图片文字")
    xml = '<w:document xmlns:w="urn:w" xmlns:a="urn:a" xmlns:r="urn:r"><w:body><w:p><w:t>图片</w:t><a:blip r:embed="r1"/></w:p></w:body></w:document>'
    path = package(tmp_path / 'x.docx', {'word/document.xml': xml, 'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Target="media/test.png"/></Relationships>', 'word/media/test.png': b'\x89PNG\r\n\x1a\n'})
    result = extract_document(path, path.name, tmp_path / 'out')
    assert (tmp_path / 'out' / result['sections'][0]['images'][0]).read_bytes().startswith(b'\x89PNG')


def test_text_pdf_real_poppler(tmp_path):
    import shutil
    if not all(shutil.which(command) for command in ('pdfinfo', 'pdftotext', 'pdftoppm')):
        pytest.skip('Poppler CLI tools unavailable')
    content = b'BT /F1 12 Tf 50 100 Td (Question A) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream']
    document = b'%PDF-1.4\n'
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(document))
        document += str(index).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
    start = len(document)
    document += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:])
    document += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(start).encode() + b'\n%%EOF'
    path = tmp_path / 'text.pdf'
    path.write_bytes(document)
    result = extract_document(path, path.name, tmp_path / 'out')
    assert 'Question A' in result['sections'][0]['text']
    assert (tmp_path / 'out' / result['sections'][0]['images'][0]).is_file()


def test_scanned_pdf_real_ocr(tmp_path):
    import shutil
    import subprocess
    if not all(shutil.which(command) for command in ('pdfinfo', 'pdftotext', 'pdftoppm', 'tesseract')):
        pytest.skip('Poppler or Tesseract unavailable')
    languages = subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True, check=True).stdout.split()
    if not all(language in languages for language in ('chi_sim', 'eng')):
        pytest.skip('Tesseract chi_sim+eng unavailable')
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new('RGB', (1000, 600), 'white')
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 60) if Path('/System/Library/Fonts/Supplemental/Arial.ttf').exists() else ImageFont.load_default()
    ImageDraw.Draw(image).text((80, 100), 'Question A 123', font=font, fill='black')
    path = tmp_path / 'scan.pdf'
    image.save(path, 'PDF')
    result = extract_document(path, path.name, tmp_path / 'out')
    assert '123' in result['sections'][0]['text']
    assert any('OCR' in warning for warning in result['warnings'])


def office_image_package(tmp_path, extension, picture):
    if extension == '.docx':
        xml = '<w:document xmlns:w="urn:w" xmlns:a="urn:a" xmlns:r="urn:r"><w:body><w:p><a:blip r:embed="r1"/></w:p></w:body></w:document>'
        entries = {'word/document.xml': xml, 'word/_rels/document.xml.rels': '<Relationships><Relationship Id="r1" Target="media/test.png"/></Relationships>', 'word/media/test.png': picture}
    else:
        xml = '<p:sld xmlns:p="urn:p" xmlns:a="urn:a" xmlns:r="urn:r"><a:blip r:embed="r1"/></p:sld>'
        entries = {'ppt/slides/slide1.xml': xml, 'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="r1" Target="../media/test.png"/></Relationships>', 'ppt/media/test.png': picture}
    return package(tmp_path / ('images' + extension), entries)


@pytest.mark.parametrize('extension', ['.docx', '.pptx'])
def test_image_only_office_real_ocr(tmp_path, extension):
    import io
    import shutil
    import subprocess
    if not shutil.which('tesseract'):
        pytest.skip('Tesseract unavailable')
    languages = subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True, check=True).stdout.split()
    if not all(language in languages for language in ('chi_sim', 'eng')):
        pytest.skip('Tesseract chi_sim+eng unavailable')
    from PIL import Image, ImageDraw, ImageFont
    image = Image.new('RGB', (1000, 400), 'white')
    fonts = [Path('/System/Library/Fonts/Supplemental/Arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
    font = ImageFont.truetype(str(next(path for path in fonts if path.exists())), 60)
    ImageDraw.Draw(image).text((60, 120), 'Question A 123', font=font, fill='black')
    buffer = io.BytesIO(); image.save(buffer, 'PNG')
    path = office_image_package(tmp_path, extension, buffer.getvalue())
    result = extract_document(path, path.name, tmp_path / 'out')
    assert '123' in result['sections'][0]['text']
    assert any('OCR' in warning for warning in result['warnings'])
    assert (tmp_path / 'out' / result['sections'][0]['images'][0]).is_file()


@pytest.mark.parametrize('extension', ['.docx', '.pptx'])
def test_office_ocr_errors_and_limits(tmp_path, monkeypatch, extension):
    import app.services.teacher_assistant_documents as parser
    path = office_image_package(tmp_path, extension, b'fake')
    monkeypatch.setattr(parser, '_run', lambda args, **kwargs: 'eng')
    with pytest.raises(DocumentError, match='chi_sim'):
        extract_document(path, path.name, tmp_path / 'out')
    monkeypatch.setattr(parser, '_run', lambda args, **kwargs: 'chi_sim eng' if '--list-langs' in args else '答案' * 100)
    monkeypatch.setattr(parser, 'MAX_TEXT', 30)
    with pytest.raises(DocumentError, match='OCR 提取文本'):
        extract_document(path, path.name, tmp_path / 'out2')
    monkeypatch.setattr(parser, 'MAX_TEXT', 8 * 1024 * 1024)
    monkeypatch.setattr(parser, 'MAX_IMAGES', 0)
    with pytest.raises(DocumentError, match='图片超过'):
        extract_document(path, path.name, tmp_path / 'out3')


def test_hybrid_pdf_header_and_scanned_question(tmp_path):
    import shutil,subprocess
    if not all(shutil.which(c) for c in ('pdfinfo','pdftotext','pdftoppm','tesseract')): pytest.skip('tools unavailable')
    if not all(v in subprocess.run(['tesseract','--list-langs'],capture_output=True,text=True).stdout.split() for v in ('chi_sim','eng')): pytest.skip('OCR languages unavailable')
    from PIL import Image,ImageDraw,ImageFont
    image=Image.new('RGB',(1000,500),'white')
    fonts=[Path('/System/Library/Fonts/Supplemental/Arial.ttf'),Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
    font=ImageFont.truetype(str(next(p for p in fonts if p.exists())),60)
    ImageDraw.Draw(image).text((80,160),'Question B 789',font=font,fill='black');picture=image.tobytes()
    content=b'BT /F1 14 Tf 20 360 Td (Page 1) Tj ET\nq 500 0 0 250 0 40 cm /Im1 Do Q'
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream',b'<< /Type /XObject /Subtype /Image /Width 1000 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length '+str(len(picture)).encode()+b' >>\nstream\n'+picture+b'\nendstream']
    document=b'%PDF-1.4\n';offsets=[0]
    for i,obj in enumerate(objects,1): offsets.append(len(document));document+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
    start=len(document);document+=b'xref\n0 7\n0000000000 65535 f \n'+b''.join(f'{o:010} 00000 n \n'.encode() for o in offsets[1:]);document+=b'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+str(start).encode()+b'\n%%EOF'
    path=tmp_path/'hybrid.pdf';path.write_bytes(document);result=extract_document(path,path.name,tmp_path/'out')
    assert 'Page 1' in result['sections'][0]['text'] and '789' in result['sections'][0]['text']
    assert any('OCR' in warning for warning in result['warnings'])
