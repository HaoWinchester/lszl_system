(function (global) {
  'use strict';
  function init(doc, request, usePhrase) {
    const $ = id => doc.getElementById(id), endpoint = '/api/v1/teacher-assistant/quick-phrases';
    let state = null, owner = '', editing = -1, saving = false, enabled = false;
    function button(parent, label, action) {
      const el = doc.createElement('button'); el.type = 'button'; el.textContent = label;
      el.onclick = action; parent.appendChild(el); return el;
    }
    function error(message) { $('phrase-error').textContent = message || ''; }
    function controls() {
      doc.querySelectorAll('#phrase-chips button, #phrase-suggestions button').forEach(el => { el.disabled = !enabled; });
      $('manage-phrases').disabled = !state;
      $('phrase-dialog').querySelectorAll('button,input,textarea').forEach(el => { el.disabled = saving; });
      $('phrase-save').disabled = saving || !state;
    }
    function reset() {
      editing = -1; $('phrase-title').value = ''; $('phrase-content').value = '';
      $('phrase-save').textContent = '添加话语';
    }
    function render() {
      $('phrase-chips').replaceChildren(); $('phrase-list').replaceChildren(); $('phrase-suggestions').replaceChildren();
      for (const item of (state?.defaults || []).slice(0, 2)) {
        button($('phrase-suggestions'), item.title + ' ↗', () => { if (enabled) usePhrase(item.content); });
      }
      for (const item of [...(state?.defaults || []), ...(state?.custom || [])]) {
        const el = button($('phrase-chips'), item.title, () => { if (enabled) usePhrase(item.content); });
        el.title = item.content;
      }
      (state?.custom || []).forEach((item, index) => {
        const row = doc.createElement('div'); row.className = 'ta-phrase-row';
        const label = doc.createElement('span'); label.textContent = item.title; row.appendChild(label);
        button(row, '编辑', () => {
          editing = index; $('phrase-title').value = item.title; $('phrase-content').value = item.content;
          $('phrase-save').textContent = '保存修改'; error(''); $('phrase-title').focus();
        });
        const remove = button(row, '删除', async () => {
          if (saving) return;
          if (!global.confirm('删除快捷话语“' + item.title + '”？')) return;
          await save(state.custom.filter((_, i) => i !== index));
        });
        remove.setAttribute('aria-label', '删除 ' + item.title);
        $('phrase-list').appendChild(row);
      });
      $('phrase-empty').hidden = Boolean(state?.custom.length);
      controls();
    }
    async function load(username) {
      if (username) owner = username;
      $('phrase-load-status').textContent = '正在读取快捷话语…'; $('phrase-retry').hidden = true;
      try {
        const result = await request(endpoint);
        if (result.username !== owner) throw new Error('登录账号已变化，请刷新页面。');
        state = result; render(); $('phrase-load-status').textContent = '';
      } catch (e) {
        state = null; render(); $('phrase-load-status').textContent = e.message; $('phrase-retry').hidden = false;
      }
    }
    async function save(custom) {
      if (saving || !state) return;
      saving = true; error(''); controls();
      try {
        state = await request(endpoint, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:owner, custom})});
        reset(); render(); error('已保存到当前账号。');
      } catch (e) { error(e.message || '保存失败，请重试。'); }
      finally { saving = false; controls(); }
    }
    $('manage-phrases').onclick = () => { reset(); error(''); $('phrase-dialog').showModal(); };
    $('phrase-close').onclick = () => { if (!saving) $('phrase-dialog').close(); };
    $('phrase-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    $('phrase-new').onclick = () => { reset(); error(''); $('phrase-title').focus(); };
    $('phrase-retry').onclick = () => load();
    $('phrase-form').onsubmit = event => {
      event.preventDefault(); if (saving || !state) return;
      const title = $('phrase-title').value.trim(), content = $('phrase-content').value.trim();
      if (!title || !content) { error('请填写名称和话语内容。'); return; }
      if (title.length > 30 || content.length > 2000) { error('名称最多 30 字，内容最多 2000 字。'); return; }
      if (editing < 0 && state.custom.length >= 20) { error('最多保存 20 条个人话语，请先编辑或删除已有话语。'); return; }
      const custom = [...state.custom]; if (editing < 0) custom.push({title, content}); else custom[editing] = {title, content};
      save(custom);
    };
    render();
    return { load, setEnabled(value) { enabled = value; controls(); } };
  }
  global.KGAssistantPhrases = { init };
})(typeof window !== 'undefined' ? window : globalThis);
