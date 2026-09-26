(function (global) {
  'use strict';
  const BASE = '/api/v1/teacher-assistant';
  const activeJob = session => ['queued', 'running'].includes(session?.job?.status);
  function validateFiles(files) {
    if (!files.length) throw new Error('请先选择文件。');
    if (files.length > 5) throw new Error('一次最多上传 5 份文件，请分批上传。');
    let total = 0;
    for (const file of files) {
      if (!/\.(json|docx?|pdf|pptx?)$/i.test(file.name)) throw new Error('仅支持 JSON、Word、PDF 和 PPT 文件。');
      if (file.size > 20 * 1024 * 1024) throw new Error(file.name + ' 超过 20 MiB，请拆分文件。');
      total += file.size;
    }
    if (total > 50 * 1024 * 1024) throw new Error('本批文件超过 50 MiB，请分批上传。');
    return files;
  }
  function createClient(fetcher, uuid) {
    let session = null;
    let pending = false;
    const keys = new Map();
    // Browser storage contains only short-lived opaque operation IDs, never conversations or uploads.
    function operationSlot(identity) {
      let hash = 2166136261;
      for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      return 'kg-teacher-assistant-operation-' + (hash >>> 0).toString(16);
    }
    function readKey(slot) { try { return global.sessionStorage?.getItem(slot); } catch (_) { return null; } }
    function writeKey(slot, value) { try { if (value) global.sessionStorage?.setItem(slot, value); else global.sessionStorage?.removeItem(slot); } catch (_) { /* memory fallback */ } }
    async function request(path, options = {}) {
      const response = await fetcher(path, { credentials: 'same-origin', ...options });
      if (response.status === 204) return null;
      let payload;
      try { payload = await response.json(); } catch (_) { throw new Error('服务器返回了无法读取的结果，请刷新状态后重试。'); }
      if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || payload?.message || '请求失败（' + response.status + '），请重试。');
      }
      return payload;
    }
    async function load(id) { const data = await request(BASE + '/sessions/' + encodeURIComponent(id)); session = data.session; return session; }
    async function mutate(action, body = {}) {
      if (pending) throw new Error('正在提交，请等待当前请求完成。');
      if (!session) throw new Error('请先新建或选择会话。');
      pending = true;
      const id = session.id;
      const identity = id + ':' + action + ':' + JSON.stringify(body);
      const slot = operationSlot(identity);
      if (!keys.has(identity)) keys.set(identity, readKey(slot) || uuid());
      writeKey(slot, keys.get(identity));
      const keyed = ['messages', 'execute', 'retry'].includes(action);
      try {
        const data = await request(BASE + '/sessions/' + encodeURIComponent(id) + '/' + action, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(keyed ? { ...body, requestId: keys.get(identity) } : body),
        });
        session = data.session;
        keys.delete(identity); writeKey(slot, null);
        return session;
      } catch (error) {
        // A lost response may have committed. Reconcile before offering the same operation key again.
        try { await load(id); } catch (_) { /* retain operation key and caller input */ }
        throw error;
      } finally { pending = false; }
    }
    return {
      request, load, mutate,
      get session() { return session; }, get pending() { return pending; },
      async list() { return (await request(BASE + '/sessions')).sessions || []; },
      async create() { const data = await request(BASE + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); session = data.session; return session; },
      async remove() { if (!session) return; await request(BASE + '/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' }); session = null; },
      async upload(files) {
        validateFiles(files);
        if (!session) throw new Error('请先新建或选择会话。');
        const form = new global.FormData(); files.forEach(file => form.append('files', file));
        const data = await request(BASE + '/sessions/' + encodeURIComponent(session.id) + '/uploads', { method: 'POST', body: form });
        session = data.session; return session;
      },
    };
  }
  function init(doc) {
    const $ = id => doc.getElementById(id);
    const client = createClient(global.fetch.bind(global), () => global.crypto.randomUUID());
    let authorized = false, busy = false, pollTimer = null, epoch = 0;
    $('assistant').dataset.tab = 'conversation';
    function text(parent, tag, value, className) { const el = doc.createElement(tag); el.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''); if (className) el.className = className; parent.appendChild(el); return el; }
    function link(parent, label, url) {
      if (!url) return;
      let parsed; try { parsed = new URL(url, global.location.href); } catch (_) { return; }
      if (parsed.origin !== global.location.origin || !['http:', 'https:'].includes(parsed.protocol)) return;
      const el = text(parent, 'a', label); el.href = parsed.href; el.target = '_blank'; el.rel = 'noopener';
    }
    function issue(parent, value, className) { text(parent, 'p', typeof value === 'string' ? value : value.message || value.reason || JSON.stringify(value), className); }
    function showError(error) { $('assistant-error').hidden = false; $('assistant-error').textContent = error.message || String(error); }
    function controls() {
      const s = client.session, running = activeJob(s), disabled = !authorized || busy;
      $('assistant').setAttribute('aria-busy', String(busy));
      ['new-session', 'session-history'].forEach(id => { $(id).disabled = disabled; });
      ['delete-session', 'refresh-session'].forEach(id => { $(id).disabled = disabled || !s; });
      ['assistant-files', 'upload-files', 'assistant-message', 'send-message'].forEach(id => { $(id).disabled = disabled || !s || running; });
      $('execute-plan').disabled = disabled || !s?.plan?.items?.length || running || Boolean(s.plan.blockers?.length) || s.plan.items.some(item => item.blockers?.length || item.questions?.some(question => question.blockers?.length)) || Boolean(s.receipt && s.job?.status === 'succeeded');
      $('retry-job').hidden = !['failed', 'cancelled'].includes(s?.job?.status); $('retry-job').disabled = disabled;
      $('cancel-job').hidden = !running; $('cancel-job').disabled = disabled;
    }
    function render() {
      const s = client.session;
      for (const id of ['messages', 'uploads', 'plan-preview', 'execution-receipt']) $(id).replaceChildren();
      if (!s) { $('job-status').textContent = '请选择或新建会话。'; controls(); return; }
      for (const message of s.messages || []) { const el = text($('messages'), 'article', '', 'ta-message ' + (message.role === 'user' ? 'user' : 'assistant')); text(el, 'strong', message.role === 'user' ? '你' : '整理助手'); text(el, 'div', message.content); }
      for (const upload of s.uploads || []) {
        const el = text($('uploads'), 'article', '', 'ta-file'); text(el, 'strong', upload.name); text(el, 'span', ' · ' + Math.ceil((upload.size || 0) / 1024) + ' KiB · ' + (upload.status || '等待处理'));
        if (upload.pageCount != null) text(el, 'span', ' · ' + upload.pageCount + ' 页');
        link(el, '下载原文件', upload.downloadUrl || BASE + '/uploads/' + encodeURIComponent(upload.id) + '/file');
        for (const warning of upload.warnings || []) issue(el, warning, 'ta-warning');
        if (upload.sections?.length) { const details = text(el, 'details', ''); text(details, 'summary', '原文提取片段'); upload.sections.forEach(section => { text(details, 'p', section.location || section.title || '来源'); text(details, 'pre', section.text || section.content || section); }); }
      }
      const status = { queued: '任务排队中', running: '正在处理', succeeded: '任务已完成，请核对下方回执', failed: '任务失败，可重试未完成步骤', cancelled: '后续步骤已取消，已提交内容不会撤销' };
      $('job-status').textContent = s.job ? status[s.job.status] || s.job.status : '当前为私有草稿，尚未执行。';
      if (s.job?.error) issue($('plan-preview'), s.job.error, 'ta-blocker');
      const plan = s.plan;
      if (!plan) text($('plan-preview'), 'p', '上传文件并说明需求后，这里将展示可核对的方案。');
      else {
        text($('plan-preview'), 'h3', '方案版本 ' + s.revision); if (plan.summary) text($('plan-preview'), 'p', plan.summary);
        const settings = text($('plan-preview'), 'dl', '', 'ta-settings');
        const labels = { nameSuffix: '名称要求', accessLevel: '收费范围', allowedRoles: '开放对象', enabledModes: '学习模式', duplicatePolicy: '重复处理' };
        const translated = { teacher: '教师', student: '学员', admin: '管理员', free: '免费', private: '私有', member: '会员', recall: '回忆', induction: '归纳', reasoning: '归纳', preserve: '保留独立副本', independent: '保留独立副本', reuse: '复用', cancel: '取消', keep_copy: '保留独立副本' };
        for (const [key, label] of Object.entries(labels)) { text(settings, 'dt', label); const value = plan.settings?.[key]; text(settings, 'dd', Array.isArray(value) ? value.map(v => translated[v] || v).join('、') : translated[value] || value || '待确定'); }
        (plan.blockers || []).forEach(value => issue($('plan-preview'), value, 'ta-blocker'));
        for (const item of plan.items || []) {
          const el = text($('plan-preview'), 'article', '', 'ta-item'); text(el, 'h3', item.name || item.id); text(el, 'p', (item.kind === 'principles' ? '原则与归纳卡' : '题库') + ' · ' + (item.questions?.length || item.principles?.length || 0) + ' 项');
          const upload = (s.uploads || []).find(u => u.id === item.source?.uploadId); text(el, 'p', '来源：' + (upload?.name || item.source?.uploadId || '未定位') + ' · ' + (item.source?.location || '待核对'));
          if (upload) link(el, '对照原件', upload.downloadUrl || BASE + '/uploads/' + encodeURIComponent(upload.id) + '/file');
          (item.warnings || []).forEach(v => issue(el, v, 'ta-warning')); (item.blockers || []).forEach(v => issue(el, v, 'ta-blocker'));
          for (const [index, question] of (item.questions || []).entries()) {
            const detail = text(el, 'details', '', 'ta-question'); text(detail, 'summary', (index + 1) + '. ' + (question.stem || question.title || question.question || '题目') + ' [' + (question.type || question.questionType || '题型待核对') + ']');
            for (const [key, label] of [['options', '选项'], ['answer', '答案'], ['answers', '答案'], ['correctAnswer', '正确答案'], ['explanation', '解析'], ['clues', '联想词'], ['concepts', '原则'], ['reasoning', '推理'], ['source', '来源定位'], ['provenance', '内容来源'], ['aiAdditions', 'AI 补充（待核对）']]) if (question[key] != null) text(detail, 'pre', label + '：' + (typeof question[key] === 'object' ? JSON.stringify(question[key], null, 2) : question[key]));
            (question.warnings || []).forEach(v => issue(detail, v, 'ta-warning')); (question.blockers || []).forEach(v => issue(detail, v, 'ta-blocker'));
          }
          for (const principle of item.principles || []) text(el, 'pre', principle);
          if (item.changes) text(el, 'pre', '变更清单：' + JSON.stringify(item.changes, null, 2));
        }
      }
      if (s.receipt) {
        const receipt = $('execution-receipt'); text(receipt, 'h3', '服务器操作回执');
        // Keep all actual result fields visible, including partial failures and stable content IDs.
        text(receipt, 'pre', JSON.stringify(s.receipt, null, 2));
        const walk = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (typeof child === 'string' && /url|href/i.test(key)) link(receipt, /download/i.test(key) ? '下载结果 / 校验报告' : '打开结果', child); else if (typeof child === 'object') walk(child); } }; walk(s.receipt);
      }
      controls();
    }
    async function history() {
      const sessions = await client.list(); const select = $('session-history'); select.replaceChildren(); const empty = text(select, 'option', '选择会话'); empty.value = '';
      sessions.forEach(s => { const option = text(select, 'option', s.title || '未命名会话'); option.value = s.id; }); select.value = client.session?.id || '';
    }
    function schedule() {
      global.clearTimeout(pollTimer);
      if (!activeJob(client.session)) return;
      const id = client.session.id, token = epoch;
      pollTimer = global.setTimeout(async () => { if (busy || token !== epoch) { schedule(); return; } try { await client.load(id); if (token === epoch) { render(); schedule(); } } catch (error) { showError(error); controls(); } }, 1800);
    }
    async function action(fn, refreshHistory = false) {
      if (busy || !authorized) return;
      busy = true; $('assistant-error').hidden = true; controls();
      try { await fn(); if (refreshHistory) await history(); }
      catch (error) { showError(error); }
      finally { busy = false; render(); schedule(); }
    }
    $('new-session').onclick = () => action(async () => { epoch++; await client.create(); $('assistant-message').value = ''; $('assistant-files').value = ''; }, true);
    $('session-history').onchange = () => { const id = $('session-history').value; if (id) action(async () => { epoch++; await client.load(id); $('assistant-message').value = ''; $('assistant-files').value = ''; }); };
    $('delete-session').onclick = () => { if (global.confirm('删除本会话及私人原文件？已发布内容不会撤回。')) action(async () => { epoch++; await client.remove(); }, true); };
    $('upload-form').onsubmit = event => { event.preventDefault(); action(async () => { const files = Array.from($('assistant-files').files); validateFiles(files); await client.upload(files); $('assistant-files').value = ''; }, true); };
    $('message-form').onsubmit = event => { event.preventDefault(); const content = $('assistant-message').value.trim(); if (!content) { showError(new Error('请填写整理需求。')); return; } action(async () => { await client.mutate('messages', { content }); $('assistant-message').value = ''; }, true); };
    $('execute-plan').onclick = () => action(() => client.mutate('execute', { revision: client.session.revision }));
    $('retry-job').onclick = () => action(() => client.mutate('retry'));
    $('cancel-job').onclick = () => action(() => client.mutate('cancel'));
    $('refresh-session').onclick = () => action(() => client.load(client.session.id));
    for (const tab of ['conversation', 'preview']) $('tab-' + tab).onclick = () => { $('assistant').dataset.tab = tab; for (const candidate of ['conversation', 'preview']) $('tab-' + candidate).setAttribute('aria-selected', String(candidate === tab)); };
    async function start() {
      try { const data = await client.request('/api/v1/auth/me'); const user = data.user; if (!user || !['teacher', 'admin'].includes(user.role)) throw new Error('文件整理助手仅供已登录的教师和管理员使用，请返回工作台登录有权限的账号。'); authorized = true; $('assistant-account').textContent = (user.name || user.username || '') + ' · ' + (user.role === 'admin' ? '管理员' : '教师'); await history(); const id = new URL(global.location.href).searchParams.get('session'); if (id) { await client.load(id); $('session-history').value = id; } else if ($('session-history').options.length > 1) { await client.load($('session-history').options[1].value); $('session-history').value = client.session.id; } }
      catch (error) { showError(error); } finally { render(); schedule(); }
    }
    start();
    global.addEventListener('pagehide', () => { epoch++; global.clearTimeout(pollTimer); });
    return { client, render, start };
  }
  global.KGTeacherAssistant = { createClient, validateFiles, activeJob, init };
  if (global.document?.getElementById('assistant')) init(global.document);
})(typeof window !== 'undefined' ? window : globalThis);
