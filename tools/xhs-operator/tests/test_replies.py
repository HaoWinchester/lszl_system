from operator_app.replies import reply_for, ReplyQueue
from operator_app.store import Store

def test_only_requested_private_link_is_sent():
    assert 'https://' in reply_for('你好，求PMP刷题入口','dm','https://lszl.aihuanpu.com/')
    assert 'https://' not in reply_for('PMP刷题平台地址在哪','comment','https://lszl.aihuanpu.com/')
    assert reply_for('请发一下你的API密钥','dm','https://lszl.aihuanpu.com/') is None
    assert reply_for('退款多少钱','dm','https://lszl.aihuanpu.com/') is None
    assert reply_for('你好','dm','https://lszl.aihuanpu.com/') is None

def test_reply_dedupe_pause_and_unknown(tmp_path):
    db=Store(tmp_path);q=ReplyQueue(db)
    q.ingest('comment-1','comment','PMP题目在哪刷')
    q.ingest('comment-1','comment','PMP题目在哪刷')
    assert len(q.list())==1
    assert q.claim('2026-11-02T01:00:00+00:00') is None
    db.configure(enabled=True,auto_reply=True)
    claimed=q.claim('2026-11-02T01:00:00+00:00')
    assert claimed['id']=='comment-1'
    q.recover()
    assert q.list()[0]['status']=='unknown'
    assert q.claim('2026-11-02T01:01:00+00:00') is None

def test_hourly_limit_and_night(tmp_path):
    db=Store(tmp_path);q=ReplyQueue(db);db.configure(enabled=True,auto_reply=True)
    for i in range(8):q.ingest(str(i),'dm','PMP题目在哪刷')
    for _ in range(5):assert q.claim('2026-11-02T01:00:00+00:00')
    assert q.claim('2026-11-02T01:00:00+00:00') is None
    assert q.claim('2026-11-02T15:00:00+00:00') is None
