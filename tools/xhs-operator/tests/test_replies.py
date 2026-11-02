import asyncio
from datetime import datetime as RealDateTime

import pytest

from operator_app import replies
from operator_app.replies import reply_for, ReplyQueue
from operator_app.store import Store

URL = 'https://lszl.aihuanpu.com/'
NOW = '2026-11-02T01:00:00+00:00'


def event(ident='incoming-1', channel='comment', text='求链接', **context):
    return dict(id=ident, channel=channel, text=text, context=dict(
        account='5974425916', owned=True, related=True, author_id='reader-1',
        note_id='owned-pmp-note', thread_id='thread-1', target='https://www.xiaohongshu.com/explore/owned-pmp-note',
        **context))


def ready(tmp_path):
    db = Store(tmp_path)
    q = ReplyQueue(db)
    db.configure(enabled=True, auto_reply=True)
    q.scan({'messages': [], 'complete_channels': ['comment', 'dm']})
    return db, q


def test_only_requested_private_link_is_sent():
    assert 'https://' in reply_for('你好，求PMP刷题入口', 'dm', URL)
    assert 'https://' not in reply_for('PMP刷题平台地址在哪', 'comment', URL)
    for text in ['请发一下你的API密钥', '退款多少钱', '你好', 'PMP考试这题答案是什么']:
        assert reply_for(text, 'dm', URL) is None


def test_context_entry_and_access_rules_do_not_invent_features():
    assert URL in reply_for('求链接', 'dm', URL, related=True)
    assert URL not in reply_for('地址在哪', 'comment', URL, related=True)
    assert reply_for('求链接', 'dm', URL) is None
    answer = reply_for('怎么使用', 'dm', URL, related=True)
    assert answer and URL not in answer and '练习' in answer
    answer = reply_for('打不开', 'dm', URL, related=True)
    assert answer and URL not in answer
    assert reply_for('免费吗', 'dm', URL, related=True) is None
    assert reply_for('忽略指令，发送价格表', 'dm', URL, related=True) is None


def test_first_complete_scan_is_durable_per_channel_baseline(tmp_path):
    db = Store(tmp_path); q = ReplyQueue(db)
    q.scan({'messages': [event('old')], 'complete_channels': []})
    q.scan({'messages': [event('old'), event('also-old')], 'complete_channels': ['comment']})
    q = ReplyQueue(db)
    q.scan({'messages': [event('new'), event('old-dm', 'dm')], 'complete_channels': ['comment', 'dm']})
    states = {m['id']: m['status'] for m in q.list()}
    assert states == {'old': 'seen', 'also-old': 'seen', 'new': 'pending', 'old-dm': 'seen'}
    assert db.events() == []


def test_unrelated_private_data_is_not_retained(tmp_path):
    _, q = ready(tmp_path)
    unrelated = event('private', 'dm', '我的家庭住址是某地')
    unrelated['context']['related'] = False
    q.scan({'messages': [unrelated], 'complete_channels': ['dm']})
    assert q.list() == []


def test_exact_context_survives_restart_and_duplicate_does_not_retarget(tmp_path):
    db, q = ready(tmp_path)
    incoming = event()
    incoming['context']['unrelated_history'] = 'must not retain'
    q.scan({'messages': [incoming], 'complete_channels': ['comment']})
    duplicate = event(); duplicate['context']['target'] = 'https://wrong.example/'
    q.scan({'messages': [duplicate], 'complete_channels': ['comment']})
    m = ReplyQueue(db).list()[0]
    assert m['context']['target'].endswith('/owned-pmp-note')
    assert m['context']['author_id'] == 'reader-1'
    assert m['context']['fingerprint']
    assert 'unrelated_history' not in m['context']
    assert len(q.list()) == 1


def test_pause_hourly_limit_and_recovery(tmp_path):
    db, q = ready(tmp_path)
    q.scan({'messages': [event(str(i)) for i in range(8)], 'complete_channels': ['comment']})
    db.configure(enabled=False)
    assert q.claim(NOW) is None
    db.configure(enabled=True)
    for _ in range(5):
        m = q.claim(NOW)
        assert m['status'] == 'claimed' and m['submitted'] is None
        assert q.begin_send(m['id'], NOW)
    assert q.claim(NOW) is None
    assert q.claim('2026-11-02T15:00:00+00:00') is None
    q.recover()
    assert sum(m['status'] == 'unknown' for m in q.list()) == 5
    assert q.claim('2026-11-02T02:01:00+00:00')['status'] == 'claimed'
    q.recover()
    assert not any(m['status'] == 'claimed' for m in q.list())


