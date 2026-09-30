'use strict';

(function(){
  const byId=id=>document.getElementById(id);
  let catalogState='pending';
  let paperRows=[];

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
  function paperPublished(paper){return paper?.status==='published'}
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
    const papers=paperRows;
    const courseSnapshot=window.KGCourseManagementApi?.snapshot?.()||{drafts:[],tasks:[]};
    const courseDrafts=courseSnapshot.drafts||[];
    const learningTasks=courseSnapshot.tasks||[];
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

    const latestDraft=paperDrafts.slice().sort((a,b)=>{
      const stamp=value=>typeof value==='number'?value:(Date.parse(value)||0);
      return stamp(b.updatedAt)-stamp(a.updatedAt);
    })[0];
    if(latestDraft){
      setNext('继续检查草稿并发布',`最近草稿“${latestDraft.name||latestDraft.title||'未命名试卷'}”。核对题目与学习模式后，即可发布练习。`,'继续这份草稿','paper-management.html?paper='+encodeURIComponent(latestDraft.id));
    }else if(!questions.length){
      setNext('先导入或录入题目','上传一份试卷整理题干、选项、答案和解析，也可以手动录题。','上传资料','teacher-assistant.html');
    }else if(!activePapers.length){
      setNext('创建第一张学习试卷','从题库选题、调整顺序并发布练习。普通刷题无需先配置全部深度回忆内容。','创建试卷','paper-management.html');
    }else if(pending){
      setNext('准备深度回忆内容',`已有 ${publishedPapers.length} 张发布试卷。若要开放深度回忆，可为 ${pending} 道题补充关键词与知识联想；普通刷题可继续使用。`,'配置深度回忆','question-bank.html?mode=simple&step=training');
    }else{
      setNext('查看发布情况',`当前有 ${publishedPapers.length} 张已发布试卷，可核对学员可见内容或准备下一份练习。`,'打开试卷管理','paper-management.html');
    }
  }
  async function init(){
    const adapter=window.KGQuestionCatalogAdapter,courseApi=window.KGCourseManagementApi,domainApi=window.KGDomainApi;
    if(!adapter||!courseApi||!domainApi){catalogState='failed';renderUnavailable();return}
    try{const [,courseState,paperResult]=await Promise.all([adapter.ready,courseApi.ready(),domainApi.request({path:'/api/v1/papers'})]);paperRows=Array.isArray(paperResult?.papers)?paperResult.papers:[];if(!courseState)throw new Error('课程数据未就绪')}catch(error){catalogState='failed';renderUnavailable();return}
    catalogState='ready';
    render();
  }
  function renderAfterReady(){
    if(catalogState==='ready')render();
    else if(catalogState==='failed')renderUnavailable();
  }
  window.addEventListener('kg:question-catalog-changed',renderAfterReady);
  window.addEventListener('kg:course-management-changed',renderAfterReady);
  document.addEventListener('DOMContentLoaded',()=>{void init()});
})();
