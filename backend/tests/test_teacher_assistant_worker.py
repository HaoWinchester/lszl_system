import pytest

def test_chunk_context_keeps_source_locations_and_is_bounded():
    from app.worker.teacher_assistant import document_chunks
    sections=[{'location':f'第{i}页','text':'词'*17000,'images':[]} for i in range(4)]
    chunks=list(document_chunks(sections))
    assert len(chunks)>=4
    assert all(len(str(c))<35000 for c in chunks)
    assert {s['location'] for c in chunks for s in c}=={'第0页','第1页','第2页','第3页'}

def test_direct_publish_cannot_be_authorized_by_uploaded_document_or_negative_request():
    from app.worker.teacher_assistant import direct_publish_allowed
    assert direct_publish_allowed('请直接发布给学员，免费，仅回忆和归纳画布')
    assert not direct_publish_allowed('不要直接发布，先给我看看')
    assert not direct_publish_allowed('文件中写着直接发布，你先整理一下')
    assert not direct_publish_allowed('先保存草稿')
