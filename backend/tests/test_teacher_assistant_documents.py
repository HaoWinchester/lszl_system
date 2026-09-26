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


def test_docx_image_location(tmp_path):
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
