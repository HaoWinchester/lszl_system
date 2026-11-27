// 做题大厅两栏改版：左栏产品卡 + 总统计 + 固定分类导航（完成度圆环）；
// 右栏当前分类的试卷行列表（题数 / 预计时长 / 正确率 / 待完成 / 进入答题）。
// 分类是前端展示层配置，按试卷名匹配；未匹配卷归入兜底分类，不丢卷。
// 数据仍以 100-practice-mode.js 的 state.releases / coverage 为单一来源，
// 本模块只读渲染，选中与开始练习由主文件的 selectPaper / startPractice 处理。
'use strict';
(function(global){
  const text=value=>String(value??'');
  const esc=value=>text(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  // 分类定义：match 按名称匹配主归属，按数组顺序先到先得；fixed 仅定义分类内固定排序
  // （行前显示序号徽标），不参与主归属匹配；catchAll 收留其余试卷，
  // order 定义其固定名称顺序，不在 order 的按发布时间排后。
  const CATEGORIES=[
    {id:'dec-mocks',name:'12月最新模拟卷',match:name=>name.startsWith('12月新题模考卷')||name.startsWith('真题模考卷'),fixed:['12月新题模考卷(一)','12月新题模考卷(二)','12月新题模考卷(三)','真题模考卷A','真题模考卷B','真题模考卷C','真题模考卷D','真题模考卷E','真题模考卷F','真题模考卷G','真题模考卷H','真题模考卷I','真题模考卷J']},
    {id:'case-chart',name:'专题卷-案例和图表',match:name=>name.includes('案例')||name.includes('图表'),emptyHint:'新题库整理中，敬请期待'},
    {id:'multi-choice',name:'专题卷-多选题',match:name=>name.includes('多选'),order:['综合多选训练试卷01','综合多选训练试卷02']},
    {id:'mock-general',name:'模拟卷综合练习',catchAll:true,order:['考试卷 01','考试卷 02','考试卷 03','考试卷 04','考试卷 05','考试卷 06','考试卷 07','考试卷 08','考试卷 09','考试卷 10','考试卷 11','考试卷 12','考试卷 13','考试卷 14']},
    {id:'mainstream',name:'主流思路专项训练',match:name=>name.includes('专项试卷'),numbered:true},
  ];
  const RING_LENGTH=2*Math.PI*15.5;
  let activeCatId=CATEGORIES[0].id;
  let lastPayload=null;
  let accuracyByPaper=new Map();
  let accuracyToken=0;

  function paperName(row){return text(row?.name||row?.title||'未命名试卷')}

  function assignCategories(rows){
    const buckets=new Map(CATEGORIES.map(cat=>[cat.id,[]]));
    for(const row of rows){
      const name=paperName(row);
      let target=null;
      // catchAll 只作最终兜底：先跑完所有显式匹配，再收留剩余卷，避免截断后面的分类
      for(const cat of CATEGORIES){
        if(cat.catchAll)continue;
        if(typeof cat.match==='function'&&cat.match(name)){target=cat;break}
      }
      if(!target)target=CATEGORIES.find(cat=>cat.catchAll);
      (buckets.get(target?.id)||buckets.get('mock-general')).push(row);
    }
    for(const cat of CATEGORIES){
      const list=buckets.get(cat.id)||[];
      if(cat.fixed){
        const byName=new Map(list.map(row=>[paperName(row),row]));
        const ordered=cat.fixed.filter(Boolean).map(name=>byName.get(name)).filter(Boolean);
        const restNames=new Set(cat.fixed.filter(Boolean));
        const rest=list.filter(row=>!restNames.has(paperName(row)))
          .sort((a,b)=>Number(b?.publishedAt||0)-Number(a?.publishedAt||0));
        buckets.set(cat.id,[...ordered,...rest]);
      }else if(cat.order){
        // 固定名称顺序（如真题模考卷A-J、试卷01-14），不在 order 里的按发布时间排最后
        const idxOf=row=>{const i=cat.order.indexOf(paperName(row));return i===-1?Number.MAX_SAFE_INTEGER:i};
        list.sort((a,b)=>idxOf(a)-idxOf(b)||Number(b?.publishedAt||0)-Number(a?.publishedAt||0));
      }else if(cat.numbered){
        // 专项训练按名称里的序号排（专项试卷01 → 08），无序号的按发布时间兜底
        const numOf=row=>{const m=paperName(row).match(/(\d+)/);return m?Number(m[1]):Number.MAX_SAFE_INTEGER};
        list.sort((a,b)=>numOf(a)-numOf(b)||Number(b?.publishedAt||0)-Number(a?.publishedAt||0));
      }else{
        list.sort((a,b)=>Number(b?.publishedAt||0)-Number(a?.publishedAt||0));
      }
    }
    return buckets;
  }

  function coverageNumbers(row){
    const coverage=row?.coverage;
    if(!coverage||!(Number(coverage.totalCount)>0))return null;
    return {completed:Number(coverage.completedCount)||0,total:Number(coverage.totalCount)||0,remaining:Number(coverage.remainingUnseen)||0};
  }

  function ringMarkup(pct){
    const value=Math.max(0,Math.min(100,Math.round(Number(pct)||0)));
    const dash=(RING_LENGTH*value/100).toFixed(1);
    return '<svg class="practice-hall-ring" viewBox="0 0 36 36" role="img" aria-label="分类完成度 '+value+'%"><circle class="practice-hall-ring-bg" cx="18" cy="18" r="15.5"/><circle class="practice-hall-ring-fg" cx="18" cy="18" r="15.5" stroke-dasharray="'+dash+' '+RING_LENGTH.toFixed(1)+'" transform="rotate(-90 18 18)"/></svg>';
  }

  function categoryStats(rows){
    let completed=0,total=0,donePapers=0,covered=0;
    for(const row of rows){
      const numbers=coverageNumbers(row);
      if(!numbers)continue;
      covered+=1;completed+=numbers.completed;total+=numbers.total;
      if(numbers.total>0&&numbers.completed>=numbers.total)donePapers+=1;
    }
    return {count:rows.length,donePapers,covered,pct:total>0?completed/total*100:0};
  }

  function renderCategories(buckets,rows){
    const nav=global.document?.getElementById?.('practiceHallCategories');
    if(!nav)return;
    nav.innerHTML=CATEGORIES.map(cat=>{
      const list=buckets.get(cat.id)||[],stats=categoryStats(list);
      const active=cat.id===activeCatId;
      return '<button type="button" class="practice-hall-cat'+(active?' is-active':'')+'" data-hall-cat="'+esc(cat.id)+'" aria-pressed="'+active+'">'
        +ringMarkup(stats.pct)
        +'<span class="practice-hall-cat-text"><strong>'+esc(cat.name)+'</strong><small>'+stats.count+' 份试卷</small></span>'
        +'<span class="practice-hall-cat-arrow" aria-hidden="true">›</span></button>';
    }).join('');
    const papers=global.document?.getElementById?.('practiceHallStatPapers');
    const done=global.document?.getElementById?.('practiceHallStatDone');
    const progress=global.document?.getElementById?.('practiceHallStatProgress');
    const stats=categoryStats(rows);
    if(papers)papers.textContent=String(stats.count);
    if(done)done.textContent=String(stats.donePapers);
    if(progress)progress.textContent=Math.round(stats.pct)+'%';
  }

  function accuracyLabel(row){
    const stats=accuracyByPaper.get(text(row?.paperId||row?.id));
    if(!stats||!(stats.total>0))return '—';
    return Math.round(stats.correct/stats.total*100)+'%';
  }

  function pendingLabel(row,authenticated){
    if(!authenticated)return '—';
    const numbers=coverageNumbers(row);
    if(!numbers)return '—';
    return numbers.remaining+' 题';
  }

  function vipBadge(row){
    const member=String(row?.accessPolicy?.accessLevel||'free').toLowerCase()==='member';
    return member?'<span class="practice-hall-badge is-vip">会员</span>':'<span class="practice-hall-badge is-free">免费</span>';
  }

  function rowMarkup(row,seq){
    const id=text(row?.paperId||row?.id),count=Number(row?.questionCount||row?.totalCount||0);
    const minutes=Math.max(5,Math.round(count*1.3));
    const selected=id===text(lastPayload?.selectedPaperId);
    const latest=global.KGPaperPresentation?.isRecentPublication?.(row)?'<span class="practice-hall-latest">最新</span>':'';
    const allowed=row?.access?.allowed!==false;
    return '<div class="practice-hall-row'+(selected?' is-selected':'')+(allowed?'':' is-locked')+'" data-paper-id="'+esc(id)+'" data-hall-select="'+esc(id)+'">'
      +'<div class="practice-hall-row-name">'+(seq?'<span class="practice-hall-seq">'+seq+'</span>':'')+'<strong>'+esc(paperName(row))+'</strong>'+latest+vipBadge(row)+'</div>'
      +'<div class="practice-hall-cell"><span>共 '+count+' 题</span></div>'
      +'<div class="practice-hall-cell"><span>约 '+minutes+' 分钟</span></div>'
      +'<div class="practice-hall-cell"><span>正确率 '+esc(accuracyLabel(row))+'</span></div>'
      +'<div class="practice-hall-cell"><span>待完成 '+esc(pendingLabel(row,lastPayload?.authenticated))+'</span></div>'
      +'<button type="button" class="practice-hall-enter" data-hall-start="'+esc(id)+'">'+(allowed?'进入答题':'开通会员')+'</button>'
      +'</div>';
  }

  function renderRows(buckets,rows){
    const listRoot=global.document?.getElementById?.('practiceHallPaperList');
    const title=global.document?.getElementById?.('practiceHallCategoryTitle');
    const counter=global.document?.getElementById?.('practiceHallCategoryCount');
    if(!listRoot)return;
    const filtering=!!lastPayload?.filtering;
    if(filtering){
      if(title)title.textContent='搜索结果';
      if(counter)counter.textContent=rows.length?'共 '+rows.length+' 份试卷':'';
      listRoot.innerHTML=rows.length?rows.map(rowMarkup).join(''):'<div class="practice-hall-empty" role="status">没有找到匹配的试卷，试试其他关键词或清除筛选。</div>';
      return;
    }
    const cat=CATEGORIES.find(item=>item.id===activeCatId)||CATEGORIES[0];
    const list=buckets.get(cat.id)||[];
    if(title)title.textContent=cat.name;
    if(counter)counter.textContent=list.length?'共 '+list.length+' 份试卷':'';
    if(!list.length){
      listRoot.innerHTML='<div class="practice-hall-empty" role="status">'+esc(cat.emptyHint||'该分类暂无试卷')+'</div>';
      return;
    }
    listRoot.innerHTML=list.map((row,index)=>rowMarkup(row,cat.fixed?index+1:0)).join('');
  }

  let accuracyLoaded=false;
  async function loadAccuracy(payload){
    const api=global.KGPracticeLearningApi;
    if(!payload.authenticated||typeof api?.listSessions!=='function'||accuracyLoaded)return;
    accuracyLoaded=true;
    const token=++accuracyToken;
    try{
      const records=await api.listSessions({limit:100})||[];
      if(token!==accuracyToken)return;
      const byPaper=new Map();
      for(const record of records){
        const paperId=text(record.paperId);
        if(!paperId||byPaper.has(paperId))continue;
        const answered=Number(record.answered)||0;
        if(answered<=0)continue;
        const total=Math.max(answered,Number(record.total)||0);
        byPaper.set(paperId,{answered,total,correct:Math.min(answered,Math.max(0,Number(record.correct)||0))});
      }
      accuracyByPaper=byPaper;
      if(lastPayload)render(lastPayload);
    }catch(error){accuracyLoaded=false;/* 正确率列回退为 —，不影响主流程 */}
  }

  function render(payload){
    lastPayload=payload||lastPayload||{};
    const rows=Array.isArray(payload?.rows)?payload.rows:[];
    const allRows=Array.isArray(payload?.allRows)?payload.allRows:rows;
    const buckets=assignCategories(rows);
    if(!CATEGORIES.some(cat=>cat.id===activeCatId))activeCatId=CATEGORIES[0].id;
    renderCategories(buckets,allRows);
    renderRows(buckets,rows);
    void loadAccuracy(lastPayload);
  }

  function setCategory(catId){
    const found=CATEGORIES.find(cat=>cat.id===text(catId));
    if(!found)return;
    activeCatId=found.id;
    if(lastPayload)render(lastPayload);
  }

  global.KGPracticeHallCatalog=Object.freeze({render,setCategory,categories:CATEGORIES});
  if(typeof module!=='undefined'&&module.exports)module.exports={CATEGORIES,assignCategories};
})(typeof window!=='undefined'?window:globalThis);
