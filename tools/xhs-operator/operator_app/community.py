"""Main-site adapter calibrated against visible Xiaohongshu pages on 2026-11-02.

Only rendered DOM and normal UI navigation. No private APIs or account tokens.
The browser owner serializes these operations with its existing adapter lock.
"""
import re
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, quote
from zoneinfo import ZoneInfo

from .replies import RELATED, ReplyBlocked
from .store import digest, utcnow

BASE = 'https://www.xiaohongshu.com'
HEX = re.compile(r'^[a-f0-9]{24}$')


def platform_time(label, now=None):
    """Convert visible dates conservatively; unknown labels must never authorize sends."""
    now = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo('Asia/Shanghai'))
    label = label.strip()
    if label == '刚刚': return (now-timedelta(minutes=1)).isoformat()
    m = re.fullmatch(r'(\d+)(分钟|小时|天)前', label)
    if m:
        delta = timedelta(**{ {'分钟':'minutes','小时':'hours','天':'days'}[m[2]]: int(m[1])+1 })
        return (now-delta).isoformat()
    label = re.sub(r'^昨天\s*', (now-timedelta(days=1)).strftime('%Y-%m-%d '), label)
    label = re.sub(r'^今天\s*', now.strftime('%Y-%m-%d '), label)
    label = label.replace('年','-').replace('月','-').replace('日','').strip()
    try:
        if re.fullmatch(r'\d{1,2}:\d{2}',label): label = now.strftime('%Y-%m-%d ')+label
        if re.fullmatch(r'\d{1,2}-\d{1,2}(?: \d{1,2}:\d{2})?',label):
            dt = datetime.strptime(f'{now.year}-{label}', '%Y-%m-%d %H:%M' if ':' in label else '%Y-%m-%d').replace(tzinfo=now.tzinfo)
            if dt.date() > now.date(): dt=dt.replace(year=dt.year-1)
        else:
            dt=datetime.strptime(label, '%Y-%m-%d %H:%M' if ':' in label else '%Y-%m-%d').replace(tzinfo=now.tzinfo)
        return dt.isoformat() if dt <= now+timedelta(minutes=1) else None
    except (ValueError, OverflowError): return None


def profile_id(href):
    u=urlparse(href if href.startswith('http') else BASE+href)
    m=re.fullmatch(r'/user/profile/([a-f0-9]{24})',u.path)
    if u.scheme!='https' or u.netloc!='www.xiaohongshu.com' or not m:
        raise ValueError('账号主页链接无法核验')
    return m[1]


def note_id(href):
    u=urlparse(href if href.startswith('http') else BASE+href)
    m=re.fullmatch(r'/(?:explore|search_result)/([a-f0-9]{24})|/user/profile/[a-f0-9]{24}/([a-f0-9]{24})',u.path)
    if u.scheme!='https' or u.netloc!='www.xiaohongshu.com' or not m:
        raise ValueError('笔记链接无法核验')
    return m[1] or m[2]


def latest_incoming(rows, ident, expected_text):
    """Only the unchanged last message is eligible, including human-reply races."""
    if not rows or rows[-1]['id']!=ident or rows[-1]['outgoing'] or rows[-1]['text']!=expected_text:
        raise ReplyBlocked('会话已更新或已经回复，未发送')
    return rows[-1]


class UnrelatedNote(ReplyBlocked):
    pass


