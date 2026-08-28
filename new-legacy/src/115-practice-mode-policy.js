'use strict';
;(function(global){
  function forMode(mode,{reviewOnly=false}={}){
    const known=['challenge','scholar','practice','revenge'].includes(mode);
    return Object.freeze({
      canAnswer:known&&!reviewOnly,
      canExplain:reviewOnly||mode==='practice',
      canSubmit:!reviewOnly&&mode==='revenge',
      showHealth:!reviewOnly&&['challenge','scholar'].includes(mode),
      showTimer:!reviewOnly&&mode==='scholar',
      autoComplete:!reviewOnly&&['challenge','scholar','practice'].includes(mode),
    });
  }
  global.KGPracticeModePolicy=Object.freeze({forMode});
})(window);
