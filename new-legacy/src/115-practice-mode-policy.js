'use strict';
;(function(global){
  function forMode(mode,{reviewOnly=false,instantFeedback=true}={}){
    const showCorrectness=reviewOnly||mode!=='practice'||instantFeedback!==false;
    const known=['challenge','scholar','practice','revenge'].includes(mode);
    return Object.freeze({
      canAnswer:known&&!reviewOnly,
      canExplain:reviewOnly||(mode==='practice'&&showCorrectness),
      showCorrectness,
      autoAdvance:known&&!reviewOnly&&(mode!=='practice'||!showCorrectness),
      canSubmit:!reviewOnly&&mode==='revenge',
      showHealth:!reviewOnly&&['challenge','scholar'].includes(mode),
      showTimer:!reviewOnly&&mode==='scholar',
      autoComplete:!reviewOnly&&['challenge','scholar','practice'].includes(mode),
    });
  }
  global.KGPracticeModePolicy=Object.freeze({forMode});
})(window);
