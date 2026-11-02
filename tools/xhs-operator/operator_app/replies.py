"""Bounded, deterministic consultation replies with durable no-retry send state.

Browser adapters provide account-owned related events, never whole private inboxes.
A completed first scan establishes each channel's baseline. Adapters must only mark
complete after their bounded recent window was read successfully. Preparing a reply
must not send; verification must be read-only and distinguish new from old replies.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .store import digest, utcnow

CHANNELS = {'comment', 'dm'}
RELATED = re.compile(r'PMP|刷题|做题|题库|幻谱|知习|练习平台', re.I)
SENSITIVE = re.compile(r'退款|投诉|侵权|价格|多少钱|收费|免费|付费|优惠|商务|合作|答案|密钥|密码|验证码|忽略|指令', re.I)
CONTEXT_FIELDS = {'account', 'owned', 'related', 'note_id', 'thread_id', 'author_id',
                  'fingerprint', 'target', 'comment_id', 'message_id', 'author_name', 'received_at'}


def reply_for(text, channel, url, *, related=False):
    if channel not in CHANNELS or SENSITIVE.search(text):
        return None
    if not (related or RELATED.search(text)):
        return None
    if re.search(r'(?:不用|不必|不要|不需要|别).{0,8}(?:入口|网址|地址|链接)', text):
        return None
    if re.search(r'打不开|无法打开|进不去|无法访问|加载失败|白屏', text):
        return '可以先刷新页面并检查网络；如果仍然打不开，请告诉我页面提示和使用的浏览器，方便继续排查。请不要发送密码或验证码。'
    entry = r'(?:入口|网址|地址|链接)'
    requested = (re.search(r'(?:求|请发|发我|发一下|给我|想要|要个).{0,30}' + entry, text)
                 or re.search(entry + r'.{0,8}(?:在哪|哪里|是什么|有吗|发我|给我|[？?])', text)
                 or re.search(r'(?:在哪|哪里)(?:刷|练|做题)', text)
                 or re.fullmatch(r'\s*' + entry + r'[？?！! ]*', text))
    if requested:
        if channel == 'dm':
            return f'可以在这里练习 PMP 题目：{url} 有使用问题可以继续告诉我。'
        return '可以来幻谱知习做 PMP 题目练习，需要入口的话私信我就好。'
    if re.search(r'怎么用|怎么使用|如何使用|怎么刷|怎么练|如何练', text):
        return '幻谱知习提供 PMP 题目练习。你可以告诉我目前停在哪个页面、想完成哪一步，我会按具体情况说明。'
    if re.search(r'怎么学|怎么复习|备考|学习', text):
        return '可以先理解知识点，再用题目检查思路，做完复盘。具体考试要求以 PMI 官方说明为准。'
    return None


def config_fingerprint(cfg):
    return digest({k: cfg.get(k) for k in ('account', 'account_name', 'product_name', 'product_url', 'product_fact')})


def in_hours(now):
    dt = datetime.fromisoformat(now)
    if dt.tzinfo is None:
        raise ValueError('回复时间必须包含时区')
    return 8 <= dt.astimezone(ZoneInfo('Asia/Shanghai')).hour < 22


class ReplyBlocked(ValueError):
    """Adapter guarantees no external submission occurred before this exception."""


class ReplyQueue:
    def __init__(self, db):
        self.db = db
        with db.connect() as c:
            columns = {r['name'] for r in c.execute('PRAGMA table_info(messages)')}
            for name, definition in [('submitted', 'TEXT'), ('receipt', 'TEXT'),
                                     ('context', "TEXT NOT NULL DEFAULT '{}'"),
                                     ('prepared', 'TEXT'), ('config_hash', 'TEXT'), ('reason', 'TEXT')]:
                if name not in columns:
                    c.execute(f'ALTER TABLE messages ADD COLUMN {name} {definition}')
            c.execute('CREATE TABLE IF NOT EXISTS reply_baselines (account TEXT NOT NULL, channel TEXT NOT NULL, completed TEXT NOT NULL, PRIMARY KEY(account, channel))')

    @staticmethod
    def unpack(row):
        result = dict(row)
        for key in ('context', 'prepared', 'receipt'):
            if result.get(key) is not None:
                result[key] = json.loads(result[key])
        return result

    def ingest(self, ident, channel, text, context=None):
        """Record one event; only scan() can certify a channel's initial baseline."""
        self.scan({'messages': [dict(id=ident, channel=channel, text=text, context=context or {})],
                   'complete_channels': []})

    def scan(self, batch):
        if isinstance(batch, list):
            batch = {'messages': batch, 'complete_channels': []}
        complete = set(batch.get('complete_channels', []))
        if not complete <= CHANNELS:
            raise ValueError('不支持的会话渠道')
        notices = []
        with self.db.connect() as c:
            cfg = json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            baselines = {r['channel'] for r in c.execute('SELECT channel FROM reply_baselines WHERE account=?', (cfg['account'],))}
            for event in batch.get('messages', []):
                ident, channel, text = event['id'], event['channel'], event['text']
                context = event.get('context') or {}
                if channel not in CHANNELS or not isinstance(ident, str) or not ident or not isinstance(text, str):
                    raise ValueError('无效消息标识或渠道')
                if str(context.get('account', '')) != str(cfg['account']):
                    raise ValueError('消息所属账号与当前配置不一致')
                # Incoming text alone cannot establish ownership. A related thread
                # permits short requests without repeating the product's name.
                if context.get('owned') is not True:
                    continue
                if not (context.get('related') is True or RELATED.search(text)):
                    continue
                if not context.get('target') or not context.get('author_id') or not context.get('note_id' if channel == 'comment' else 'thread_id'):
                    raise ValueError('消息缺少可复核的目标上下文')
                context = {k: v for k, v in context.items() if k in CONTEXT_FIELDS}
                context['fingerprint'] = context.get('fingerprint') or digest(text)
                reply = reply_for(text, channel, cfg['product_url'], related=True)
                status = 'seen' if channel not in baselines else ('pending' if reply else 'needs-attention')
                inserted = c.execute('INSERT OR IGNORE INTO messages(id,channel,text,reply,status,created,context,config_hash) VALUES(?,?,?,?,?,?,?,?)',
                                     (ident, channel, text[:600], reply, status, utcnow(), json.dumps(context, ensure_ascii=False), config_fingerprint(cfg))).rowcount
                # A repeat can never replace the original exact target or revive a
                # sent/unknown/historical event. Re-reading is intentionally inert.
                if inserted and status == 'needs-attention':
                    notices.append(ident)
            for channel in complete:
                c.execute('INSERT OR IGNORE INTO reply_baselines VALUES(?,?,?)', (cfg['account'], channel, utcnow()))
        for ident in notices:
            self.db.notify('message-' + ident, '收到需要人工处理的相关咨询，请在互动页查看。')

    def list(self):
        with self.db.connect() as c:
            return [self.unpack(r) for r in c.execute('SELECT * FROM messages ORDER BY created DESC, rowid DESC LIMIT 100')]

    def recover(self):
        with self.db.connect() as c:
            c.execute("UPDATE messages SET status='unknown',reason='执行中断；只读核验，禁止自动重发' WHERE status='sending'")
            c.execute("UPDATE messages SET status='pending' WHERE status='claimed' AND submitted IS NULL")

    @staticmethod
    def enabled(cfg):
        return cfg.get('enabled') and cfg.get('auto_reply')

    @staticmethod
    def under_limit(c, now):
        cutoff = (datetime.fromisoformat(now).astimezone(timezone.utc) - timedelta(hours=1)).isoformat(timespec='seconds')
        return c.execute('SELECT COUNT(*) FROM messages WHERE submitted>?', (cutoff,)).fetchone()[0] < 5

    def claim(self, now=None):
        now = now or utcnow()
        if not in_hours(now):
            return None
        with self.db.connect() as c:
            cfg = json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            if not self.enabled(cfg):
                return None
            c.execute("UPDATE messages SET status='blocked',reason='账号或产品配置已变更，未发送' WHERE status='pending' AND (config_hash IS NULL OR config_hash!=?)", (config_fingerprint(cfg),))
            if not self.under_limit(c, now):
                return None
            row = c.execute("SELECT * FROM messages WHERE status='pending' ORDER BY created,rowid LIMIT 1").fetchone()
            if row is None:
                return None
            c.execute("UPDATE messages SET status='claimed' WHERE id=?", (row['id'],))
            return self.unpack(c.execute('SELECT * FROM messages WHERE id=?', (row['id'],)).fetchone())

    def set_prepared(self, ident, prepared):
        if not isinstance(prepared, dict):
            raise ValueError('回复准备结果必须包含目标和核验基线')
        with self.db.connect() as c:
            c.execute("UPDATE messages SET prepared=? WHERE id=? AND status='claimed'", (json.dumps(prepared, ensure_ascii=False), ident))

    def begin_send(self, ident, now=None):
        now = now or utcnow()
        with self.db.connect() as c:
            cfg = json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            row = c.execute("SELECT * FROM messages WHERE id=? AND status='claimed'", (ident,)).fetchone()
            if row is None:
                return False
            if row['config_hash'] != config_fingerprint(cfg):
                c.execute("UPDATE messages SET status='blocked',reason='账号或产品配置已变更，未发送' WHERE id=?", (ident,))
                return False
            if not self.enabled(cfg) or not in_hours(now) or not self.under_limit(c, now):
                c.execute("UPDATE messages SET status='pending' WHERE id=?", (ident,))
                return False
            submitted = datetime.fromisoformat(now).astimezone(timezone.utc).isoformat(timespec='seconds')
            c.execute("UPDATE messages SET status='sending',submitted=? WHERE id=?", (submitted, ident))
            return True

    def finish(self, ident, receipt=None):
        confirmed = isinstance(receipt, dict) and isinstance(receipt.get('reply_id'), str) and bool(receipt['reply_id'].strip())
        with self.db.connect() as c:
            c.execute("UPDATE messages SET status=?,receipt=?,reason=? WHERE id=? AND status IN ('sending','unknown')",
                      ('sent' if confirmed else 'unknown', json.dumps(receipt, ensure_ascii=False),
                       None if confirmed else '回复结果未知；只读核验，禁止自动重发', ident))
        return confirmed

    def block(self, ident, reason):
        with self.db.connect() as c:
            c.execute("UPDATE messages SET status='blocked',submitted=NULL,reason=? WHERE id=? AND status IN ('claimed','sending')", (reason[:300], ident))

    async def reconcile(self, adapter):
        """No sends, including when auto_reply was disabled by an unknown result."""
        if not hasattr(adapter, 'verify_reply') or not self.db.settings()['enabled']:
            return
        with self.db.connect() as c:
            rows = [self.unpack(r) for r in c.execute("SELECT * FROM messages WHERE status='unknown' ORDER BY created LIMIT 20")]
        for message in rows:
            cfg = self.db.settings()
            if not cfg['enabled']:
                return
            if str(message['context'].get('account')) != str(cfg['account']):
                continue
            try:
                receipt = await adapter.verify_reply(message)
            except Exception:
                continue
            if isinstance(receipt, dict) and receipt.get('reply_id'):
                self.finish(message['id'], receipt)

    async def run(self, adapter):
        if not self.enabled(self.db.settings()) or not in_hours(utcnow()):
            return
        self.scan(await adapter.read_messages())
        for _ in range(5):
            message = self.claim()
            if message is None:
                return
            split = hasattr(adapter, 'prepare_reply') and hasattr(adapter, 'submit_reply')
            if split:
                try:
                    prepared = await adapter.prepare_reply(message)
                    self.set_prepared(message['id'], prepared)
                    message['prepared'] = prepared
                except Exception:
                    self.block(message['id'], '发送前无法复核目标或账号；未提交')
                    self.db.notify('reply-blocked-' + message['id'], '互动目标或账号核验未通过，未发送。')
                    return
            if not self.begin_send(message['id']):
                return
            try:
                receipt = await adapter.submit_reply(message, prepared) if split else await adapter.reply(message)
            except ReplyBlocked:
                self.block(message['id'], '适配器确认提交前已阻止发送')
                return
            except Exception:
                receipt = None
            if not self.finish(message['id'], receipt):
                self.db.notify('reply-' + message['id'], '回复结果未知，已冻结该条，禁止自动重发。')
                self.db.configure(auto_reply=False)
                return
