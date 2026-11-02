import copy
from datetime import datetime, timezone
from types import SimpleNamespace
import pytest
from operator_app.community import Community, platform_time, profile_id, note_id, latest_incoming
from operator_app.replies import ReplyBlocked, ReplyQueue
from operator_app.store import Store, digest

NOW=datetime(2026,11,2,8,30,tzinfo=timezone.utc)


def test_visible_dates_are_conservative_and_unknown_never_fresh():
    assert platform_time('9月9日 11:50',NOW)=='2026-09-09T11:50:00+08:00'
    assert platform_time('2025年11月28日',NOW)=='2025-11-28T00:00:00+08:00'
    assert platform_time('昨天 09:01',NOW)=='2026-11-01T09:01:00+08:00'
    assert platform_time('12-28',NOW)=='2025-12-28T00:00:00+08:00'
    assert platform_time('刚刚',NOW)=='2026-11-02T16:29:00+08:00'
    assert platform_time('3分钟前',NOW)=='2026-11-02T16:26:00+08:00'
    assert platform_time('发送失败',NOW) is None
    assert platform_time('99-99',NOW) is None
    assert platform_time('17:00',NOW) is None


def test_platform_links_cannot_escape_expected_hosts_or_ids():
    ident='a'*24
    assert note_id('/search_result/'+ident+'?xsec_source=pc_search')==ident
    assert note_id('/user/profile/'+'b'*24+'/'+ident)==ident
    assert profile_id('/user/profile/'+ident)==ident
    for url in ['https://evil.invalid/explore/'+ident,'http://www.xiaohongshu.com/explore/'+ident,'/explore/invalid']:
        with pytest.raises(ValueError):note_id(url)
    with pytest.raises(ValueError):profile_id('https://www.xiaohongshu.com.evil.invalid/user/profile/'+ident)


def test_new_message_or_manual_reply_cancels_prepared_dm():
    incoming={'id':'incoming-1','text':'PMP入口在哪？','outgoing':False}
    assert latest_incoming([incoming],incoming['id'],incoming['text'])==incoming
    for rows in [[],[incoming,{'id':'reply-1','text':'已回复','outgoing':True}],
                 [incoming,{'id':'incoming-2','text':'不用了','outgoing':False}]]:
        with pytest.raises(ReplyBlocked):latest_incoming(rows,incoming['id'],incoming['text'])
    with pytest.raises(ReplyBlocked):latest_incoming([incoming],incoming['id'],'变化后的原文')


# The UI boundary is replaced by a bounded rendered snapshot. Community's real
# dm_rows(), target(), prepare(), and verify() still perform their own checks.
THREAD = 'c' * 24
TARGET = 'https://www.xiaohongshu.com/chat/' + THREAD
DM_PREFIX = 'a' * 24 + '.' + THREAD + '.'


def dm_row(ident, text, *, outgoing=False):
    return {'id': DM_PREFIX + ident, 'text': text, 'incoming': not outgoing,
            'outgoing': outgoing, 'labels': ['2026年11月2日 09:01']}


def dm_message():
    return {'id': 'dm:incoming-1', 'channel': 'dm', 'text': 'PMP入口在哪？',
            'reply': '这是 PMP 练习入口。',
            'context': {'account': '5974425916', 'owned': True, 'related': True,
                        'thread_id': THREAD, 'message_id': DM_PREFIX + 'incoming-1',
                        'author_id': THREAD, 'target': TARGET},
            'prepared': {'before_ids': [DM_PREFIX + 'incoming-1'], 'target': TARGET,
                         'fingerprint': digest('PMP入口在哪？'), 'account': '5974425916',
                         'prepared_at': '2026-11-02T01:01:30+00:00'}}


class RenderedDmPage:
    def __init__(self):
        self.rows = []
        self.url = TARGET

    def locator(self, selector):
        if selector != '.chat-item[data-message-id]':
            raise AssertionError('unexpected page access: ' + selector)
        return self

    async def evaluate_all(self, script):
        return copy.deepcopy(self.rows)


@pytest.fixture
def community_page(tmp_path, monkeypatch):
    community = Community(SimpleNamespace(db=Store(tmp_path)))
    page = RenderedDmPage()

    async def identity():
        community.owner = 'a' * 24
        return page

    async def conversation(ident):
        if ident != THREAD:
            raise ReplyBlocked('会话目标不一致')
        return page

    monkeypatch.setattr(community, 'identity', identity)
    monkeypatch.setattr(community, 'conversation', conversation)
    return community, page


@pytest.mark.asyncio
async def test_verify_ignores_old_identical_outgoing_before_incoming(community_page):
    community, page = community_page; message = dm_message()
    # The older message was absent from the original bounded DOM snapshot.
    page.rows = [dm_row('old-outgoing', message['reply'], outgoing=True),
                 dm_row('incoming-1', message['text'])]
    assert await community.verify(message) is None


