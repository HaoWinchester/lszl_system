'use strict';

(function(){
  const byId=id=>document.getElementById(id);
  const readJson=(key,fallback)=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return value??fallback}catch(error){return fallback}};

  function currentUsername(){
    try{return String(window.KGAuthCore?.currentUsername?.()||localStorage.getItem('kg_local_current_user_v1')||'')}catch(error){return ''}
  }
  function questionBanks(){
    const username=currentUsername();
    const scope=username?'user__'+encodeURIComponent(username):'public';
    const primary=readJson('kg_question_banks_v1__'+scope,[]);
    if(Array.isArray(primary)&&primary.length)return primary;
    const published=readJson('kg_question_banks_published_v1',[]);
    return Array.isArray(published)?published:[];
  }
  function questionConfigured(question){
    const clues=Array.isArray(question?.clues)?question.clues:[];
    return clues.some(clue=>String(clue?.text||'').trim()&&(String(clue?.recallNodeId||'').trim()||clue?.sourceMode==='quick'));
  }
  function setText(id,value){const node=byId(id);if(node)node.textContent=String(value)}
  function setNext(title,description,label,href){
    setText('wbNextTitle',title);setText('wbNextDescription',description);setText('wbNextAction',label);
    const action=byId('wbNextAction');if(action)action.href=href;
  }
  function init(){
    const Core=window.KGLearningContent;if(!Core)return;
    const user=Core.currentUser();setText('wbAccount',`${user.name} · ${user.role}`);
    const banks=questionBanks();
    const questions=banks.flatMap(bank=>Array.isArray(bank?.questions)?bank.questions.filter(question=>question?.lifecycle?.status!=='deleted'&&!question?.deletedAt):[]);
    const pending=questions.filter(question=>!questionConfigured(question)).length;
    const username=currentUsername();
    const scope=username?'user__'+encodeURIComponent(username):'public';
    const ownPapers=readJson('kg_exam_papers_v1__'+scope,[]);
    const papers=Array.isArray(ownPapers)?ownPapers:[];
    const paperDrafts=papers.filter(paper=>paper?.status!=='archived'&&Number(paper?.publishedVersion||0)===0);
    const publishedPapers=papers.filter(paper=>paper?.status!=='archived'&&Number(paper?.publishedVersion||0)>0);

    setText('wbQuestionCount',questions.length);
    setText('wbTrainingPendingCount',pending);
    setText('wbPaperDraftCount',paperDrafts.length);
    setText('wbPublishedPaperCount',publishedPapers.length);
    setText('wbQuestionCardState',questions.length?`${questions.length} 道原题`:'录入第一道题');
    setText('wbTrainingCardState',pending?`${pending} 道待配置`:'训练配置已检查');
    setText('wbPaperCardState',papers.length?`${papers.length} 张试卷`:'创建第一张试卷');

    if(!questions.length){
      setNext('先录入第一道完整原题','从题干、A/B/C/D 选项、正确答案和解析开始。其他训练内容都可以从这道原题继续配置。','开始录题','question-bank.html?mode=simple&step=questions');
    }else if(pending){
      setNext('为原题补充训练配置',`当前有 ${pending} 道题还没有关键词或知识联想入口。完成后即可用于完整版深度回忆。`,'配置训练','question-bank.html?mode=simple&step=training');
    }else if(!papers.length){
      setNext('创建第一张学习试卷','题目和训练配置已经具备基础条件。下一步从题库选题、调整顺序并发布到做题模式。','创建试卷','paper-management.html');
    }else{
      setNext('继续检查试卷并发布',`当前有 ${paperDrafts.length} 张未发布草稿、${publishedPapers.length} 张已发布试卷。可继续选题、调整顺序或发布新版本。`,'打开试卷管理','paper-management.html');
    }
  }
  document.addEventListener('DOMContentLoaded',init);
})();
