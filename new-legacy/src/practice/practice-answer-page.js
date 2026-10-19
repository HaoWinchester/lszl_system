/* 答题页展示控件：复用答题、答题卡和标记的公共业务入口。 */
(function () {
  'use strict';
  function bindHelpPopovers() {
    const helps = [...document.querySelectorAll('.practice-standard-modes .practice-lobby-help')].map(detail => {
      const summary = detail.querySelector('summary');
      let pinned = false;
      let closeTimer;
      const cancelClose = () => window.clearTimeout(closeTimer);
      const close = () => { cancelClose(); pinned = false; detail.open = false; };
      const closeSoon = () => {
        cancelClose();
        closeTimer = window.setTimeout(() => {
          if (!pinned && !detail.contains(document.activeElement) && !detail.matches(':hover')) detail.open = false;
        }, 400);
      };
      detail.addEventListener('pointerenter', event => {
        cancelClose();
        if (event.pointerType !== 'touch') detail.open = true;
      });
      detail.addEventListener('pointerleave', closeSoon);
      detail.addEventListener('focusin', () => { cancelClose(); detail.open = true; });
      detail.addEventListener('focusout', event => {
        if (!detail.contains(event.relatedTarget)) closeSoon();
      });
      summary.addEventListener('click', event => {
        // Focus and hover may already have opened the native details element.
        event.preventDefault();
        cancelClose();
        pinned = !pinned;
        detail.open = pinned;
      });
      return {detail, close};
    });
    document.addEventListener('click', event => {
      helps.forEach(help => { if (!help.detail.contains(event.target)) help.close(); });
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') helps.forEach(help => help.close());
    });
  }
  function init() {
    const game = document.getElementById('practiceGame');
    if (!game) return;
    bindHelpPopovers();
    game.addEventListener('click', event => {
      const action = event.target.closest('[data-practice-action]')?.dataset.practiceAction;
      if (!action) return;
      if (action === 'question') {
        const stem = document.getElementById('practiceQuestionStem');
        stem.tabIndex = -1;
        stem.focus({preventScroll: true});
        stem.scrollIntoView({behavior: 'smooth', block: 'center'});
      }
      if (action === 'sheet') {
        document.getElementById('practiceAnswerSheetMobileBtn').click();
        document.querySelector('[data-answer-filter="all"]')?.click();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
