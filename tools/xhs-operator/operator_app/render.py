import hashlib
import html
from pathlib import Path
from playwright.async_api import async_playwright

CSS='''
*{box-sizing:border-box}body{margin:0;background:#eee9dd;color:#1c332f;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
article{width:1080px;height:1440px;padding:78px 82px;display:flex;flex-direction:column;position:relative;overflow:hidden}
.brand{display:flex;justify-content:space-between;font-size:24px;letter-spacing:2px;border-top:3px solid #203d36;padding-top:23px}
.kicker{font-size:25px;letter-spacing:4px;color:#56796d;margin-top:110px}.title{font-size:70px;line-height:1.3;letter-spacing:-2px;margin:28px 0 48px;font-weight:700;white-space:pre-wrap;overflow-wrap:anywhere}
.text{font-size:37px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.body{flex:1;min-height:0;overflow:hidden}
footer{border-top:1px solid #a6b2a9;padding-top:23px;margin-top:30px;font-size:22px;line-height:1.6;color:#536a60}
.number{position:absolute;right:72px;bottom:135px;font-size:120px;color:#2d584e0c;font-weight:800;pointer-events:none}
.cover{background:#173c32;color:#f8f1dc}.cover .kicker{color:#bbd5a1}.cover .title{font-size:88px}.cover footer{color:#b5c9ba}.cover .brand{border-color:#d4e3bc}
'''

def document(card, index, count, product, sources=None):
    esc=html.escape
    sources=sources or []
    overview=not sources or all(s.get("kind")=="overview" for s in sources)
    kicker="PMBOK® GUIDE / 第八版" if overview else "PMP / 通用学习补充"
    attribution="PMI 官方公开简介" if overview else " / ".join(dict.fromkeys(s["edition"] for s in sources))
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>{CSS}</style>
    <article class="{'cover' if index==0 else ''}"><div class="brand"><span>{esc(product)}</span><span>PMP · 学习手记</span></div>
    <div class="body"><div class="kicker">{esc(kicker)}</div><h1 class="title">{esc(card['title'])}</h1><div class="text">{esc(card['text'])}</div></div>
    <div class="number">{index+1:02}</div><footer>依据：{esc(attribution)} · 原创整理与自测<br>学习意译，不替代教材和考试大纲　 {index+1:02} / {count:02}</footer></article></html>'''

async def render(draft, root, product, sources=None):
    content=draft['content']
    q=content['question']
    cards=content['cards']+[{'title':'做一道知识自测','text':q['stem']+'\n\n'+'\n'.join(f'{k}. {v}' for k,v in q['options'].items())},
                            {'title':'核对思路，再去练习','text':f"答案：{q['answer']}\n{q['explanation']}\n\n{product}提供 PMP 题目练习。按自己的复习安排练习并复盘。"}]
    folder=Path(root)/'assets'/draft['id']/str(draft['version'])
    folder.mkdir(parents=True,exist_ok=True)
    assets=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        try:
            page=await browser.new_page(viewport={'width':1080,'height':1440},device_scale_factor=1)
            for i,card in enumerate(cards):
                source=document(card,i,len(cards),product,sources)
                await page.set_content(source)
                await page.evaluate('document.fonts.ready')
                fits=await page.locator('.body').evaluate('(e)=>e.scrollHeight<=e.clientHeight && e.scrollWidth<=e.clientWidth')
                if not fits: raise ValueError(f'第 {i+1} 张卡片文字溢出，请缩短内容')
                path=folder/f'{i+1:02}.png'
                await page.screenshot(path=str(path))
                assets.append({'path':str(path.relative_to(root)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        finally: await browser.close()
    return assets


def check_assets(root, assets):
    if len(assets)!=6: raise ValueError('需要完整的六张知识卡片')
    root=Path(root).resolve()
    for asset in assets:
        p=(root/asset['path']).resolve()
        if not p.is_relative_to(root/'assets') or not p.is_file(): raise ValueError('图片文件缺失')
        if hashlib.sha256(p.read_bytes()).hexdigest()!=asset['sha256']: raise ValueError('图片已变化，需要重新审核')