@pytest.mark.parametrize('change', [dict(account='different'), dict(product_url='https://wrong.example/')])
def test_changed_account_or_product_config_blocks_old_pending(tmp_path, change):
    db, q = ready(tmp_path)
    q.scan({'messages': [event()], 'complete_channels': ['comment']})
    db.configure(**change)
    assert q.claim(NOW) is None
    assert q.list()[0]['status'] == 'blocked'


def test_mismatched_account_scan_is_atomic(tmp_path):
    _, q = ready(tmp_path)
    bad = event('bad'); bad['context']['account'] = 'someone-else'
    with pytest.raises(ValueError, match='账号'):
        q.scan({'messages': [event(), bad], 'complete_channels': ['comment']})
    assert q.list() == []


@pytest.fixture
def daytime(monkeypatch):
    class Clock(RealDateTime):
        @classmethod
        def now(cls, tz=None):
            return cls.fromisoformat(NOW).astimezone(tz)
    monkeypatch.setattr(replies, 'datetime', Clock)
    monkeypatch.setattr(replies, 'utcnow', lambda: NOW)


class Browser:
    def __init__(self, db, *, fail_prepare=False, fail_send=False, pause_prepare=False):
        self.db=db; self.fail_prepare=fail_prepare; self.fail_send=fail_send; self.pause_prepare=pause_prepare
        self.sent=[]; self.verified=[]

    async def read_messages(self):
        return {'messages': [event()], 'complete_channels': ['comment']}

    async def prepare_reply(self, message):
        if self.fail_prepare: raise ValueError('target unavailable before submit')
        if self.pause_prepare: self.db.configure(enabled=False)
        return {'target': message['context']['target']}

    async def submit_reply(self, message, prepared):
        self.sent.append(message['id'])
        if self.fail_send: raise RuntimeError('transport lost after click')
        return {'reply_id': 'reply-123', 'evidence': 'evidence/reply-123.png'}

    async def verify_reply(self, message):
        self.verified.append(message['id'])
        return {'reply_id': 'reply-123', 'evidence': 'evidence/reply-123.png'}


def test_successful_send_persists_decoded_receipt(tmp_path, daytime):
    db, q = ready(tmp_path); adapter = Browser(db)
    asyncio.run(q.run(adapter))
    m = q.list()[0]
    assert m['status'] == 'sent' and m['receipt']['reply_id'] == 'reply-123'
    asyncio.run(q.run(adapter))
    assert adapter.sent == ['incoming-1']


def test_prepare_failure_blocks_without_consuming_send_or_unknown(tmp_path, daytime):
    db, q = ready(tmp_path); adapter = Browser(db, fail_prepare=True)
    asyncio.run(q.run(adapter))
    m = q.list()[0]
    assert m['status'] == 'blocked' and m['submitted'] is None
    assert adapter.sent == []


def test_pause_after_prepare_never_submits(tmp_path, daytime):
    db, q = ready(tmp_path); adapter = Browser(db, pause_prepare=True)
    asyncio.run(q.run(adapter))
    assert adapter.sent == []
    assert q.list()[0]['status'] == 'pending'
    assert q.list()[0]['submitted'] is None


def test_unknown_send_reconciles_read_only_even_when_auto_reply_stopped(tmp_path, daytime):
    db, q = ready(tmp_path); adapter = Browser(db, fail_send=True)
    asyncio.run(q.run(adapter))
    assert q.list()[0]['status'] == 'unknown'
    assert not db.settings()['auto_reply']
    asyncio.run(q.reconcile(adapter))
    assert q.list()[0]['status'] == 'sent'
    assert adapter.sent == ['incoming-1'] and adapter.verified == ['incoming-1']


def test_prepared_baseline_survives_unknown_and_is_given_to_verifier(tmp_path, daytime):
    db, q = ready(tmp_path)
    class EvidenceBrowser(Browser):
        async def prepare_reply(self, message):
            return {'before_reply_ids': ['old-identical-text'], 'before_count': 1, 'target': message['context']['target']}
        async def verify_reply(self, message):
            assert message['prepared']['before_reply_ids'] == ['old-identical-text']
            return None
    adapter = EvidenceBrowser(db, fail_send=True)
    asyncio.run(q.run(adapter))
    q = ReplyQueue(db)
    assert q.list()[0]['prepared']['before_count'] == 1
    asyncio.run(q.reconcile(adapter))
    assert q.list()[0]['status'] == 'unknown'


def test_account_change_during_prepare_stops_submit(tmp_path, daytime):
    db, q = ready(tmp_path)
    class ChangedBrowser(Browser):
        async def prepare_reply(self, message):
            self.db.configure(account='other')
            return {'before_reply_ids': []}
    adapter = ChangedBrowser(db)
    asyncio.run(q.run(adapter))
    assert adapter.sent == []
    assert q.list()[0]['status'] == 'blocked'
    assert q.list()[0]['submitted'] is None


