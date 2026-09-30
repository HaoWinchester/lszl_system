(function (global) {
  'use strict';
  let dialogSequence = 0;
  function choose(options) {
    const doc = global.document;
    return new Promise(resolve => {
      const previous = doc.activeElement;
      const dialog = doc.createElement('dialog');
      dialog.className = 'kg-unsaved-dialog';
      const titleId = 'kg-unsaved-title-' + (++dialogSequence);
      dialog.setAttribute('aria-labelledby', titleId);
      dialog.style.cssText = 'max-width:440px;width:calc(100% - 40px);padding:24px;border:1px solid #ddd;border-radius:16px;color:#252525;background:white;box-shadow:0 16px 60px #0003';
      const title = doc.createElement('h2'); title.id = titleId; title.textContent = options.title || '有尚未保存的修改';
      const message = doc.createElement('p'); message.textContent = options.message || '离开前可以保存修改，或放弃修改后继续。';
      const actions = doc.createElement('div'); actions.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-top:24px';
      function finish(value) { dialog.close(); dialog.remove(); previous?.focus?.(); resolve(value); }
      [['stay', '继续编辑'], ['discard', options.discardLabel || '放弃修改'], ...(options.save ? [['save', '保存并继续']] : [])].forEach(([value, label]) => {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
        button.dataset.unsavedChoice = value; button.style.cssText = 'padding:10px 14px;border:1px solid #ccc;border-radius:8px;cursor:pointer';
        button.onclick = () => finish(value); actions.append(button);
      });
      dialog.append(title, message, actions); doc.body.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish('stay'); });
      dialog.showModal(); actions.firstElementChild.focus();
    });
  }
  function create(options) {
    let baseline = JSON.stringify(options.read()), pending = false;
    const isDirty = () => JSON.stringify(options.read()) !== baseline;
    const markClean = () => { baseline = JSON.stringify(options.read()); };
    async function confirmLeave() {
      if (pending) return false;
      if (!isDirty()) return true;
      pending = true;
      try {
        const decision = await (options.choose || choose)(options);
        if (decision === 'discard') { await options.discard?.(); markClean(); return true; }
        if (decision === 'save' && options.save) return (await options.save()) === true && !isDirty();
        return false;
      } catch (error) { options.onError?.(error); return false; }
      finally { pending = false; }
    }
    function beforeUnload(event) { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } }
    // Internal navigation can offer save/discard/stay. Browser refresh/close uses
    // the browser's own confirmation and must never initiate a write or upload.
    async function click(event) {
      const link = event.target.closest?.('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.download || (link.target && link.target !== '_self') || !isDirty()) return;
      const url = new URL(link.href, global.location.href);
      if (!['http:', 'https:'].includes(url.protocol) || (url.pathname === global.location.pathname && url.search === global.location.search && url.hash)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (await confirmLeave()) global.location.assign(url.href);
    }
    global.addEventListener('beforeunload', beforeUnload);
    global.document?.addEventListener('click', click, true);
    return { isDirty, markClean, confirmLeave, destroy() { global.removeEventListener('beforeunload', beforeUnload); global.document?.removeEventListener('click', click, true); } };
  }
  global.KGUnsavedGuard = { create };
})(typeof window !== 'undefined' ? window : globalThis);
