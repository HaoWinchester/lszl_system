/* 答题页展示控件：复用答题、答题卡和标记的公共业务入口。 */
(function () {
  'use strict';
  function positionHelp(trigger, content, {preferAbove = false} = {}) {
    if (!trigger.getClientRects().length || !content.getClientRects().length) return;
    content.style.removeProperty('top');
    if (preferAbove) {
      content.style.position = 'fixed';
      content.style.right = 'auto';
      content.style.bottom = 'auto';
      content.style.width = Math.min(window.innerWidth - 28, window.innerWidth <= 480 ? window.innerWidth : 280) + 'px';
      content.style.maxHeight = (window.innerHeight - 16) + 'px';
      content.style.overflowY = 'auto';
    }
    const anchor = trigger.getBoundingClientRect();
    let height = content.getBoundingClientRect().height;
    const above = Math.max(0, anchor.top - 16), below = Math.max(0, window.innerHeight - anchor.bottom - 16);
    const useAbove = preferAbove ? above >= Math.min(height, 80) || above >= below : anchor.bottom + height + 8 > window.innerHeight - 8;
    if (preferAbove) {
      content.style.maxHeight = (useAbove ? above : below) + 'px';
      height = content.getBoundingClientRect().height;
      const width = content.getBoundingClientRect().width;
      content.style.left = Math.max(14, Math.min(window.innerWidth - width - 14, anchor.right - width)) + 'px';
    }
    const top = useAbove ? anchor.top - height - 8 : anchor.bottom + 8;
    const viewportTop = Math.max(8, Math.min(window.innerHeight - height - 8, top));
    const fixed = getComputedStyle(content).position === 'fixed';
    content.style.top = (fixed ? viewportTop : viewportTop - content.offsetParent.getBoundingClientRect().top) + 'px';
  }
  window.KGPracticeHelpPopovers = Object.freeze({position: positionHelp});
  function bindHelpPopovers() {
    const helps = [...document.querySelectorAll('.practice-standard-modes .practice-lobby-help')].map(detail => {
      const summary = detail.querySelector('summary');
      const content = detail.querySelector('.practice-help-content');
      let pinned = false;
      let closeTimer;
      const position = () => {
        content.style.removeProperty('top');
        if (!detail.open) return;
        positionHelp(summary, content);
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
    const repositionRevenge = () => {
      const trigger = document.getElementById('practiceRevengeRuleTrigger');
      const content = document.getElementById('practiceRevengeRuleTooltip');
      if (trigger && content && !content.hidden) positionHelp(trigger, content, {preferAbove: true});
    };
    window.addEventListener('resize', () => { helps.forEach(help => help.position()); repositionRevenge(); });
    window.addEventListener('scroll', event => {
      if (!event.target.closest?.('.practice-help-content,.practice-revenge-rule-tooltip')) repositionRevenge();
    }, true);
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
