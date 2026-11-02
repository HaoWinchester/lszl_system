"""Conservative, deterministic responses; untrusted messages never become prompts.

Only minimal related message text is retained, and unknown sends are never retried.
The browser channel must be calibrated separately before auto_reply can be enabled.
"""
import json
import re
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo
from .store import utcnow


def reply_for(text,channel,url):
    if channel not in {'comment','dm'}:return None
    if re.search(r'退款|投诉|侵权|价格|多少钱|收费|商务|合作|答案|密钥|密码|验证码|忽略|指令',text,re.I):return None
    if not re.search(r'PMP|刷题|做题|题库|幻谱|知习|练习平台',text,re.I):return None
    if re.search(r'入口|网址|地址|在哪|哪里|链接|求',text):
        if channel=='dm':return f'可以在这里练习 PMP 题目：{url} 有使用问题可以继续告诉我。'
        return '可以来幻谱知习做 PMP 题目练习，需要入口的话私信我就好。'
    if re.search(r'怎么学|怎么复习|备考|学习',text):
        return '可以先理解知识点，再用题目检查思路；做完对照解析复盘。具体考试要求以 PMI 官方说明为准。'
    return None


class ReplyQueue:
    def __init__(self,db):
        self.db=db
        with db.connect() as c:
            columns={r['name'] for r in c.execute('PRAGMA table_info(messages)')}
            if 'submitted' not in columns:c.execute('ALTER TABLE messages ADD COLUMN submitted TEXT')
            if 'receipt' not in columns:c.execute('ALTER TABLE messages ADD COLUMN receipt TEXT')

    def ingest(self,ident,channel,text):
        if channel not in {'dm','comment'}:raise ValueError('不支持的会话渠道')
        # Adapter is responsible for returning only new, account-owned, related threads.
        if not re.search(r'PMP|刷题|做题|题库|幻谱|知习|练习平台|退款|投诉',text,re.I):return
        reply=reply_for(text,channel,self.db.settings()['product_url'])
        with self.db.connect() as c:
            c.execute('INSERT OR IGNORE INTO messages(id,channel,text,reply,status,created) VALUES(?,?,?,?,?,?)',
                      (ident,channel,text[:600],reply,'pending' if reply else 'needs-attention',utcnow()))
        if not reply:self.db.notify('message-'+ident,'收到需要人工处理的相关咨询，请在互动页查看。')

    def list(self):
        with self.db.connect() as c:return [dict(r) for r in c.execute('SELECT * FROM messages ORDER BY created DESC LIMIT 100')]

    def recover(self):
        with self.db.connect() as c:c.execute("UPDATE messages SET status='unknown' WHERE status='sending'")

    def claim(self,now=None):
        now=now or utcnow();dt=datetime.fromisoformat(now)
        if not 8<=dt.astimezone(ZoneInfo('Asia/Shanghai')).hour<22:return None
        with self.db.connect() as c:
            cfg=json.loads(c.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
            if not(cfg['enabled'] and cfg['auto_reply']):return None
            cutoff=(dt-timedelta(hours=1)).isoformat(timespec='seconds')
            if c.execute('SELECT COUNT(*) FROM messages WHERE submitted>?',(cutoff,)).fetchone()[0]>=5:return None
            row=c.execute("SELECT * FROM messages WHERE status='pending' ORDER BY created LIMIT 1").fetchone()
            if not row:return None
            c.execute("UPDATE messages SET status='sending',submitted=? WHERE id=?",(now,row['id']))
            return dict(row)

    def finish(self,ident,receipt=None):
        confirmed=isinstance(receipt,dict) and bool(receipt.get('reply_id'))
        with self.db.connect() as c:c.execute('UPDATE messages SET status=?,receipt=? WHERE id=?',
                    ('sent' if confirmed else 'unknown',json.dumps(receipt),ident))

    async def run(self,adapter):
        cfg=self.db.settings()
        if not(cfg['enabled'] and cfg['auto_reply']):return
        if not 8<=datetime.now(ZoneInfo('Asia/Shanghai')).hour<22:return
        for m in await adapter.read_messages():self.ingest(m['id'],m['channel'],m['text'])
        for _ in range(5):
            m=self.claim()
            if not m:return
            try:
                # Check again immediately before any externally visible action.
                if not(self.db.settings()['enabled'] and self.db.settings()['auto_reply']):
                    with self.db.connect() as c:c.execute("UPDATE messages SET status='pending',submitted=NULL WHERE id=?",(m['id'],))
                    return
                receipt=await adapter.reply(m)
                self.finish(m['id'],receipt)
            except Exception:
                self.finish(m['id'])
                self.db.notify('reply-'+m['id'],'回复结果未知，已冻结该条，禁止自动重发。')
                self.db.configure(auto_reply=False)
                return
