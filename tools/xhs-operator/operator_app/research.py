"""Observed competitor samples inform presentation, never knowledge claims."""
import json
import re
from datetime import datetime, timezone, timedelta
from statistics import median
from urllib.parse import urlparse


def metric(value):
    match=re.fullmatch(r'(\d+(?:\.\d+)?)(万|千)?',str(value).strip())
    if not match:return None
    return int(float(match[1])*({'万':10000,'千':1000}.get(match[2],1)))


def summarize(samples):
    samples=list({s['note_id']:s for s in samples}.values())
    likes=[metric(s.get('likes','')) for s in samples]
    known=[v for v in likes if v is not None]
    questions=sum(bool(re.search(r'[?？]|怎么|如何|为什么',s['title'])) for s in samples)
    lists=sum(bool(re.search(r'清单|步骤|总结|\d+[个条步点]',s['title'])) for s in samples)
    intents=[]
    for name,pattern in [('复习安排',r'复习|备考|计划|冲刺'),('刷题复盘',r'刷题|错题|做题|解析'),('知识辨析',r'区别|易错|概念|知识点')]:
        count=sum(bool(re.search(pattern,s['title']+' '+s.get('text',''))) for s in samples)
        if count:intents.append({'name':name,'count':count})
    recommendations=['先用一个具体学习问题开篇，再给原创情境和一道自测，最后自然推荐练习。',
                     '样本点赞只反映采集时的可见数，不能说明获客效果或因果关系。']
    if questions:recommendations.append('样本中有问题式标题；可围绕本篇已核验知识提出一个具体问题。')
    if lists:recommendations.append('样本中有清单式表达；正文可分成少量步骤，但不要新增资料没有支持的规则。')
    return {'sample_count':len(samples),'known_likes':len(known),'median_likes':median(known) if known else None,
            'question_titles':questions,'list_titles':lists,
            'median_title_length':median([len(s['title']) for s in samples]) if samples else None,
            'reader_intents':intents,'recommendations':recommendations}


class Research:
    def __init__(self,db):self.db=db;self.path=db.root/'research.json'

    def state(self):
        if not self.path.exists():return {'sample_count':0,'samples':[],'last_error':None}
        return json.loads(self.path.read_text())

    def _write(self,report):
        temp=self.path.with_suffix('.tmp')
        temp.write_text(json.dumps(report,ensure_ascii=False,indent=2));temp.replace(self.path)

    def save(self,samples,query,sampled_at):
        cleaned=[]
        for s in samples[:20]:
            ident=s.get('note_id','');u=urlparse(s.get('url',''))
            if not re.fullmatch(r'[a-f0-9]{24}',ident) or u.scheme!='https' or u.netloc!='www.xiaohongshu.com' or u.path not in {'/explore/'+ident,'/search_result/'+ident}:
                raise ValueError('竞品样本缺少真实笔记链接')
            if not isinstance(s.get('title'),str) or not s['title'].strip():continue
            if not re.search(r'PMP|PMBOK|项目管理',s['title']+' '+s.get('text',''),re.I):continue
            cleaned.append({'note_id':ident,'url':s['url'],'title':s['title'][:100],
                            'author':str(s.get('author',''))[:80],'likes':str(s.get('likes',''))[:20],
                            'text':str(s.get('text',''))[:700]})
        cleaned=list({s['note_id']:s for s in cleaned}.values())
        if not cleaned:raise ValueError('未读取到相关竞品样本，不能生成分析')
        report={**summarize(cleaned),'query':query,'sampled_at':sampled_at,'samples':cleaned,'last_error':None}
        self._write(report);return report

    def context(self):
        report=self.state()
        try:at=datetime.fromisoformat(report['sampled_at'])
        except (KeyError,ValueError):raise ValueError('请先完成竞品采样与分析')
        if at.tzinfo is None or not 0<= (datetime.now(timezone.utc)-at).total_seconds()<=48*3600:
            raise ValueError('竞品分析已超过48小时，需要刷新')
        # Model sees aggregate guidance, not competitors' paragraphs to imitate.
        return {k:report[k] for k in ('sampled_at','sample_count','question_titles','list_titles','reader_intents','recommendations')}

    async def refresh(self,adapter):
        query='PMP 备考 刷题'
        try:
            samples=await adapter.search_competitors(query,limit=12)
            report=self.save(samples,query,datetime.now(timezone.utc).isoformat())
            self.db.notify('research-'+report['sampled_at'][:10],f"竞品采样完成：{report['sample_count']} 篇相关笔记。")
            return report
        except Exception as e:
            report=self.state();report['last_error']=str(e) if isinstance(e,ValueError) else '竞品页面读取失败'
            report['attempted_at']=datetime.now(timezone.utc).isoformat();self._write(report)
            raise