@pytest.mark.asyncio
async def test_verify_confirms_one_new_own_reply_after_exact_incoming(community_page):
    community, page = community_page; message = dm_message()
    page.rows = [dm_row('incoming-1', message['text']),
                 dm_row('other-incoming', message['reply']),
                 dm_row('new-outgoing', message['reply'], outgoing=True)]
    receipt = await community.verify(message)
    assert receipt['reply_id'] == DM_PREFIX + 'new-outgoing'
    assert receipt['target'] == TARGET
    assert datetime.fromisoformat(receipt['verified_at']).tzinfo is not None


@pytest.mark.asyncio
@pytest.mark.parametrize('incoming', [None, dm_row('incoming-1', '不同的原文'),
                                     dm_row('incoming-1', 'PMP入口在哪？', outgoing=True)])
async def test_verify_requires_original_incoming_id_text_and_direction(community_page, incoming):
    community, page = community_page; message = dm_message()
    page.rows = ([incoming] if incoming else []) + [dm_row('new-outgoing', message['reply'], outgoing=True)]
    assert await community.verify(message) is None


@pytest.mark.asyncio
async def test_verify_rejects_two_matching_new_outgoing_replies(community_page):
    community, page = community_page; message = dm_message()
    page.rows = [dm_row('incoming-1', message['text']),
                 dm_row('reply-a', message['reply'], outgoing=True),
                 dm_row('reply-b', message['reply'], outgoing=True)]
    assert await community.verify(message) is None


@pytest.mark.asyncio
async def test_verify_rejects_reply_already_present_in_prepared_snapshot(community_page):
    community, page = community_page; message = dm_message()
    message['prepared']['before_ids'].append(DM_PREFIX + 'existing-outgoing')
    page.rows = [dm_row('incoming-1', message['text']),
                 dm_row('existing-outgoing', message['reply'], outgoing=True)]
    assert await community.verify(message) is None


@pytest.mark.asyncio
@pytest.mark.parametrize('prepared', [None, {}, {'before_ids': [], 'target': TARGET},
                                      {'before_ids': [DM_PREFIX + 'incoming-1'], 'target': TARGET + '-wrong'}])
async def test_verify_rejects_missing_baseline_or_mismatched_target(community_page, prepared):
    community, page = community_page; message = dm_message(); message['prepared'] = prepared
    page.rows = [dm_row('incoming-1', message['text']),
                 dm_row('new-outgoing', message['reply'], outgoing=True)]
    assert await community.verify(message) is None


@pytest.mark.asyncio
async def test_prepare_binds_current_target_text_and_all_visible_ids(community_page):
    community, page = community_page; message = dm_message()
    page.rows = [dm_row('older', '上一条回复', outgoing=True), dm_row('incoming-1', message['text'])]
    prepared = await community.prepare(message)
    assert prepared['before_ids'] == [DM_PREFIX + 'older', DM_PREFIX + 'incoming-1']
    assert prepared['target'] == TARGET
    assert prepared['fingerprint'] == '111ef8608c6bc1df628a6e5ee833138a0b3020b323bdd5b490e8f381b2c0ea14'
    assert prepared['account'] == '5974425916'
    assert datetime.fromisoformat(prepared['prepared_at']).tzinfo is not None


@pytest.mark.asyncio
@pytest.mark.parametrize('later', [dm_row('human-reply', '已人工处理', outgoing=True),
                                   dm_row('new-question', '先不用了')])
async def test_prepare_rejects_superseded_incoming_before_send(community_page, later):
    community, page = community_page; message = dm_message()
    page.rows = [dm_row('incoming-1', message['text']), later]
    with pytest.raises(ReplyBlocked):
        await community.prepare(message)


@pytest.mark.asyncio
@pytest.mark.parametrize('change', [{'account': 'other-account'}, {'thread_id': 'd' * 24}])
async def test_prepare_rejects_wrong_account_or_conversation(community_page, change):
    community, page = community_page; message = dm_message(); message['context'].update(change)
    page.rows = [dm_row('incoming-1', message['text'])]
    with pytest.raises(ReplyBlocked):
        await community.prepare(message)


@pytest.mark.asyncio
@pytest.mark.parametrize('change', [{'target': TARGET + '-wrong'}, {'fingerprint': 'wrong-text-hash'}])
async def test_submit_rejects_changed_preparation_before_touching_editor(community_page, change):
    community, page = community_page; message = dm_message()
    prepared = {**message['prepared'], **change}
    with pytest.raises(ReplyBlocked, match='准备证据'):
        await community.submit(message, prepared)


@pytest.mark.asyncio
async def test_verify_rejects_rendered_message_from_another_account_pair(community_page):
    community, page = community_page; message = dm_message()
    wrong = dm_row('wrong-conversation', message['reply'], outgoing=True)
    wrong['id'] = 'b' * 24 + '.' + THREAD + '.wrong-conversation'
    page.rows = [dm_row('incoming-1', message['text']), wrong]
    with pytest.raises(ReplyBlocked, match='消息标识'):
        await community.verify(message)

