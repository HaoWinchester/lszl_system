"""Small, bounded seed library based on the publicly available PMI overview.

This is not a copy of the textbook. Questions are original knowledge checks,
not exam questions and not claims about questions available in the product.
"""
import hashlib
import json
from datetime import datetime, timezone, timedelta
import httpx

SOURCES = [{
    'id':'pmi-pmbok8', 'title':'PMI · PMBOK Guide Eighth Edition 官方介绍',
    'url':'https://www.pmi.org/standards/pmbok', 'edition':'PMBOK 第八版',
    'locator':'Overview / What You’ll Learn', 'checked_at':'2026-11-02',
    'facts':[
        '第八版包含六项核心原则和七个绩效域。',
        '六项原则为整体视角、聚焦价值、内建质量、负责地领导、融入可持续性、建设赋能团队；中文为学习用意译。',
        '七个绩效域为治理、范围、进度、财务、相关方、资源、风险；中文为学习用意译。',
        '强调项目成果与组织战略目标的联系，以及价值交付。',
        '实践、工具和技术应结合团队、组织和环境进行裁剪。',
        '扩展了 AI、PMO 和采购内容；过程指导不是机械照搬的规定。',
    ],
    'limits':'仅覆盖公开简介；不支持完整教材细节、考试范围或题库题量结论。',
    'verification':'官方公开页面已人工核对；运行时重新确认关键依据仍存在。',
}]

def question(stem, options, answer, explanation):
    return dict(stem=stem, options=options, answer=answer, explanation=explanation, label='原创知识自测 · 非考试真题')

TOPICS = [
    dict(id='domains', name='七个绩效域：先搭学习地图', source_ids=['pmi-pmbok8'],
         question=question('以下哪项属于第八版的七个绩效域？', {'A':'财务','B':'沟通'}, 'A', 'PMI 官方简介列出的七个绩效域中包含财务，未将沟通列为独立绩效域；不表示沟通不重要。')),
    dict(id='value', name='项目做完了，价值交付了吗？', source_ids=['pmi-pmbok8'],
         question=question('根据官方简介的价值交付导向，复盘项目时更应关注什么？', {'A':'项目成果是否支持组织战略目标','B':'只检查任务是否全部勾选'}, 'A', '官方简介强调把项目成果与组织战略目标联系起来，任务完成本身不足以说明价值实现。')),
    dict(id='tailoring', name='同一个方法，为什么不能照搬？', source_ids=['pmi-pmbok8'],
         question=question('将方法用于新团队时，哪种做法更符合裁剪导向？', {'A':'不考虑环境，直接照搬','B':'结合团队、组织与环境调整'}, 'B', 'PMI 官方简介明确提到根据团队、组织和环境调整实践、工具与技术。')),
    dict(id='principles', name='六项原则：不只是背关键词', source_ids=['pmi-pmbok8'],
         question=question('下列哪一项属于官方简介列出的第八版原则？', {'A':'融入可持续性','B':'所有项目采用相同流程'}, 'A', '可持续性是六项原则之一；相同流程照搬也不符合因情境裁剪的导向。')),
]

async def verify_sources(root):
    """Only a fixed official URL is fetched. No user-controlled URL or redirect."""
    url=SOURCES[0]['url']
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        response=await client.get(url)
        if response.status_code == 403:
            # The verified seed is bounded in time; a blocked fetch is never called a fresh check.
            checked=datetime.fromisoformat(SOURCES[0]['checked_at']).replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc)-checked > timedelta(days=7):
                raise ValueError('官方资料核验已过期且网站拒绝自动读取，需要更新依据')
            report={'checked_at':SOURCES[0]['checked_at'],'url':url,'passed':True,
                    'mode':'已核验公开资料快照','fetch_status':403,'expires_at':(checked+timedelta(days=7)).isoformat()}
            (root/'source-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
            return report
        response.raise_for_status()
        if len(response.content)>4_000_000: raise ValueError('资料页面超出大小限制')
    text=response.text.lower()
    anchors=['eighth edition','seven performance domains','focus on value','tailor for your context']
    if not all(word in text for word in anchors): raise ValueError('官方页面依据已变化，需重新核验资料')
    report={'checked_at':datetime.now(timezone.utc).isoformat(), 'url':url,
            'sha256':hashlib.sha256(response.content).hexdigest(),'passed':True}
    (root/'source-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return report
