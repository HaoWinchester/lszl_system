/* 答题页展示控件：复用答题、答题卡和标记的公共业务入口。 */
(function () {
  'use strict';
  function init() {
    const game = document.getElementById('practiceGame');
    if (!game) return;
    game.addEventListener('click', event => {
      const action = event.target.closest('[data-practice-action]')?.dataset.practiceAction;
      if (!action) return;
      if (action === 'question') {
        const stem = document.getElementById('practiceQuestionStem');
        stem.tabIndex = -1;
        stem.focus({preventScroll: true});
        stem.scrollIntoView({behavior: 'smooth', block: 'center'});
      }
      if (action === 'sheet' || action === 'marked') {
        document.getElementById('practiceAnswerSheetMobileBtn').click();
        document.querySelector('[data-answer-filter="' + (action === 'marked' ? 'marked' : 'all') + '"]')?.click();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
