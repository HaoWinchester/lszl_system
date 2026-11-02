"""Persistent browser adapter with an explicitly calibrated DOM contract.

No private APIs, stealth, CAPTCHA workarounds, guessed success toasts or cookie
extraction. The packaged contract records selectors observed in the signed-in UI.
"""
import asyncio
import json
import re
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from .render import check_assets
from .store import utcnow, digest

CREATOR='https://creator.xiaohongshu.com/'

def parse_note_card(title,raw,channel):
    try:
        data=json.loads(raw or '{}')
        ident=data['noteTarget']['value']['noteId']
        actual=data['index']['value']['channelTabName']
    except (ValueError,KeyError,TypeError):raise ValueError('笔记 ID 结构变化，无法核验')
    if not re.fullmatch(r'[a-f0-9]{24}',ident):raise ValueError('平台笔记 ID 无效')
    if actual!=channel:return None
    return {'title':title,'note_id':ident,'channel':actual}


async def publish_target(context,page):
    """Locate the rendered accessible button, including a closed web component.

    Reads accessibility and visible geometry only; never changes Shadow DOM,
    injects handlers, invokes private APIs or bypasses platform checks.
    """
    session=await context.new_cdp_session(page)
    try:
        tree=await session.send('Accessibility.getFullAXTree')
        matches=[n for n in tree['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')=='button'
                 and n.get('name',{}).get('value','').strip()=='发布']
        if len(matches)!=1:raise ValueError('未找到唯一的可访问发布按钮')
        node=matches[0]
        if any(p['name'] in {'disabled','busy'} and p['value'].get('value') is True for p in node.get('properties',[])):
            raise ValueError('发布按钮不可用，停止提交')
        args={'backendNodeId':node['backendDOMNodeId']}
        await session.send('DOM.scrollIntoViewIfNeeded',args)
        geometry=await session.send('DOM.getContentQuads',args)
        quads=geometry.get('quads',[])
        if len(quads)!=1:raise ValueError('无法确定发布按钮可见位置')
        q=quads[0];x=sum(q[0::2])/4;y=sum(q[1::2])/4
        size=page.viewport_size
        if not(size and 0<x<size['width'] and 0<y<size['height']):raise ValueError('发布按钮不在可见区域')
        return x,y
    finally:await session.detach()