class Community:
    def __init__(self, adapter):
        self.adapter=adapter; self.db=adapter.db; self.owner=None; self._page=None

    async def page(self):
        await self.adapter.open()
        if self._page is None or self._page.is_closed():
            self._page=next((p for p in self.adapter.context.pages if urlparse(p.url).netloc=='www.xiaohongshu.com'),None)
            if self._page is None:self._page=await self.adapter.context.new_page()
        return self._page

    async def identity(self):
        self.adapter.community_status.update(identity_verified=False)
        page=await self.page()
        if urlparse(page.url).netloc!='www.xiaohongshu.com':await page.goto(BASE,wait_until='domcontentloaded')
        me=page.get_by_role('link',name='我',exact=True)
        await me.wait_for(state='visible',timeout=15000)
        owner=profile_id(await me.get_attribute('href'))
        await page.goto(BASE+'/user/profile/'+owner,wait_until='domcontentloaded')
        label=page.get_by_text(re.compile(r'小红书号：\s*\d+'))
        await label.first.wait_for(state='visible',timeout=15000)
        found=re.search(r'小红书号：\s*(\d+)',await label.first.inner_text())
        if not found or found[1]!=str(self.db.settings()['account']):
            self.adapter.community_status={'identity_verified':False,'reason':'主站账号与绑定账号不一致','channels':[]}
            raise ValueError('主站账号与绑定账号不一致')
        self.owner=owner
        self.adapter.community_status.update(identity_verified=True,account=found[1])
        if not self.adapter.community_status.get('channels') and not self.adapter.community_status.get('scope'):
            self.adapter.community_status['reason']='主站账号已核对'
        return page

    async def same_account(self,page):
        me=page.get_by_role('link',name='我',exact=True)
        if await me.count()!=1 or profile_id(await me.get_attribute('href'))!=self.owner:
            raise ReplyBlocked('主站账号已变化，停止操作')
        if not await page.locator('[data-logged="1"]').count():raise ReplyBlocked('主站登录已失效')

    async def note(self,href):
        ident=note_id(href);page=await self.page()
        await page.goto(href if href.startswith('https://') else BASE+href,wait_until='domcontentloaded')
        root=page.locator('#noteContainer')
        await root.wait_for(state='visible',timeout=15000)
        await self.same_account(page)
        author=root.locator('.author-container a[href*="/user/profile/"]')
        owners={profile_id(h) for h in await author.evaluate_all('(els)=>els.map(e=>e.getAttribute("href"))')}
        if owners!={self.owner}:raise ReplyBlocked('笔记不属于当前账号')
        title=await root.locator('.note-content').inner_text()
        if not RELATED.search(title):raise UnrelatedNote('笔记不在 PMP 运营范围')
        await root.locator('.comments-container .total:visible').or_(root.locator('.comments-el').filter(has_text='这是一片荒地')).first.wait_for(state='visible',timeout=20000)
        total=root.locator('.comments-container .total:visible')
        if await total.count() and re.search(r'[1-9]\d*',await total.first.inner_text()):
            await root.locator('.comment-item').first.wait_for(state='visible',timeout=15000)
        return page,root,ident

    async def comment_rows(self,root):
        return await root.locator('.comment-item[id^="comment-"]').evaluate_all(r'''els=>els.slice(0,100).map(e=>({
          id:e.id.slice(8), author:e.querySelector('a.name')?.getAttribute('data-user-id'),
          name:e.querySelector('a.name')?.textContent.trim(), text:e.querySelector('.content')?.innerText.trim(),
          date:e.querySelector('.date span')?.textContent.trim(),
          parent:e.closest('.parent-comment')?.querySelector('.comment-item')?.id.slice(8),
          folded:/展开\s*\d+\s*条回复|展开更多回复/.test(e.closest('.parent-comment')?.innerText||''),
          threadAuthors:Array.from(e.closest('.parent-comment')?.querySelectorAll('.comment-item a.name')||[]).map(a=>a.getAttribute('data-user-id'))
        }))''')

    async def comments(self,page):
        # The current account has seven notes. Bound future scans to its 12 latest
        # visible notes; the dashboard reports this window instead of claiming all history.
        await page.locator(f'a[href*="/user/profile/{self.owner}/"]').first.wait_for(state='attached',timeout=15000)
        links=await page.locator('a[href]').evaluate_all('els=>els.map(e=>e.getAttribute("href"))')
        selected={}
        for href in links:
            try: ident=note_id(href)
            except ValueError:continue
            if '/user/profile/'+self.owner+'/' in href:selected.setdefault(ident,href)
        if not selected:raise ValueError('未读取到自己发布的笔记，评论扫描未完成')
        events=[]
        for ident,href in list(selected.items())[:12]:
            self.phase='读取笔记 '+ident
            try:_,root,_=await self.note(href)
            except UnrelatedNote:continue
            for r in await self.comment_rows(root):
                if not HEX.fullmatch(r.get('id') or '') or not HEX.fullmatch(r.get('author') or '') or not r.get('text'):continue
                if r['author']==self.owner:continue
                events.append({'id':'comment:'+r['id'],'channel':'comment','text':r['text'], 'context':{
                    'account':self.db.settings()['account'],'owned':True,'related':True,'note_id':ident,
                    'comment_id':r['id'],'author_id':r['author'],'author_name':r['name'],'target':BASE+'/explore/'+ident,
                    'event_at':platform_time(r.get('date') or ''),'answered':self.owner in r['threadAuthors'] or r['folded'] or r['parent']!=r['id'],
                    'fingerprint':digest(r['text'])}})
        return events

    async def dm_rows(self,page):
        rows=await page.locator('.chat-item[data-message-id]').evaluate_all('''els=>els.slice(-80).map(e=>{
          let labels=[];for(let p=e.previousElementSibling;p;p=p.previousElementSibling){
            if(p.matches('.xhs-im-msg-list__time-divider')){labels.push(p.innerText.trim());break;}
          }
          return {id:e.getAttribute('data-message-id'), outgoing:!!e.querySelector('.chat-item__bubble-row--right'),
            incoming:!!e.querySelector('.chat-item__bubble-row--left'), text:e.querySelector('.xhs-im-bubble__text')?.innerText.trim()||'',
            labels};
        })''')
        peer=urlparse(page.url).path.rsplit('/',1)[-1]
        if any(len(r['id'].split('.'))!=3 or set(r['id'].split('.')[:2])!={self.owner,peer} for r in rows):
            raise ReplyBlocked('消息标识与当前会话不一致')
        for r in rows:
            r['event_at']=next((at for s in r.pop('labels') if (at:=platform_time(s))),None)
        return rows

    async def conversation(self,ident):
        if not HEX.fullmatch(ident):raise ReplyBlocked('无效私信目标')
        page=await self.page()
        await page.goto(BASE+'/chat/'+ident,wait_until='domcontentloaded')
        await page.locator('.xhs-im-input-bar-editor').wait_for(state='visible',timeout=15000)
        await self.same_account(page)
        selected=page.locator('.xhs-im-conv-item--active')
        if await selected.count()!=1 or await selected.get_attribute('data-conv-id')!=ident:
            raise ReplyBlocked('当前会话与目标不一致')
        await page.locator('.xhs-im-msg-list').wait_for(state='visible')
        await page.locator('.chat-item[data-message-id]').first.wait_for(state='visible',timeout=15000)
        return page

    async def dms(self):
        self.phase='读取相关私信'
        page=await self.page();await page.goto(BASE+'/chat',wait_until='domcontentloaded')
        await page.locator('.xhs-im-conv-list').wait_for(state='visible',timeout=15000)
        await self.same_account(page)
        items=await page.locator('.xhs-im-conv-item[data-conv-kind="c2c"]').evaluate_all('''els=>els.slice(0,20).map(e=>({
            id:e.getAttribute('data-conv-id'),name:e.querySelector('.xhs-im-conv-item__name')?.textContent.trim(),text:e.innerText}))''')
        account=self.db.settings()['account']
        with self.db.connect() as c:
            contexts=[json.loads(r[0]) for r in c.execute('SELECT context FROM messages')]
            known={ctx.get('thread_id') or ctx.get('author_id') for ctx in contexts if str(ctx.get('account'))==str(account)}
            known.update(getattr(self,'related_peers',set()))
        events=[]
        for item in items:
            if not HEX.fullmatch(item['id'] or ''):continue
            if not re.search(r'PMP|刷题|做题|题库|幻谱|知习|试卷|题目|八大原则',item['text'],re.I) and item['id'] not in known:continue
            page=await self.conversation(item['id']); rows=await self.dm_rows(page)
            related=any(RELATED.search(r['text']) for r in rows) or item['id'] in known
            if not related:continue
            for index,r in enumerate(rows):
                if not r['incoming'] or r['outgoing'] or not r['text']:continue
                events.append({'id':'dm:'+r['id'],'channel':'dm','text':r['text'],'context':{
                    'account':self.db.settings()['account'],'owned':True,'related':True,'thread_id':item['id'],
                    'message_id':r['id'],'author_id':item['id'],'author_name':item['name'],
                    'target':BASE+'/chat/'+item['id'],'event_at':r['event_at'],
                    'answered':index!=len(rows)-1,'fingerprint':digest(r['text'])}})
        return events

    async def scan(self):
        page=await self.identity();events=[];complete=[];errors=[]
        for channel,read in [('comment',lambda:self.comments(page)),('dm',self.dms)]:
            try:
                events.extend(await read());complete.append(channel)
                if channel=='comment':self.related_peers={e['context']['author_id'] for e in events}
            except Exception as e:errors.append(channel+': '+(str(e) if isinstance(e,ValueError) else getattr(self,'phase','页面')+' '+type(e).__name__+'；页面结构或加载状态未通过核验'))
        self.adapter.community_status.update(channels=complete,reason='；'.join(errors) or '评论与相关私信已读取',
            scope='主页前12篇自己的PMP笔记（含置顶），每篇前100条已加载评论；最近20个会话中相关咨询的最近80条消息。只自动回复未折叠的根评论和私信末条未回答咨询。')
        if errors:self.db.notify('community-'+utcnow()[:13]+'-'+digest(errors),'；'.join(errors))
        if not complete:raise ValueError('；'.join(errors))
        return {'messages':events,'complete_channels':complete}

    async def search(self,query,limit):
        page=await self.identity()
        await page.goto(BASE+'/search_result?keyword='+quote(query),wait_until='domcontentloaded')
        await page.locator('section.note-item a.title').first.wait_for(state='visible',timeout=20000)
        await self.same_account(page)
        rows=await page.locator('section.note-item').evaluate_all('''els=>els.slice(0,30).map(e=>({
            href:e.querySelector('a.title')?.getAttribute('href'),title:e.querySelector('a.title')?.innerText.trim(),
            author:e.querySelector('a.author .name')?.textContent.trim(),author_href:e.querySelector('a.author')?.getAttribute('href'),
            likes:e.querySelector('.like-wrapper .count')?.textContent.trim()}))''')
        result=[]
        for r in rows:
            if not r.get('href') or not r.get('author_href') or not r.get('title'):continue
            try:ident=note_id(r['href']);owner=profile_id(r['author_href'])
            except ValueError:continue
            if owner==self.owner or not re.search(r'PMP|PMBOK|项目管理',r['title'],re.I):continue
            result.append({'note_id':ident,'title':r['title'],'url':BASE+'/explore/'+ident,
                           'author':r['author'],'likes':r['likes'] or '', 'text':''})
            if len(result)>=min(limit,12):break
        return result

    async def target(self,message):
        ctx=message['context'];await self.identity()
        if str(ctx['account'])!=str(self.db.settings()['account']):raise ReplyBlocked('绑定账号已变更')
        if message['channel']=='dm':
            page=await self.conversation(ctx['thread_id']);rows=await self.dm_rows(page)
            latest_incoming(rows,ctx['message_id'],message['text'])
            return page,rows
        # Resolve a fresh public link from the owned profile; never reuse stale access tokens.
        page=await self.page();links=await page.locator('a[href]').evaluate_all('els=>els.map(e=>e.getAttribute("href"))')
        href=next((h for h in links if '/'+ctx['note_id'] in h),None)
        if not href:raise ReplyBlocked('目标笔记不在当前主页窗口')
        page,root,_=await self.note(href);rows=await self.comment_rows(root)
        matches=[r for r in rows if r['id']==ctx['comment_id'] and r['author']==ctx['author_id'] and r['text']==message['text']]
        if len(matches)!=1 or self.owner in matches[0]['threadAuthors'] or matches[0]['folded'] or matches[0]['parent']!=matches[0]['id']:raise ReplyBlocked('评论已变化或已有本账号回复')
        return page,rows

    async def prepare(self,message):
        _,rows=await self.target(message)
        return {'before_ids':[r['id'] for r in rows], 'target':message['context']['target'],
                'fingerprint':digest(message['text']),'account':self.db.settings()['account'],'prepared_at':utcnow()}

    async def submit(self,message,prepared):
        if prepared.get('fingerprint')!=digest(message['text']) or prepared.get('target')!=message['context']['target']:
            raise ReplyBlocked('回复准备证据不匹配')
        page,_=await self.target(message)
        if message['channel']=='dm':editor=page.locator('.xhs-im-input-bar-editor')
        else:
            row=page.locator('#comment-'+message['context']['comment_id'])
            await row.locator('.reply.icon-container').click()
            editor=page.locator('#content-textarea')
            header=page.locator('#noteContainer .reply-content .reply')
            if await header.count()!=1 or (await header.inner_text()).strip()!='回复 '+message['context']['author_name']:
                raise ReplyBlocked('评论编辑器未指向预期用户')
        if (await editor.inner_text()).strip():raise ReplyBlocked('编辑器已有草稿，停止覆盖')
        await editor.fill(message['reply'])
        if (await editor.inner_text()).strip()!=message['reply']:raise ReplyBlocked('回复编辑区内容不一致')
        cfg=self.db.settings()
        if not cfg['enabled'] or not cfg['auto_reply']:
            await editor.fill('');raise ReplyBlocked('任务已暂停')
        await self.same_account(page)
        if message['channel']=='dm':
            latest_incoming(await self.dm_rows(page),message['context']['message_id'],message['text'])
        else:
            rows=await self.comment_rows(page.locator('#noteContainer'))
            if any(r['author']==self.owner and r['parent']==message['context']['comment_id'] for r in rows):
                await editor.fill('');raise ReplyBlocked('刚刚已经有人回复，停止重复发送')
        # No retry around this boundary. Errors after the single submit become unknown.
        if message['channel']=='dm':await editor.press('Enter')
        else:await page.locator('#noteContainer').get_by_role('button',name='发送',exact=True).click()
        # Keep the page open until a new rendered row appears. A timeout is unknown,
        # never an invitation to submit again. Then reload through normal navigation.
        selector='.chat-item[data-message-id]' if message['channel']=='dm' else '#noteContainer .comment-item[id^="comment-"]'
        await page.wait_for_function('''({selector,before,channel})=>Array.from(document.querySelectorAll(selector)).some(e=>{
            const id=channel==='dm'?e.getAttribute('data-message-id'):e.id.slice(8);
            return id&&!before.includes(id);
        })''',arg={'selector':selector,'before':prepared['before_ids'],'channel':message['channel']},timeout=15000)
        message={**message,'prepared':prepared}
        return await self.verify(message)

    async def verify(self,message):
        prepared=message.get('prepared') or {};ctx=message['context']
        if not prepared.get('before_ids') or prepared.get('target')!=ctx['target']:return None
        await self.identity()
        if message['channel']=='dm':
            page=await self.conversation(ctx['thread_id']);rows=await self.dm_rows(page)
            incoming=next((i for i,r in enumerate(rows) if r['id']==ctx['message_id'] and r['text']==message['text'] and r['incoming']),None)
            if incoming is None:return None
            matching=[r for r in rows[incoming+1:] if r['outgoing'] and r['text']==message['reply'] and r['id'] not in prepared['before_ids']]
        else:
            page=await self.page();links=await page.locator('a[href]').evaluate_all('els=>els.map(e=>e.getAttribute("href"))')
            href=next((h for h in links if '/'+ctx['note_id'] in h),None)
            if not href:return None
            page,root,_=await self.note(href);rows=await self.comment_rows(root)
            matching=[r for r in rows if r['author']==self.owner and r['text']==message['reply'] and r['id'] not in prepared['before_ids']
                      and r['parent']==ctx['comment_id']]
        if len(matching)!=1:return None
        return {'reply_id':matching[0]['id'],'target':ctx['target'],'verified_at':utcnow()}
