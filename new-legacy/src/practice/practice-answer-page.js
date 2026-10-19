/* 答题页展示控件：复用答题、答题卡和标记的公共业务入口。 */
(function () {
  'use strict';
  function bindHelpPopovers() {
    const helps = [...document.querySelectorAll('.practice-standard-modes .practice-lobby-help')].map(detail => {
      const summary = detail.querySelector('summary');
      const content = detail.querySelector('.practice-help-content');
      let pinned = false;
      let closeTimer;
      const position = () => {
        content.style.removeProperty('top');
        if (!detail.open || !window.matchMedia('(max-width:480px)').matches) return;
        // Narrow screens use a fixed popup. Keep it beside the trigger rather
        // than requiring the pointer to cross most of the screen to reach it.
        const trigger = summary.getBoundingClientRect(), height = content.getBoundingClientRect().height;
        const below = trigger.bottom + 8;
        const top = below + height <= window.innerHeight - 8 ? below : trigger.top - height - 8;
        content.style.top = Math.max(8, Math.min(window.innerHeight - height - 8, top)) + 'px';
      };
      const open = () => { if (!detail.open) { detail.open = true; position(); } };
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
        if (event.pointerType !== 'touch') open();
      });
      detail.addEventListener('pointerleave', closeSoon);
      detail.addEventListener('focusin', () => { cancelClose(); open(); });
      detail.addEventListener('focusout', event => {
        if (!detail.contains(event.relatedTarget)) closeSoon();
      });
      summary.addEventListener('click', event => {
        // Focus and hover may already have opened the native details element.
        event.preventDefault();
        cancelClose();
        pinned = !pinned;
        if (pinned) open(); else detail.open = false;
      });
      return {detail, close, position};
    });
    window.addEventListener('resize', () => helps.forEach(help => help.position()));
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
