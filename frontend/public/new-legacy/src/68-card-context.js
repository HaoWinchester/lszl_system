'use strict';

/*
 * CardContext
 * 为卡片提供受控的数据与命令入口。卡片不直接访问存储或网络。
 */
(function(global){
  class CardContext{
    constructor(options={}){
      this.cardId=String(options.cardId||'');
      this.host=options.host||null;
      this.runtime=options.runtime||null;
      this.services=Object.freeze({
        questions:global.KGQuestionRepository||null,
        sessions:global.KGLearningSessionStore||null,
        events:global.KGLearningEventRepository||null,
        flow:global.KGFlowOrchestrator||null
      });
      Object.freeze(this.services);
    }
    question(){
      return this.services.questions?.current?.()||null;
    }
    questionDescriptor(){
      return this.services.questions?.descriptor?.()||null;
    }
    session(){
      return this.services.flow?.current?.()||null;
    }
    mode(){
      return this.session()?.mode||'guided';
    }
    dispatch(command){
      return this.runtime?.dispatch?.(command,{cardId:this.cardId})||null;
    }
    emit(type,detail={}){
      const eventDetail={cardId:this.cardId,...detail};
      try{global.dispatchEvent(new CustomEvent(type,{detail:eventDetail}))}catch(e){}
      return eventDetail;
    }
    notify(message){
      if(typeof showStatus==='function')showStatus(String(message||''));
      else console.info(message);
    }
  }

  global.KGCardContext=CardContext;
})(window);