class BrowserAdapter:
    def __init__(self, db):
        self.db=db;self.lock=asyncio.Lock();self.pw=None;self.context=None;self.page=None
        self.status={'connected':False,'identity_verified':False,'reason':'尚未打开工具专用浏览器'}
        self.community_status={'identity_verified':False,'reason':'主站尚未核验','channels':[]}

    async def open_community(self):
        async with self.lock:
            await self.open()
            page=next((p for p in self.context.pages if urlparse(p.url).netloc=='www.xiaohongshu.com'),None)
            if page is None:
                page=await self.context.new_page()
                await page.goto('https://www.xiaohongshu.com',wait_until='domcontentloaded')
            await page.bring_to_front()
            self.community_status={'identity_verified':False,'reason':'请在主站登录同一官方账号，随后扫描互动','channels':[]}
            return self.community_status

    def contract(self):
        p=self.db.root/'browser-contract.json'
        if not p.exists(): p=__import__('pathlib').Path(__file__).with_name('browser-contract.json')
        if not p.exists(): raise ValueError('尚未完成登录后的发布页面适配；自动发送已阻断')
        c=json.loads(p.read_text())
        required=['identity','identity_url','publish_url','images','title','body','submit','notes_url','note_row','note_title','note_id_attribute']
        if not all(isinstance(c.get(k),str) and c[k] for k in required): raise ValueError('发布页面适配不完整')
        for k in ('publish_url','notes_url','identity_url'):
            if urlparse(c[k]).scheme!='https' or urlparse(c[k]).netloc!='creator.xiaohongshu.com': raise ValueError('发布地址不属于创作中心')
        return c

    async def open(self):
        if self.context is None:
            self.pw=await async_playwright().start()
            try:
                self.context=await self.pw.chromium.launch_persistent_context(str(self.db.root/'browser-profile'),headless=False,
                                      viewport={'width':1280,'height':900})
                self.page=await self.context.new_page()
                self.context.on('close',self._closed)
            except BaseException:
                await self.pw.stop();self.pw=None;raise
        if self.page.is_closed(): self.page=await self.context.new_page()
        return self.page

    def _closed(self, *_):
        self.context=None;self.page=None
        self.status={'connected':False,'identity_verified':False,'reason':'专用浏览器已关闭'}

    async def login(self):
        async with self.lock:
            page=await self.open()
            await page.goto(CREATOR,wait_until='domcontentloaded',timeout=45000)
            await page.bring_to_front()
            self.status={'connected':True,'identity_verified':False,'reason':'请在专用浏览器登录，之后检查账号'}
            return self.status

    async def one(self, page, selector):
        locator=page.get_by_role('button',name='发布',exact=True) if selector=="button:has-text('发布')" else page.locator(selector)
        await locator.first.wait_for(state='attached',timeout=15000)
        if await locator.count()!=1: raise ValueError('页面结构变化或元素不唯一，已停止自动操作')
        return locator

    async def identity(self, page, contract):
        if urlparse(page.url).netloc!='creator.xiaohongshu.com' or '/login' in page.url: raise ValueError('小红书登录已失效')
        identity_page=await self.context.new_page()
        try:
            await identity_page.goto(contract['identity_url'],wait_until='domcontentloaded',timeout=45000)
            identity=identity_page.locator(contract['identity'])
            await identity.wait_for(state='visible',timeout=15000)
            text=await identity.inner_text()
            expected=self.db.settings()['account']
            found=re.search(r'小红书账号\s*[:：]\s*(\d+)',text)
            if found is None or found.group(1)!=expected:
                self.status={'connected':True,'identity_verified':False,'reason':'当前账号 ID 与绑定账号不一致','observed_account':found.group(1) if found else None}
                raise ValueError('当前账号 ID 与绑定账号不一致')
            self.status={'connected':True,'identity_verified':True,'reason':'账号 ID 已核对','account':expected}
        finally: await identity_page.close()

    async def probe(self):
        async with self.lock:
            page=await self.open()
            c=self.contract()
            await page.goto(c['publish_url'],wait_until='domcontentloaded')
            await self.identity(page,c)
            return self.status

    async def rows(self, page, c, tab=None, expected_title=None):
        await page.goto(c['notes_url'],wait_until='domcontentloaded')
        await self.identity(page,c)
        await page.get_by_placeholder('搜索已发布的笔记',exact=True).wait_for(state='visible')
        channel='published' if tab=='已发布' else 'all'
        if tab:
            control=page.get_by_text(tab,exact=True).and_(page.locator(':not(.note-card *)'))
            if await control.count()!=1:raise ValueError('笔记筛选入口不唯一')
            await control.click()
        if expected_title:
            try:
                await page.wait_for_function("""({rowSelector,titleSelector,attr,title,channel}) =>
                  Array.from(document.querySelectorAll(rowSelector)).some(r => {
                    try { return r.querySelector(titleSelector)?.textContent.trim()===title &&
                      JSON.parse(r.getAttribute(attr)).index.value.channelTabName===channel; }
                    catch { return false; }
                  })""",arg={'rowSelector':c['note_row'],'titleSelector':c['note_title'],
                      'attr':c['note_id_attribute'],'title':expected_title,'channel':channel},timeout=12000)
            except Exception:return []
        else:
            await page.locator(c['note_row']).or_(page.get_by_text('暂无笔记',exact=True)).first.wait_for(state='visible',timeout=15000)
        result=[]
        for row in (await page.locator(c['note_row']).all())[:100]:
            title=(await row.locator(c['note_title']).inner_text()).strip()
            item=parse_note_card(title,await row.get_attribute(c['note_id_attribute']),channel)
            if item:
                item['reviewing']=bool(re.search(r'(^|\n)审核中(\n|$)',await row.inner_text()))
                result.append(item)
        return result

    async def prepare(self, draft, preview=False):
        c=self.contract();page=await self.open()
        from .sources import verify_sources, selected_sources
        sources=selected_sources(self.db.root,draft['topic'])
        if not draft['review'] or draft['review'].get('source_hash')!=digest(sources) or draft['review'].get('product_hash')!=digest({k:self.db.settings()[k] for k in ('product_name','product_fact','product_url')}):
            raise ValueError('资料或产品事实已更新，需要重新审核')
        await verify_sources(self.db.root,[s['id'] for s in sources])
        if not preview:
            from .research import Research
            Research(self.db).context()
        check_assets(self.db.root,draft['assets'])
        before=await self.rows(page,c)
        await page.goto(c['publish_url'],wait_until='domcontentloaded')
        if not preview and not self.db.settings()['enabled']: raise ValueError('任务已暂停')
        image_input=await self.one(page,c['images'])
        if any(r['title']==draft['content']['title'] for r in before): raise ValueError('账号已有同名笔记，停止重复提交')
        await image_input.set_input_files([str(self.db.root/x['path']) for x in draft['assets']])
        await page.get_by_text('6/18',exact=True).wait_for(state='visible',timeout=45000)
        guide=page.get_by_role('button',name='我知道了',exact=True)
        if await guide.count() and await guide.is_visible(): await guide.click()
        await (await self.one(page,c['title'])).fill(draft['content']['title'])
        await (await self.one(page,c['body'])).fill(draft['content']['body'])
        # Any mandatory declaration is calibrated from the actual current page.
        # Never remove a mandatory platform disclosure automatically.
        if c.get('required_declaration'):
            await (await self.one(page,c['required_declaration'])).check()
        await (await self.one(page,c['title'])).click()
        await publish_target(self.context,page)
        title_value=await (await self.one(page,c['title'])).input_value()
        body_value=await (await self.one(page,c['body'])).inner_text()
        if title_value!=draft['content']['title'] or ' '.join(body_value.split())!=' '.join(draft['content']['body'].split()):
            raise ValueError('页面文案与审核稿件不一致')
        self.db.configure(adapter_calibrated=True)
        return {'before_ids':[x['note_id'] for x in before], 'title':draft['content']['title']}

    async def submit(self):
        c=self.contract();page=await self.open()
        await self.identity(page,c)
        if not self.db.settings()['enabled']: raise ValueError('任务已暂停，未提交')
        x,y=await publish_target(self.context,page)
        if not self.db.settings()['enabled']:raise ValueError('任务已暂停，未提交')
        await page.mouse.click(x,y)

    async def verify(self, draft, baseline):
        c=self.contract();page=await self.open()
        for label,status in [('已发布','published'),(None,'platform-review')]:
            rows=await self.rows(page,c,label,draft['content']['title'])
            matches=[r for r in rows if r['title']==draft['content']['title'] and r['note_id'] not in baseline.get('before_ids',[])
                     and (status=='published' or r['reviewing'])]
            if len(matches)==1:
                r=matches[0]
                folder=self.db.root/'assets'/'evidence';folder.mkdir(exist_ok=True)
                evidence=folder/(r['note_id']+'.png')
                await page.screenshot(path=str(evidence))
                return {**r,'status':status,'url':'https://www.xiaohongshu.com/explore/'+r['note_id'],
                        'baseline':baseline,'verified_at':utcnow(),'evidence':str(evidence.relative_to(self.db.root))}
            if len(matches)>1:break
        return {'status':'unknown','reason':'未找到唯一的新笔记及可靠的发布状态；不会自动重发','baseline':baseline}

    async def read_messages(self):
        # Creator Center currently exposes no verified inbox in this integration.
        # Fail closed rather than scan unrelated private conversations.
        raise ValueError('评论和私信通道尚未完成当前账号的页面适配')

    async def search_competitors(self,query,limit=12):
        raise ValueError('需要先登录小红书主站并核验搜索结果页面，尚未采集竞品样本')

    async def reply(self,message):
        raise ValueError('互动发送适配尚未通过真实会话核验，未发送')

    async def close(self):
        if self.context: await self.context.close()
        if self.pw: await self.pw.stop();self.pw=None
