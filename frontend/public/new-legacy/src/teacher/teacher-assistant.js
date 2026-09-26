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
      async status(id) { return request(BASE + "/sessions/" + encodeURIComponent(id) + "/status"); },
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
    let authorized = false, busy = false, pollTimer = null, epoch = 0, transientError = false;
    const sourceViews = new Map();
    $('assistant').dataset.tab = 'conversation';
    function text(parent, tag, value, className) { const el = doc.createElement(tag); el.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''); if (className) el.className = className; parent.appendChild(el); return el; }
    function link(parent, label, url, download = false) {
      if (!url) return;
      let parsed; try { parsed = new URL(url, global.location.href); } catch (_) { return; }
      if (parsed.origin !== global.location.origin || !['http:', 'https:'].includes(parsed.protocol)) return;
      const el = text(parent, 'a', label); el.href = parsed.href; if (download) el.download = ''; else el.target = '_blank'; el.rel = 'noopener';
    }
    function issue(parent, value, className) { text(parent, 'p', typeof value === 'string' ? value : value.message || value.reason || JSON.stringify(value), className); }
    function clearError(onlyTransient = false) { if (onlyTransient && !transientError) return; $('assistant-error').hidden = true; $('assistant-error').textContent = ''; transientError = false; }
    function showError(error) { const message = error.message || String(error); transientError = /failed to fetch|network|load failed|连接|网络/i.test(message); $('assistant-error').hidden = false; $('assistant-error').textContent = transientError ? '网络连接暂时中断，已保留输入和会话。请刷新状态或稍后重试。' : message; }
    function controls() {
      const s = client.session, running = activeJob(s), disabled = !authorized || busy;
      $('assistant').setAttribute('aria-busy', String(busy));
      ['new-session', 'session-history'].forEach(id => { $(id).disabled = disabled; });
      ['delete-session', 'refresh-session'].forEach(id => { $(id).disabled = disabled || !s; });
      ['assistant-files', 'upload-files', 'assistant-message', 'send-message'].forEach(id => { $(id).disabled = disabled || !s || running; });
      $('execute-plan').textContent = s?.plan?.settings?.publish ? '确认执行并发布' : '确认保存草稿';
      $('execute-plan').disabled = disabled || !s?.plan?.items?.length || running || Boolean(s.plan.blockers?.length) || s.plan.items.some(item => item.blockers?.length || item.questions?.some(question => question.blockers?.length)) || Boolean(s.receipt?.revision === s.revision && s.job?.status === 'succeeded');
      $('confirm-source-review').hidden = !s?.plan?.items?.some(item => item.questions?.some(question => question.metadata?.needsReview || question.needsReview));
      $('confirm-source-review').disabled = disabled || running;
      $('retry-job').hidden = !['failed', 'cancelled'].includes(s?.job?.status); $('retry-job').disabled = disabled;
      $('cancel-job').hidden = !running; $('cancel-job').disabled = disabled;
    }
    function jobLabel(s) {
      if (!s?.job) return '当前为私有草稿，尚未执行。';
      if (s.job.status === 'succeeded') return s.job.kind === 'message' && s.receipt?.revision !== s.revision ? (s.plan?.items?.length ? '预览已更新，请核对内容。' : '助手已回复，尚未生成方案。') : '执行已完成，请核对实际回执。';
      return { queued: '任务排队中', running: '正在处理', failed: '任务失败，可重试未完成步骤', cancelled: '后续步骤已取消，已提交内容不会撤销' }[s.job.status] || s.job.status;
    }
    function readable(value) {
      if (value == null) return '';
      if (Array.isArray(value)) return value.map(readable).filter(Boolean).join('、');
      if (typeof value === 'object') return value.text || value.title || value.name?.zh || value.name || value.label || value.content || value.term || '';
      return String(value);
    }
    function render() {
      const s = client.session;
      for (const id of ['messages', 'uploads', 'plan-preview', 'execution-receipt']) $(id).replaceChildren();
      if (!s) { $('job-status').textContent = '请选择或新建会话。'; controls(); return; }
      for (const message of s.messages || []) { const el = text($('messages'), 'article', '', 'ta-message ' + (message.role === 'user' ? 'user' : 'assistant')); text(el, 'strong', message.role === 'user' ? '你' : '整理助手'); text(el, 'div', message.content); }
      for (const upload of s.uploads || []) {
        const el = text($('uploads'), 'article', '', 'ta-file'); text(el, 'strong', upload.name); text(el, 'span', ' · ' + Math.ceil((upload.size || 0) / 1024) + ' KiB · ' + ({ ready: '已识别', uploaded: '待识别', failed: '识别失败', expired: '已过期，请重传' }[upload.status] || upload.status || '等待处理'));
        if (upload.pageCount != null) text(el, 'span', ' · ' + upload.pageCount + ' 页');
        if (upload.status !== 'expired') link(el, '下载原文件', upload.downloadUrl || BASE + '/uploads/' + encodeURIComponent(upload.id) + '/file');
        for (const warning of upload.warnings || []) issue(el, warning, 'ta-warning');
        if (upload.status !== 'expired' && (upload.previewUrl || upload.sections?.length)) {
          const details = text(el, 'details', ''); text(details, 'summary', '查看原文与页面图片');
          const content = text(details, 'div', '');
          const view = sourceViews.get(upload.id) || { open: false, sections: upload.sections || null, warnings: [] };
          sourceViews.set(upload.id, view); details.open = view.open;
          function renderSources() {
            content.replaceChildren();
            for (const warning of view.warnings || []) issue(content, warning, 'ta-warning');
            if (!view.sections?.length) { text(content, 'p', '暂未提取到可预览片段，请下载原件核对。'); return; }
            view.sections.forEach(section => {
              const part = text(content, 'details', '', 'ta-source-section'); text(part, 'summary', section.location || section.title || '来源片段');
              text(part, 'pre', section.text || section.content || '此页没有可提取文字，请核对页面图片。');
              for (const asset of section.images || []) {
                let url; try { url = new URL(asset.url, global.location.href); } catch (_) { continue; }
                if (url.origin !== global.location.origin || !['http:', 'https:'].includes(url.protocol)) continue;
                const figure = text(part, 'figure', ''); const image = doc.createElement('img'); image.loading = 'lazy'; image.src = url.href; image.alt = (section.location || '来源') + ' · ' + (asset.name || '页面图片'); figure.appendChild(image);
                text(figure, 'figcaption', asset.name || '来源页面图片'); link(figure, '打开图片核对', url.href);
              }
            });
          }
          async function loadSources() {
            if (view.loading) return;
            if (view.sections) { renderSources(); return; }
            view.loading = true; content.replaceChildren(); text(content, 'p', '正在读取原文预览…');
            const token = epoch;
            try {
              const preview = await client.request(upload.previewUrl);
              if (token !== epoch) return;
              view.sections = preview.sections || []; view.warnings = preview.warnings || []; renderSources();
            } catch (error) {
              content.replaceChildren(); issue(content, error.message, 'ta-blocker'); const retry = text(content, 'button', '重试读取原文'); retry.type = 'button'; retry.onclick = loadSources;
            } finally { view.loading = false; }
          }
          details.ontoggle = () => { view.open = details.open; if (details.open) loadSources(); };
          if (view.open) loadSources();
        }
      }
      $('job-status').textContent = jobLabel(s);
      if (s.job?.error) issue($('plan-preview'), s.job.error, 'ta-blocker');
      const plan = s.plan;
      if (!plan?.items?.length) text($('plan-preview'), 'p', '上传文件并说明需求后，这里将展示可核对的方案。');
      else {
        const downloads = text($('plan-preview'), 'div', '', 'ta-downloads');
        const imageItems = plan.items.filter(item => item.questions?.some(question => question.sourceImages?.length));
        const readyImages = !imageItems.length || s.receipt?.revision === s.revision && imageItems.every(item => {
          const entry = s.receipt.items?.find(result => result.itemId === item.id);
          return entry?.bankId && item.questions.every(question => (question.sourceImages || []).every(image => entry.assets?.[image.uploadId + ':' + image.filename + ':' + image.digest]?.id));
        });
        if (readyImages) link(downloads, '下载标准 JSON', BASE + '/sessions/' + encodeURIComponent(s.id) + '/export?format=json', true);
        else { const unavailable = text(downloads, 'span', '下载标准 JSON（请先保存含图草稿）'); unavailable.setAttribute('aria-disabled', 'true'); text(downloads, 'p', '本方案含来源图片，请先确认保存草稿。保存后导出的 JSON 将包含系统图片引用，图片不会被省略。', 'ta-note'); }
        link(downloads, '下载校验报告', BASE + '/sessions/' + encodeURIComponent(s.id) + '/export?format=report', true);
        text($('plan-preview'), 'p', s.receipt?.revision === s.revision && s.receipt?.items?.some(entry => entry.releaseId) ? '已发布 · 请通过回执入口核对学习内容' : s.receipt?.revision === s.revision && s.receipt?.items?.some(entry => entry.bankId || entry.paperId || entry.status === 'succeeded') ? '已导入 · 尚未发布给学员' : plan.settings?.publish ? '待发布方案 · 确认执行后发布' : '私有草稿 · 尚未发布', 'ta-publication-state');
        text($('plan-preview'), 'h3', '方案版本 ' + s.revision); if (plan.summary) text($('plan-preview'), 'p', plan.summary);
        const settings = text($('plan-preview'), 'dl', '', 'ta-settings');
        const labels = { nameSuffix: '名称要求', accessLevel: '收费范围', allowedRoles: '开放对象', enabledModes: '学习模式', duplicatePolicy: '重复处理' };
        const translated = { teacher: '教师', student: '学员', admin: '管理员', free: '免费', private: '私有', member: '会员', recall: '回忆', induction: '归纳', reasoning: '归纳', deep_recall: '回忆画布', multi_question_canvas: '归纳画布', practice_mode: '做题模式', preserve: '保留独立副本', independent: '保留独立副本', reuse: '复用', cancel: '取消', keep_copy: '保留独立副本' };
        for (const [key, label] of Object.entries(labels)) { text(settings, 'dt', label); const value = plan.settings?.[key]; text(settings, 'dd', Array.isArray(value) ? value.map(v => translated[v] || v).join('、') : translated[value] || value || '待确定'); }
        (plan.blockers || []).forEach(value => issue($('plan-preview'), value, 'ta-blocker'));
        for (const item of plan.items || []) {
          const el = text($('plan-preview'), 'article', '', 'ta-item'); text(el, 'h3', item.name || item.id); text(el, 'p', (item.kind === 'principles' ? '原则与归纳卡' : '题库') + ' · ' + (item.questions?.length || item.principles?.length || item.principleBundle?.principles?.length || 0) + ' 项');
          const upload = (s.uploads || []).find(u => u.id === item.source?.uploadId); text(el, 'p', '来源：' + (upload?.name || item.source?.uploadId || '未定位') + ' · ' + (item.source?.location || '待核对'));
          if (upload && upload.status !== 'expired') link(el, '对照原件', upload.downloadUrl || BASE + '/uploads/' + encodeURIComponent(upload.id) + '/file');
          (item.warnings || []).forEach(v => issue(el, v, 'ta-warning')); (item.blockers || []).forEach(v => issue(el, v, 'ta-blocker'));
          for (const [index, question] of (item.questions || []).entries()) {
            const detail = text(el, 'details', '', 'ta-question');
            const type = { single_choice: '单选', multiple_choice: '多选', single: '单选', multiple: '多选', matching: '匹配', short_answer: '简答' }[question.type || question.questionType] || question.type || '题型待核对';
            const stem = question.stem || question.title || question.question || readable(question.stemParts) || '题目';
            text(detail, 'summary', (index + 1) + '. ' + stem + ' [' + type + ']');
            if (question.stemParts) text(detail, 'p', readable(question.stemParts));
            const options = Array.isArray(question.options) ? question.options : Object.entries(question.options || {}).map(([id, value]) => ({ id, text: readable(value) }));
            const answers = [question.correctOptionIds, question.correctAnswer, question.answer, question.answers].find(value => value != null && value !== '' && (!Array.isArray(value) || value.length > 0)) ?? options.filter(option => option.correct).map(option => option.id);
            const answerIds = Array.isArray(answers) ? answers.map(String) : answers == null ? [] : [String(answers)];
            const optionLabels = new Map();
            options.forEach((option, position) => { const label = option.label || String.fromCharCode(65 + position); optionLabels.set(String(option.id), label); text(detail, 'p', label + '. ' + readable(option) + (option.correct || answerIds.includes(String(option.id)) ? ' ✓ 正确选项' : ''), 'ta-option'); });
            if (answers != null && (!Array.isArray(answers) || answers.length)) text(detail, 'p', '答案：' + (answerIds.length ? answerIds.map(value => optionLabels.get(value) || value).join('、') : readable(answers)), 'ta-answer');
            for (const [key, label] of [['explanation', '解析'], ['analysis', '解析'], ['clues', '联想词'], ['concepts', '原则'], ['reasoning', '推理'], ['reasoningSteps', '推理步骤'], ['aiAdditions', 'AI 补充（待核对）']]) if (question[key] != null) text(detail, 'p', label + '：' + readable(question[key]));
            const location = question.source?.location || question.metadata?.sourceLocation;
            if (location) text(detail, 'p', '来源：' + location);
            if (upload && upload.status !== 'expired') link(detail, '核对来源原件', upload.downloadUrl || BASE + '/uploads/' + encodeURIComponent(upload.id) + '/file');
            if (question.metadata || question.provenance || question.source) { const advanced = text(detail, 'details', '', 'ta-provenance'); text(advanced, 'summary', '详细来源信息'); text(advanced, 'pre', { source: question.source, provenance: question.provenance, metadata: question.metadata }); }
            (question.warnings || []).forEach(v => issue(detail, v, 'ta-warning')); (question.blockers || []).forEach(v => issue(detail, v, 'ta-blocker'));
          }
          for (const principle of item.principles || item.principleBundle?.principles || []) text(el, 'pre', principle);
          if (item.principleBundle) { const bundle = text(el, 'details', ''); text(bundle, 'summary', '原则与归纳卡内容'); text(bundle, 'pre', item.principleBundle); }
          if (item.mergePreview) { const merge = text(el, 'details', ''); text(merge, 'summary', '原则合并变更预览'); text(merge, 'pre', item.mergePreview); }
          if (item.changes) text(el, 'pre', '变更清单：' + JSON.stringify(item.changes, null, 2));
        }
      }
      if (s.receipt) {
        const receipt = $('execution-receipt'); text(receipt, 'h3', s.receipt.revision === s.revision ? '本次执行回执' : '上一版本执行回执（当前方案尚未执行）');
        const labels = { succeeded: '已完成', failed: '未完成', cancelled: '已取消', skipped: '已跳过', partial: '部分完成', running: '处理中', queued: '等待处理' };
        text(receipt, 'p', labels[s.receipt.status] || '执行结果已返回，请核对各项内容。');
        if (s.receipt.error) text(receipt, 'p', typeof s.receipt.error === 'string' ? s.receipt.error : s.receipt.error.message || '部分步骤未完成，请查看校验报告。', 'ta-warning');
        for (const entry of s.receipt.items || []) {
          const card = text(receipt, 'article', '', 'ta-receipt-item');
          text(card, 'h4', entry.name || '整理结果');
          text(card, 'p', (labels[entry.status] || (entry.releaseId ? '已发布' : entry.bankId || entry.paperId ? '已保存' : '请核对结果')) + (entry.releaseId ? ' · 已发布给允许访问的用户' : entry.bankId || entry.paperId ? ' · 本次修改尚未发布' : ''));
          const count = entry.questionCount ?? entry.paper?.questions?.length;
          if (count != null) text(card, 'p', '题目：' + count + ' 道');
          if (entry.error) text(card, 'p', typeof entry.error === 'string' ? entry.error : entry.error.message || '该项未完成，请查看校验报告。', 'ta-warning');
          for (const warning of entry.warnings || []) text(card, 'p', typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning), 'ta-warning');
          for (const target of entry.links || []) link(card, target.label || target.text || '打开结果', target.url || target.href);
        }
        for (const failure of s.receipt.partialFailures || []) text(receipt, 'p', typeof failure === 'string' ? failure : failure.error || failure.message || '部分步骤未完成', 'ta-warning');
        if (!s.receipt.items?.length && s.receipt.questionCount != null) text(receipt, 'p', '题目：' + s.receipt.questionCount + ' 道');
        const technical = text(receipt, 'details', '', 'ta-receipt-details');
        text(technical, 'summary', '查看完整回执与资源编号');
        text(technical, 'pre', JSON.stringify(s.receipt, null, 2));
        const walk = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (typeof child === 'string' && /url|href/i.test(key)) link(receipt, value.label || value.text || (/download/i.test(key) ? '下载结果 / 校验报告' : '打开结果'), child); else if (typeof child === 'object') walk(child); } }; if (!s.receipt.items?.length) walk(s.receipt);
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
      pollTimer = global.setTimeout(async () => { if (busy || token !== epoch) { schedule(); return; } try { const status = await client.status(id); clearError(true); if (token !== epoch) return; if (status.revision !== client.session.revision || !activeJob({ job: status.job })) { await client.load(id); render(); } else { client.session.job = status.job; $('job-status').textContent = jobLabel(client.session); controls(); } schedule(); } catch (error) { showError(error); controls(); if (transientError) schedule(); } }, 1800);
    }
    async function action(fn, refreshHistory = false) {
      if (busy || !authorized) return;
      busy = true; clearError(); controls();
      try { await fn(); if (refreshHistory) await history(); clearError(); }
      catch (error) { showError(error); }
      finally { busy = false; render(); schedule(); }
    }
    $('new-session').onclick = () => action(async () => { epoch++; sourceViews.clear(); await client.create(); $('assistant-message').value = ''; $('assistant-files').value = ''; }, true);
    $('session-history').onchange = () => { const id = $('session-history').value; if (id) action(async () => { epoch++; sourceViews.clear(); await client.load(id); $('assistant-message').value = ''; $('assistant-files').value = ''; }); };
    $('delete-session').onclick = () => { if (global.confirm('删除本会话及私人原文件？已发布内容不会撤回。')) action(async () => { epoch++; sourceViews.clear(); await client.remove(); }, true); };
    $('upload-form').onsubmit = event => { event.preventDefault(); action(async () => { const files = Array.from($('assistant-files').files); validateFiles(files); await client.upload(files); $('assistant-files').value = ''; }, true); };
    $('message-form').onsubmit = event => { event.preventDefault(); const content = $('assistant-message').value.trim(); if (!content) { showError(new Error('请填写整理需求。')); return; } action(async () => { await client.mutate('messages', { content }); $('assistant-message').value = ''; }, true); };
    $('confirm-source-review').onclick = () => action(() => client.mutate('messages', { content: '我已逐题核对原文、答案和图表，确认提取内容无误，请更新预览。' }), true);
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