@pytest.mark.asyncio
async def test_real_dom_empty_comments_and_folded_reply_guard(tmp_path):
    """Network-isolated fixtures exercise observed nested text and thread structure."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from playwright.async_api import async_playwright
    from operator_app.community import Community
    from operator_app.store import Store
    owner='a'*24;note='b'*24;comment='c'*24;peer='d'*24
    html=f'''<meta charset="utf-8"><div data-logged="1"><a href="/user/profile/{owner}">我</a>
      <div id="noteContainer"><div class="author-container"><a href="/user/profile/{owner}">作者</a></div>
      <div class="note-content">PMP 知识讲解</div><div class="comments-el">
      <div>这是一片荒地<span>点击评论</span></div></div></div></div>'''
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        try:
            page=await browser.new_page()
            await page.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body=html))
            community=Community(SimpleNamespace(db=Store(tmp_path)));community.owner=owner
            community.page=AsyncMock(return_value=page)
            _,root,ident=await community.note('https://www.xiaohongshu.com/explore/'+note)
            assert ident==note and await community.comment_rows(root)==[]
            # The reply control outside the child item still belongs to its root thread.
            await page.set_content(f'''<div id="noteContainer"><div class="parent-comment">
              <div class="comment-item" id="comment-{comment}"><a class="name" data-user-id="{peer}">读者</a>
              <div class="content">求 PMP 链接</div><div class="date"><span>11-02</span></div></div>
              <div>展开 3 条回复</div></div></div>''')
            rows=await community.comment_rows(page.locator('#noteContainer'))
            assert rows[0]['folded'] is True
            assert rows[0]['id']==rows[0]['parent']==comment
            assert rows[0]['author']==peer
        finally:await browser.close()


@pytest.mark.asyncio
async def test_dms_uses_persisted_owned_comment_context_without_opening_unrelated_inbox(tmp_path, monkeypatch):
    db = Store(tmp_path); queue = ReplyQueue(db)
    account = db.settings()['account']
    other_account_peer = 'b' * 24
    unrelated_peer = 'd' * 24

    def remember_comment(ident, author):
        queue.ingest(ident, 'comment', 'PMP题库求链接', {
            'account': db.settings()['account'], 'owned': True, 'related': True,
            'author_id': author, 'note_id': 'e' * 24,
            'target': 'https://www.xiaohongshu.com/explore/' + 'e' * 24})

    remember_comment('comment:owned', THREAD)
    db.configure(account='other-account')
    remember_comment('comment:other-account', other_account_peer)
    db.configure(account=account)
    community = Community(SimpleNamespace(db=db))
    opened = []
    previews = [
        {'id': THREAD, 'name': '相关评论用户', 'text': '求链接'},
        {'id': unrelated_peer, 'name': '无关用户', 'text': '今天晚饭吃什么'},
        {'id': other_account_peer, 'name': '另一账号的评论用户', 'text': '求链接'},
    ]

    class InboxPage:
        async def goto(self, url, **kwargs):
            self.url = url

        def locator(self, selector):
            if selector not in {'.xhs-im-conv-list', '.xhs-im-conv-item[data-conv-kind="c2c"]'}:
                raise AssertionError('unexpected inbox selector: ' + selector)
            return self

        async def wait_for(self, **kwargs):
            return None

        async def evaluate_all(self, script):
            return copy.deepcopy(previews)

    page = InboxPage()

    async def main_page():
        return page

    async def same_account(current):
        return None

    async def conversation(ident):
        opened.append(ident)
        if ident != THREAD:
            raise AssertionError('unrelated private conversation was opened')
        return SimpleNamespace(peer=ident)

    async def rows(current):
        return [{'id': DM_PREFIX + 'followup', 'incoming': True, 'outgoing': False,
                 'text': '求链接', 'event_at': '2026-11-02T01:01:00+00:00'}]

    monkeypatch.setattr(community, 'page', main_page)
    monkeypatch.setattr(community, 'same_account', same_account)
    monkeypatch.setattr(community, 'conversation', conversation)
    monkeypatch.setattr(community, 'dm_rows', rows)
    # This executes real Store.settings()/connect() calls: nesting settings() in
    # the BEGIN IMMEDIATE transaction regresses to an actual SQLite lock error.
    events = await community.dms()
    assert opened == [THREAD]
    assert len(events) == 1 and events[0]['text'] == '求链接'
    assert events[0]['context']['author_id'] == THREAD
    assert events[0]['context']['related'] is True
    assert events[0]['context']['account'] == account
    queue.scan({'messages': events, 'complete_channels': ['dm']})
    stored = [m for m in queue.list() if m['channel'] == 'dm']
    assert len(stored) == 1 and stored[0]['context']['thread_id'] == THREAD
