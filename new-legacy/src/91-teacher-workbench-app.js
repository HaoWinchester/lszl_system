'use strict';

(function(){
  const byId=id=>document.getElementById(id);
  let catalogState='pending';
  const readJson=(key,fallback)=>{
    try{
      const value=window.KGAppStorage?.readJSON?.(key,fallback);
      if(value!==undefined&&value!==null)return value;
      const parsed=JSON.parse(window.localStorage?.getItem?.(key)||'null');
      return parsed??fallback;
    }catch(error){return fallback}
  };
  const readList=key=>{const value=readJson(key,[]);return Array.isArray(value)?value:[]};

  function managedQuestions(snapshot){
    const banks=Array.isArray(snapshot?.banks)?snapshot.banks:[];
    const bankIds=new Set(banks.map(bank=>String(bank?.id||'')).filter(Boolean));
    const questions=Array.isArray(snapshot?.questions)?snapshot.questions:[];
    return questions.filter(question=>bankIds.has(String(question?.bankId||''))&&question?.lifecycle?.status!=='deleted'&&!question?.deletedAt);
  }
  function questionConfigured(question){
    const clues=Array.isArray(question?.clues)?question.clues:[];
    return clues.some(clue=>String(clue?.text||'').trim()&&(String(clue?.recallNodeId||'').trim()||clue?.sourceMode==='quick'));
  }
  function paperPublished(paper){return paper?.status==='published'||Number(paper?.publishedVersion||0)>0}
  function setText(id,value){const node=byId(id);if(node)node.textContent=String(value)}
  function setNext(title,description,label,href){
    setText('wbNextTitle',title);setText('wbNextDescription',description);setText('wbNextAction',label);
    const action=byId('wbNextAction');if(action)action.href=href;
  }
  function renderUnavailable(){
    const user=window.KGLearningContent?.currentUser?.();
    if(user)setText('wbAccount',`${user.name} · ${user.role}`);
    ['wbQuestionCount','wbTrainingPendingCount','wbPaperDraftCount','wbPublishedPaperCount'].forEach(id=>setText(id,'—'));
    setText('wbQuestionCardState','暂不可用');
    setText('wbTrainingCardState','暂不可用');
    setText('wbPaperCardState','暂不可用');
    setNext('暂时无法读取公共题库','服务器题目目录读取失败，请重新加载页面后再试。','重新加载','teacher-workbench.html');
  }
  function render(){
    const Core=window.KGLearningContent;if(!Core)return;
    const user=Core.currentUser();setText('wbAccount',`${user.name} · ${user.role}`);
    const catalog=window.KGQuestionCatalogAdapter?.snapshot?.()||{banks:[],questions:[]};
    const banks=Array.isArray(catalog.banks)?catalog.banks:[];
    const questions=managedQuestions(catalog);
    const pending=questions.filter(question=>!questionConfigured(question)).length;
    const papers=readList('kg_assessment_papers_v1');
    const courseDrafts=readList('kg_course_config_drafts_v1');
    const learningTasks=readList('kg_learning_tasks_v1');
    const activePapers=papers.filter(paper=>paper?.status!=='archived'&&!paper?.deletedAt);
    const paperDrafts=activePapers.filter(paper=>!paperPublished(paper));
    const publishedPapers=activePapers.filter(paper=>paperPublished(paper));

    if(document.body?.dataset){
      document.body.dataset.sharedBankCount=String(banks.length);
      document.body.dataset.sharedCourseCount=String(courseDrafts.length);
      document.body.dataset.sharedTaskCount=String(learningTasks.length);
    }

    setText('wbQuestionCount',questions.length);
    setText('wbTrainingPendingCount',pending);
    setText('wbPaperDraftCount',paperDrafts.length);
    setText('wbPublishedPaperCount',publishedPapers.length);
    setText('wbQuestionCardState',questions.length?`${questions.length} 道原题`:'录入第一道题');
    setText('wbTrainingCardState',pending?`${pending} 道待配置`:'训练配置已检查');
    setText('wbPaperCardState',activePapers.length?`${activePapers.length} 张试卷`:'创建第一张试卷');

    if(!questions.length){
      setNext('先录入第一道完整原题','从题干、A/B/C/D 选项、正确答案和解析开始。其他训练内容都可以从这道原题继续配置。','开始录题','question-bank.html?mode=simple&step=questions');
    }else if(pending){
      setNext('为原题补充训练配置',`当前有 ${pending} 道题还没有关键词或知识联想入口。完成后即可用于完整版深度回忆。`,'配置训练','question-bank.html?mode=simple&step=training');
    }else if(!activePapers.length){
      setNext('创建第一张学习试卷','题目和训练配置已经具备基础条件。下一步从题库选题、调整顺序并发布到做题模式。','创建试卷','paper-management.html');
    }else{
      setNext('继续检查试卷并发布',`当前有 ${paperDrafts.length} 张未发布草稿、${publishedPapers.length} 张已发布试卷。可继续选题、调整顺序或发布新版本。`,'打开试卷管理','paper-management.html');
    }
  }
  async function init(){
    const adapter=window.KGQuestionCatalogAdapter;
    if(!adapter){catalogState='failed';renderUnavailable();return}
    try{await adapter.ready}catch(error){catalogState='failed';renderUnavailable();return}
    catalogState='ready';
    render();
  }
  function renderAfterReady(){
    if(catalogState==='ready')render();
    else if(catalogState==='failed')renderUnavailable();
  }
  window.addEventListener('kg:question-catalog-changed',renderAfterReady);
  window.addEventListener('kg:server-state-reloaded',renderAfterReady);
  document.addEventListener('DOMContentLoaded',init);
})();
