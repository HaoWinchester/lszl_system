'use strict';
(function(global){
  const REQUIRED_METHODS=['read','write','remove','exists','keys','snapshot','restore','health'];
  function assertRepository(repository){
    const missing=REQUIRED_METHODS.filter(name=>typeof repository?.[name]!=='function');
    if(missing.length)throw new TypeError('ContentRepository 缺少方法：'+missing.join(', '));
    return repository;
  }
  function contract(repository){return {valid:REQUIRED_METHODS.every(name=>typeof repository?.[name]==='function'),missing:REQUIRED_METHODS.filter(name=>typeof repository?.[name]!=='function')};}
  global.KGContentRepository=Object.freeze({REQUIRED_METHODS:Object.freeze(REQUIRED_METHODS.slice()),assertRepository,contract});
})(window);