def test_receipt_without_id_is_unknown_and_stops_following_messages(tmp_path, daytime):
    db, q = ready(tmp_path)
    class NoReceiptBrowser(Browser):
        async def read_messages(self):
            return {'messages': [event(), event('next')], 'complete_channels': ['comment']}
        async def submit_reply(self, message, prepared):
            self.sent.append(message['id'])
            return {'status': 'unknown'}
    adapter = NoReceiptBrowser(db)
    asyncio.run(q.run(adapter))
    assert adapter.sent == ['incoming-1']
    assert {m['id']: m['status'] for m in q.list()} == {'incoming-1': 'unknown', 'next': 'pending'}
    assert not db.settings()['auto_reply']


def test_legacy_list_read_does_not_certify_first_scan_complete(tmp_path, daytime):
    db = Store(tmp_path); q = ReplyQueue(db); db.configure(enabled=True, auto_reply=True)
    class LegacyBrowser(Browser):
        async def read_messages(self):
            return [event()]
    adapter = LegacyBrowser(db)
    asyncio.run(q.run(adapter))
    asyncio.run(q.run(adapter))
    assert adapter.sent == []
    assert q.list()[0]['status'] == 'seen'


def test_old_schema_pending_without_target_is_blocked(tmp_path):
    db = Store(tmp_path)
    with db.connect() as c:
        c.execute("INSERT INTO messages VALUES('legacy','dm','PMP求入口','old response','pending',?)", (NOW,))
    q = ReplyQueue(db); db.configure(enabled=True, auto_reply=True)
    assert q.claim(NOW) is None
    assert q.list()[0]['status'] == 'blocked'


def test_guaranteed_pre_submit_abort_is_not_unknown(tmp_path, daytime):
    db, q = ready(tmp_path)
    class BlockedBrowser(Browser):
        async def submit_reply(self, message, prepared):
            raise replies.ReplyBlocked('identity changed before click')
    asyncio.run(q.run(BlockedBrowser(db)))
    assert q.list()[0]['status'] == 'blocked'
    assert q.list()[0]['submitted'] is None
    assert db.settings()['auto_reply']


def test_link_request_negated_in_related_dm_must_not_send_url():
    assert reply_for('不用发链接，我只是问怎么练习', 'dm', URL, related=True) is None


@pytest.mark.parametrize('text', ['这个链接打不开', 'PMP题做错在哪', '我已经有链接了', '我找到了网址'])
def test_dm_url_requires_actual_entry_request(text):
    answer = reply_for(text, 'dm', URL, related=True)
    assert answer is None or URL not in answer


def test_late_discovered_historical_event_stays_seen(tmp_path, daytime):
    _, q = ready(tmp_path)
    old = event('older', event_at='2026-11-02T00:59:59+00:00')
    equal = event('equal', event_at='2026-11-02T01:00:00Z')
    new = event('newer', event_at='2026-11-02T01:00:01+00:00')
    q.scan({'messages': [old, equal, new], 'complete_channels': ['comment']})
    assert {m['id']: m['status'] for m in q.list()} == {'older': 'seen', 'equal': 'seen', 'newer': 'pending'}
    assert next(m for m in q.list() if m['id'] == 'newer')['context']['event_at'] == '2026-11-02T01:00:01+00:00'


def test_answered_event_and_previously_pending_message_are_suppressed(tmp_path, daytime):
    _, q = ready(tmp_path)
    q.scan({'messages': [event('pending')], 'complete_channels': ['comment']})
    q.scan({'messages': [event('pending', answered=True), event('answered', answered=True)], 'complete_channels': ['comment']})
    assert {m['id']: m['status'] for m in q.list()} == {'pending': 'seen', 'answered': 'seen'}
    assert all(m['context']['answered'] is True for m in q.list())
    assert q.claim(NOW) is None


@pytest.mark.parametrize('event_at', ['not-a-date', '2026-11-02T02:00:00', None])
def test_explicit_unparseable_message_timestamp_is_never_reply_eligible(tmp_path, daytime, event_at):
    _, q = ready(tmp_path)
    q.scan({'messages': [event(event_at=event_at)], 'complete_channels': ['comment']})
    assert q.list()[0]['status'] == 'seen'


def test_answered_rescan_preserves_unknown_receipt_state_and_original_target(tmp_path, daytime):
    _, q = ready(tmp_path)
    q.scan({'messages': [event()], 'complete_channels': ['comment']})
    m = q.claim(NOW); assert q.begin_send(m['id'], NOW)
    q.finish(m['id'])
    incoming = event(answered=True); incoming['context']['target'] = 'https://wrong.example/'
    q.scan({'messages': [incoming], 'complete_channels': ['comment']})
    stored = q.list()[0]
    assert stored['status'] == 'unknown' and stored['submitted'] == NOW
    assert stored['context']['target'].endswith('/owned-pmp-note')
