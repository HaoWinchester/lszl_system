/* 答题页展示控件：复用答题、答题卡和标记的公共业务入口。 */
(function () {
  'use strict';
  function init() {
    const game = document.getElementById('practiceGame');
    const settings = document.getElementById('practiceReadingSettings');
    if (!game || !settings) return;
    const settingsTrigger = game.querySelector('[data-practice-action="settings"]');
    function closeSettings() {
      settings.hidden = true;
      settingsTrigger.setAttribute('aria-expanded', 'false');
    }
    game.addEventListener('click', event => {
      const action = event.target.closest('[data-practice-action]')?.dataset.practiceAction;
      if (!action) return;
      if (action === 'settings') {
        settings.hidden = !settings.hidden;
        settingsTrigger.setAttribute('aria-expanded', String(!settings.hidden));
        if (!settings.hidden) document.getElementById('practiceReadingSize').focus();
        return;
      }
      closeSettings();
      if (action === 'close-settings') settingsTrigger.focus();
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
    document.getElementById('practiceReadingSize').addEventListener('change', event => {
      game.dataset.readingSize = event.target.value;
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !settings.hidden) { closeSettings(); settingsTrigger.focus(); }
    });
    document.addEventListener('click', event => {
      if (!settings.hidden && !settings.contains(event.target) && !settingsTrigger.contains(event.target)) closeSettings();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
