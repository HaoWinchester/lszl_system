"""Durable workflow state. No credentials or browser cookies belong in this DB."""
import hashlib
import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def due_slot(now, times):
    local = now.astimezone(ZoneInfo('Asia/Shanghai'))
    for value in times:
        h, m = map(int, value.split(':'))
        slot = local.replace(hour=h, minute=m, second=0, microsecond=0)
        if 0 <= (local-slot).total_seconds() < 600:
            return slot.astimezone(timezone.utc).isoformat(timespec='seconds')
    return None


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / 'operator.sqlite3'
        with self.connect() as c:
            c.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, topic TEXT NOT NULL, version INTEGER NOT NULL,
              content TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL, review TEXT, assets TEXT NOT NULL DEFAULT '[]', created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, version INTEGER NOT NULL,
              account TEXT NOT NULL, due TEXT NOT NULL, status TEXT NOT NULL, owner TEXT, lease TEXT, submitted TEXT,
              receipt TEXT, reason TEXT, UNIQUE(draft_id,version,account), UNIQUE(account,due));
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, key TEXT UNIQUE, message TEXT NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channel TEXT NOT NULL, text TEXT NOT NULL,
              reply TEXT, status TEXT NOT NULL, created TEXT NOT NULL);
            ''')
            settings = dict(enabled=False, times=['09:00','20:00'], account='5974425916', account_name='幻谱知习',
                            daily_calls=12, daily_tokens=80000, claude_config=str(Path.home()/'.claude/settings.json'),
                            product_name='幻谱知习', product_url='https://lszl.aihuanpu.com/',
                            product_fact='提供 PMP 题目练习。', adapter_verified=False, auto_reply=False)
            c.execute('INSERT OR IGNORE INTO settings VALUES(1,?)', (json.dumps(settings),))
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        try:
            c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    def settings(self):
        with self.connect() as c:
            return json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])

    def configure(self, **values):
        with self.connect() as c:
            data=json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            data.update(values)
            c.execute('UPDATE settings SET data=? WHERE id=1',(json.dumps(data),))
        return data

    def set_enabled(self, enabled):
        self.configure(enabled=bool(enabled))

    @staticmethod
    def unpack(row):
        if row is None: raise ValueError('记录不存在')
        data=dict(row)
        for key in ('content','review','assets','receipt'):
            if data.get(key) is not None: data[key]=json.loads(data[key])
        return data

    def create_draft(self, content, topic):
        ident=uuid.uuid4().hex
        with self.connect() as c:
            if c.execute('SELECT id FROM drafts WHERE hash=?',(digest(content),)).fetchone():
                raise ValueError('重复内容，未创建草稿')
            c.execute('INSERT INTO drafts(id,topic,version,content,hash,status,created) VALUES(?,?,1,?,?,?,?)',
                      (ident,topic,json.dumps(content,ensure_ascii=False),digest(content),'draft',utcnow()))
        return self.get_draft(ident)

    def get_draft(self, ident):
        with self.connect() as c:
            return self.unpack(c.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone())

    def drafts(self):
        with self.connect() as c:
            return [self.unpack(r) for r in c.execute('SELECT * FROM drafts ORDER BY created DESC, rowid DESC')]

    def edit(self, ident, content):
        with self.connect() as c:
            if c.execute("SELECT id FROM jobs WHERE draft_id=? AND status IN ('submitting','unknown','verifying','published','platform-review')",(ident,)).fetchone():
                raise ValueError('已提交或结果未明的稿件不可改写；请新建稿件')
            if not c.execute('SELECT id FROM drafts WHERE id=?',(ident,)).fetchone(): raise ValueError('记录不存在')
            c.execute("UPDATE drafts SET content=?,hash=?,version=version+1,status='draft',review=NULL,assets='[]' WHERE id=?",
                      (json.dumps(content,ensure_ascii=False),digest(content),ident))
            c.execute("UPDATE jobs SET status='canceled',reason='内容已修改' WHERE draft_id=? AND status IN ('queued','claimed')",(ident,))
        return self.get_draft(ident)

    def review(self, ident, version, result, assets):
        with self.connect() as c:
            row=c.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
            if row is None or row['version']!=version: raise ValueError('稿件已修改，需要重新审核')
            result={**result, 'hash':row['hash'], 'version':version, 'at':utcnow()}
            c.execute('UPDATE drafts SET review=?,assets=?,status=? WHERE id=?',
                      (json.dumps(result,ensure_ascii=False),json.dumps(assets),'ready' if result['passed'] else 'needs-revision',ident))

    def enqueue(self, ident, due):
        parsed=datetime.fromisoformat(due)
        if parsed.tzinfo is None: raise ValueError('排期必须包含时区')
        due=parsed.astimezone(timezone.utc).isoformat(timespec='seconds')
        with self.connect() as c:
            d=self.unpack(c.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone())
            if d['status']!='ready' or not d['review'] or d['review']['hash']!=d['hash']: raise ValueError('稿件未通过当前版本审核')
            settings=json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            existing=c.execute('SELECT * FROM jobs WHERE draft_id=? AND version=? AND account=?',(ident,d['version'],settings['account'])).fetchone()
            try:
                if existing and existing['status'] in {'canceled','missed','blocked'} and not existing['submitted']:
                    c.execute("UPDATE jobs SET due=?,status='queued',reason=NULL,owner=NULL,lease=NULL,receipt=NULL WHERE id=?",(due,existing['id']))
                    return
                c.execute('INSERT INTO jobs(id,draft_id,version,account,due,status) VALUES(?,?,?,?,?,?)',
                          (uuid.uuid4().hex,ident,d['version'],settings['account'],due,'queued'))
            except sqlite3.IntegrityError as e: raise ValueError('稿件或该账号时段已在队列中') from e

    def jobs(self):
        with self.connect() as c: return [self.unpack(r) for r in c.execute('SELECT * FROM jobs ORDER BY due DESC')]

    def claim(self, owner, now=None, draft_id=None):
        now=now or utcnow()
        with self.connect() as c:
            if not json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])['enabled']: return None
            threshold=(datetime.fromisoformat(now)-timedelta(minutes=10)).isoformat(timespec='seconds')
            c.execute("UPDATE jobs SET status='missed',reason='错过排期，未补发' WHERE status='queued' AND due<=?",(threshold,))
            row=c.execute("SELECT * FROM jobs WHERE status='queued' AND due<=? AND (? IS NULL OR draft_id=?) ORDER BY due LIMIT 1",(now,draft_id,draft_id)).fetchone()
            if row is None: return None
            lease=(datetime.fromisoformat(now)+timedelta(minutes=5)).isoformat(timespec='seconds')
            c.execute("UPDATE jobs SET status='claimed',owner=?,lease=? WHERE id=?",(owner,lease,row['id']))
            return self.unpack(c.execute('SELECT * FROM jobs WHERE id=?',(row['id'],)).fetchone())

    def begin_send(self, ident, owner):
        with self.connect() as c:
            cfg=json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            if not cfg['enabled']: return False
            job=c.execute("SELECT * FROM jobs WHERE id=? AND status='claimed' AND owner=?",(ident,owner)).fetchone()
            if not job or job['account']!=cfg['account']: return False
            d=self.unpack(c.execute('SELECT * FROM drafts WHERE id=?',(job['draft_id'],)).fetchone())
            if d['version']!=job['version'] or d['status']!='ready' or d['review']['hash']!=d['hash']: return False
            c.execute("UPDATE jobs SET status='submitting',submitted=? WHERE id=?",(utcnow(),ident))
            return True

    def finish(self, ident, status, receipt=None, reason=None):
        allowed={'published','platform-review','unknown','blocked','canceled','verifying'}
        if status not in allowed: raise ValueError('无效结果状态')
        if status in {'published','platform-review'} and not (receipt and re.fullmatch(r'[a-f0-9]{24}',str(receipt.get('note_id','')))): raise ValueError('缺少笔记标识')
        with self.connect() as c:
            c.execute('UPDATE jobs SET status=?,receipt=?,reason=? WHERE id=?',(status,json.dumps(receipt),reason,ident))

    def recover(self, now=None):
        now=now or utcnow()
        with self.connect() as c:
            c.execute("UPDATE jobs SET status='unknown',reason='执行中断；需要核验，禁止自动重发' WHERE status IN ('submitting','verifying') AND lease<?",(now,))
            c.execute("UPDATE jobs SET status='queued',owner=NULL,lease=NULL WHERE status='claimed' AND lease<?",(now,))

    def notify(self, key, message):
        with self.connect() as c:
            c.execute('INSERT OR IGNORE INTO events(key,message,created) VALUES(?,?,?)',(key,message,utcnow()))

    def events(self):
        with self.connect() as c: return [dict(r) for r in c.execute('SELECT * FROM events ORDER BY id DESC LIMIT 100')]

    def reserve_call(self, max_tokens=6500):
        day=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
        with self.connect() as c:
            cfg=json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            c.execute('INSERT OR IGNORE INTO usage(day) VALUES(?)',(day,))
            r=c.execute('SELECT * FROM usage WHERE day=?',(day,)).fetchone()
            if r['calls']>=cfg['daily_calls'] or r['tokens']+max_tokens>cfg['daily_tokens']: raise ValueError('今日模型预算已用完')
            c.execute('UPDATE usage SET calls=calls+1,tokens=tokens+? WHERE day=?',(max_tokens,day))

    def usage(self):
        with self.connect() as c: return [dict(r) for r in c.execute('SELECT * FROM usage ORDER BY day DESC LIMIT 7')]
