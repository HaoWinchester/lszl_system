from copy import deepcopy
from io import BytesIO
import base64
from uuid import uuid4
from PIL import Image
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.question import QuestionBank
from app.core.security import hash_password
from app.services import paper_release_service
from test_mixed_question_types import MATCHING
PASSWORD = 'mixed-question-test'
async def seed_users():
    suffix = uuid4().hex[:10]
    ids = {key: f'mixed-{key}-{suffix}' for key in ['teacher','student','other','bank','paper']}
    async with AsyncSessionLocal() as db:
        for key, role in [('teacher','teacher'),('student','student'),('other','teacher')]:
            db.add(User(username=ids[key], role=role, status='active', password_hash=hash_password(PASSWORD)))
        await db.flush()
        db.add(QuestionBank(id=ids["bank"], owner_id=ids["teacher"], name="混合题库", subject="PMP"))
        await db.commit()
    return ids

def login(client, username):
    response = client.post('/api/v1/auth/login', json={'username': username, 'password': PASSWORD})
    assert response.status_code == 200, response.text

def png():
    stream = BytesIO()
    Image.new('RGB', (2, 2), 'blue').save(stream, format='PNG')
    return {'filename': 'blue.png', 'mimeType': 'image/png', 'dataBase64': base64.b64encode(stream.getvalue()).decode(), 'alt': '蓝色方块'}

def questions(ids, material=None, asset=None):
    result = []
    for index in range(7):
        q = {'id': f"q-{ids['paper']}-{index}", 'bankId': ids['bank'], 'type': 'single_choice', 'title': f'题目 {index}', 'stemParts': [{'text': f'题干 {index}'}], 'options': [{'id':'A','text':'甲','correct':True},{'id':'B','text':'乙','correct':False}], 'correctAnswer':'A', 'analysis':'解析'}
        if index == 1:
            q.update(type='multiple_choice', options=[{'id':x,'text':x} for x in 'ABC'], correctAnswer=None, correctOptionIds=['A','C'])
        if index == 2:
            q.update(deepcopy(MATCHING))
            q.update(options=[], correctAnswer=None)
            q['id'] = f"q-{ids['paper']}-{index}"
        if asset and index == 3:
            q['images'] = [asset]
        if material and index >= 4:
            q.update(material=deepcopy(material), caseGroup={'id':material['id'], 'order':index-3, 'total':3})
        result.append(q)
    return result

async def publish(ids, qs):
    async with AsyncSessionLocal() as db:
        teacher = await db.get(User, ids['teacher'])
        refs = [{'bankId':ids['bank'],'questionId':q['id'],'question':q} for q in qs]
        release = await paper_release_service.publish_from_payload(db, teacher, {'releaseId':'rel-'+uuid4().hex, 'publishedBy':ids['teacher'], 'paperId':ids['paper'],'name':'混合七题','subject':'PMP','paperType':'mixed','enabledModes':['practice_mode'],'allowedRoles':['student'], 'questions':refs, 'questionSnapshots':refs})
        return release.id
