/* 首页画布：手机端仅查看提示。该提示仅管理当前页面的临时展示，不写入浏览器存储。 */
(function(global){
  'use strict';

  function isMobileCanvas(){
    const narrow=global.matchMedia?.('(max-width: 720px)').matches;
    const coarse=global.matchMedia?.('(pointer: coarse)').matches;
    const mobileUA=/Android.+Mobile|iPhone|iPod|Windows Phone|Mobile Safari/i.test(String(global.navigator?.userAgent||''));
    return !!(narrow||mobileUA||(coarse&&global.innerWidth<=850));
  }

  function show(){
    if(!isMobileCanvas()||document.getElementById('homeMobileReadonlyNotice'))return false;
    const notice=document.createElement('section');
    notice.id='homeMobileReadonlyNotice';
    notice.className='home-mobile-readonly-notice';
    notice.setAttribute('role','dialog');
    notice.setAttribute('aria-modal','false');
    notice.setAttribute('aria-labelledby','homeMobileReadonlyNoticeTitle');
    notice.innerHTML='<span class="home-mobile-readonly-icon" aria-hidden="true">⌾</span><div><strong id="homeMobileReadonlyNoticeTitle">移动端查看模式</strong><p>幻谱移动端目前仅支持查看模式，如需编辑请使用 PC 端。</p></div><button type="button" data-home-mobile-readonly-confirm>确定</button>';
    document.body.appendChild(notice);
    requestAnimationFrame(()=>{
      document.body.classList.add('home-mobile-readonly-notice-open');
      document.documentElement.style.setProperty('--home-mobile-readonly-offset',`${Math.ceil(notice.getBoundingClientRect().bottom)+12}px`);
    });
    notice.querySelector('[data-home-mobile-readonly-confirm]')?.addEventListener('click',()=>{
      document.body.classList.remove('home-mobile-readonly-notice-open');
      document.documentElement.style.removeProperty('--home-mobile-readonly-offset');
      notice.remove();
    });
    return true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});
  else show();
  global.KGHomeMobileReadonlyNotice=Object.freeze({show,isMobileCanvas});
})(window);
