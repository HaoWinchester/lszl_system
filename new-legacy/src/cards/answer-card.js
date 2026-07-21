'use strict';

/*
 * AnswerCard v1
 * 第一张可插拔学习卡。拥有题干、选项、信心选择和作答交互。
 * v1.1 将关键词交互交给第二张画布卡，作答卡只管理独立判断。
 */
(function(global){
  const CARD_ID='answer-card';

  function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }
  function optionId(value){return String(value??'')}

  function createAnswerCard(context){
    let host=null;
    let mode='guided';
    let mounted=false;
    let clickHandler=null;
    let changeHandler=null;

    function template(){
      return '<article class="learning-card answer-card" data-answer-card>'
        +'<div class="answer-card-body">'
          +'<div class="q-paper-bar qt-paper-context" id="qPaperBar">'
            +'<label>学习内容<select id="qPaperSelect"><option value="">单题 / 当前题库训练</option></select></label>'
            +'<button type="button" id="qStartPaperBtn">开始试卷</button>'
            +'<button type="button" id="qExitPaperBtn">退出试卷</button>'
            +'<span id="qPaperProgress">当前单题</span>'
          +'</div>'
          +'<h3 id="qQuestionHeading">题目</h3>'
          +'<div class="q-stem" id="qStem"></div>'
          +'<div class="q-options" id="qOptions"></div>'
          +'<fieldset class="qt-confidence" id="qtConfidenceGroup">'
            +'<legend>这次判断你有多确定？</legend>'
            +'<label><input type="radio" name="qtConfidence" value="low"><span>不确定</span></label>'
            +'<label><input type="radio" name="qtConfidence" value="medium"><span>比较确定</span></label>'
            +'<label><input type="radio" name="qtConfidence" value="high"><span>非常确定</span></label>'
          +'</fieldset>'
          +'<div class="q-actions qt-legacy-question-actions">'
            +'<button id="qPrevQuestionBtn">上一题</button><button id="qNextQuestionBtn">下一题</button>'
            +'<button class="primary" id="qSubmitBtn">提交答案</button><button id="qResetBtn">重置本题</button>'
            +'<button id="qDeepRecallBtn" type="button">深度回忆</button>'
          +'</div>'
          +'<div class="q-mini-note" id="qtQuestionHint">先独立选择答案。提交本步骤后，系统才会引导你寻找决定答案的关键词。</div>'
        +'</div>'
      +'</article>';
    }
    function question(){
      return context.question()||{};
    }
    function session(){
      return context.session()||{};
    }
    function legacyState(){
      try{
        if(typeof qEnsureReasoningState==='function')qEnsureReasoningState();
        return typeof qMvpState!=='undefined'?qMvpState:null;
      }catch(e){return null}
    }
    function renderStem(q,state){
      const el=host?.querySelector('#qStem');
      if(!el)return;
      const found=state?.found instanceof Set?state.found:new Set(session().activation?.selectedKeywordIds||[]);
      el.innerHTML=(q.stemParts||[]).map(part=>{
        if(!part.clue)return escapeHTML(part.text);
        return '<span class="q-clue'+(found.has(String(part.clue))?' found':'')+'" title="关键词将在第2张卡中选择">'+escapeHTML(part.text)+'</span>';
      }).join('');
    }
    function renderOptions(q,state){
      const el=host?.querySelector('#qOptions');
      if(!el)return;
      const selected=optionId(state?.selected||session().answer?.selectedOptionId);
      const submitted=!!(state?.submitted||session().answer?.submitted);
      el.innerHTML=(q.options||[]).map(option=>{
        const id=optionId(option.id);
        let cls='q-option';
        if(selected===id)cls+=' selected';
        if(submitted){
          if(option.correct||id===optionId(q.correctAnswer))cls+=' correct';
          else if(selected===id)cls+=' wrong';
        }
        return '<button type="button" class="'+cls+'" data-option-id="'+escapeHTML(id)+'" aria-pressed="'+(selected===id?'true':'false')+'">'
          +'<strong>'+escapeHTML(id)+'.</strong> '+escapeHTML(option.text)
          +'</button>';
      }).join('');
    }
    function renderConfidence(currentSession){
      const confidence=String(currentSession?.confidence||'');
      host?.querySelectorAll('input[name="qtConfidence"]').forEach(input=>{
        input.checked=input.value===confidence;
      });
    }
    function renderPaper(){
      try{
        if(typeof renderPaperControls==='function')renderPaperControls();
        if(typeof bindQuestionBankManager==='function')bindQuestionBankManager();
        if(typeof bindQuestionTrainer==='function')bindQuestionTrainer();
      }catch(e){}
    }
    function refreshSupportingPanels(){
      try{
        if(typeof renderQClues==='function')renderQClues();
        if(typeof renderQScore==='function')renderQScore();
        if(typeof renderQGraph==='function')renderQGraph();
        if(typeof renderQDetectiveNotes==='function')renderQDetectiveNotes();
        if(typeof renderQReview==='function')renderQReview();
      }catch(error){console.warn('AnswerCard supporting render error',error)}
    }
    function render(){
      if(!host)return;
      const q=question();
      const currentSession=session();
      const state=legacyState();
      const heading=host.querySelector('#qQuestionHeading');
      if(heading)heading.textContent='题目：'+String(q.title||'未命名题目');
      renderStem(q,state);
      renderOptions(q,state);
      renderConfidence(currentSession);
      renderPaper();
      host.dataset.cardMode=mode;
      const surface=host.querySelector('[data-answer-card]');
      if(surface)surface.dataset.cardMode=mode;
      host.dataset.cardQuestionId=String(q.sourceQuestionId||q.id||'');
    }
    function canOperate(message){
      try{
        if(typeof qCanOperateCurrentQuestion==='function')return qCanOperateCurrentQuestion(message);
      }catch(e){}
      return true;
    }
    function handleOption(button){
      if(!canOperate('当前角色不能选择这道题的答案。'))return;
      const state=legacyState();
      if(state?.submitted)return;
      context.dispatch({type:'ANSWER_SELECTED',payload:{optionId:button.dataset.optionId}});
      render();
      refreshSupportingPanels();
    }
    function handleClick(event){
      const option=event.target.closest?.('[data-option-id]');
      if(option&&host.contains(option)){handleOption(option);return}
      if(event.target.closest?.('#qResetBtn')){
        if(typeof resetQuestionTrainer==='function')resetQuestionTrainer();
        return;
      }
      if(event.target.closest?.('#qDeepRecallBtn')){
        if(typeof qOpenDeepRecallPage==='function')qOpenDeepRecallPage();
        return;
      }
      if(event.target.closest?.('#qPrevQuestionBtn'))global.KGQuestionNavigator?.move?.(-1);
      if(event.target.closest?.('#qNextQuestionBtn'))global.KGQuestionNavigator?.move?.(1);
    }
    function handleChange(event){
      const input=event.target.closest?.('input[name="qtConfidence"]');
      if(!input||!host.contains(input))return;
      context.dispatch({type:'CONFIDENCE_SELECTED',payload:{confidence:input.value}});
    }

    return {
      async mount(nextHost){
        host=nextHost;
        host.innerHTML=template();
        clickHandler=handleClick;
        changeHandler=handleChange;
        host.addEventListener('click',clickHandler);
        host.addEventListener('change',changeHandler);
        mounted=true;
        render();
      },
      async update(){
        if(!mounted)return;
        render();
      },
      validate(){
        const state=legacyState();
        const currentSession=session();
        const errors=[];
        if(!String(state?.selected||currentSession.answer?.selectedOptionId||'')){
          errors.push({code:'ANSWER_REQUIRED',field:'selectedOptionId',message:'请先选择一个答案。'});
        }
        if(!String(currentSession.confidence||'')){
          errors.push({code:'CONFIDENCE_REQUIRED',field:'confidence',message:'请选择这次判断的信心程度。'});
        }
        return {valid:errors.length===0,errors};
      },
      snapshot(){
        const state=legacyState();
        const currentSession=session();
        return {
          cardId:CARD_ID,
          questionId:String(question().sourceQuestionId||question().id||''),
          selectedOptionId:String(state?.selected||currentSession.answer?.selectedOptionId||''),
          confidence:String(currentSession.confidence||''),
          submitted:!!(state?.submitted||currentSession.answer?.submitted)
        };
      },
      setMode(nextMode){
        mode=nextMode==='explore'?'explore':'guided';
        if(host){
          host.dataset.cardMode=mode;
          const surface=host.querySelector('[data-answer-card]');
          if(surface)surface.dataset.cardMode=mode;
        }
      },
      focus(){
        host?.scrollIntoView?.({behavior:'smooth',block:'center'});
        host?.querySelector?.('.q-option')?.focus?.({preventScroll:true});
      },
      reset(){
        context.dispatch({type:'ANSWER_CARD_RESET',payload:{}});
        render();
      },
      destroy(){
        if(host&&clickHandler)host.removeEventListener('click',clickHandler);
        if(host&&changeHandler)host.removeEventListener('change',changeHandler);
        if(host)host.innerHTML='';
        mounted=false;
        host=null;
      }
    };
  }

  global.KGCardRegistry?.register?.({
    id:CARD_ID,
    version:'1.1.0',
    title:'独立作答卡',
    description:'管理题干、选项、信心和第一步作答状态。',
    loadPolicy:'eager',
    styleIsolation:'scoped',
    create:createAnswerCard
  });
})(window);
