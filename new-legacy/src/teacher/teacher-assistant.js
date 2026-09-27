(function (global) {
  'use strict';
  const BASE = '/api/v1/teacher-assistant';
  const activeJob = session => (['queued', 'running'].includes(session?.job?.status) || session?.runtime?.status === 'stopping');
  function validateFiles(files) {
    if (!files.length) throw new Error('请先选择文件。');
    if (files.length > 5) throw new Error('一次最多上传 5 份文件，请分批上传。');
    let total = 0;
    for (const file of files) {
      if (!/\.(json|docx?|pdf|pptx?|png|jpe?g|webp)$/i.test(file.name)) throw new Error('仅支持 JSON、Word、PDF、PPT 和 PNG/JPG/WebP 图片。');
      if (file.size > 20 * 1024 * 1024) throw new Error(file.name + ' 超过 20 MiB，请拆分文件。');
      total += file.size;
    }
    if (total > 50 * 1024 * 1024) throw new Error('本批文件超过 50 MiB，请分批上传。');
    return files;
  }
  function createClient(fetcher, uuid) {
    let session = null;
    let pending = false, generation = 0;
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
        const error = new Error(typeof detail === 'string' ? detail : detail?.message || payload?.message || '请求失败（' + response.status + '），请重试。'); error.status = response.status; throw error;
      }
      return payload;
    }
    async function load(id) { const token = ++generation; const data = await request(BASE + '/sessions/' + encodeURIComponent(id)); if (token === generation) session = data.session; return data.session; }
    async function mutate(action, body = {}) {
      if (pending) throw new Error('正在提交，请等待当前请求完成。');
      if (!session) throw new Error('请先新建或选择会话。');
      pending = true;
      const id = session.id, token = ++generation;
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
        if (token === generation) session = data.session;
        keys.delete(identity); writeKey(slot, null);
        return session;
      } catch (error) {
        // A lost response may have committed. Reconcile before offering the same operation key again.
        if (token === generation) { try { await load(id); } catch (_) { /* retain operation key and caller input */ } }
        throw error;
      } finally { pending = false; }
    }
    return {
      request, load, mutate,
      async activate(id) { const token = ++generation; const data = await request(BASE + '/sessions/' + encodeURIComponent(id) + '/activate', { method: 'POST' }); if (token === generation) session = data.session; return data.session; },
      async status(id) { return request(BASE + "/sessions/" + encodeURIComponent(id) + "/status"); },
      get session() { return session; }, get pending() { return pending; },
      async list() { return (await request(BASE + '/sessions')).sessions || []; },
      async create() { const token = ++generation; const data = await request(BASE + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (token === generation) session = data.session; return data.session; },
      async remove() { const token = ++generation; if (!session) return; await request(BASE + '/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' }); if (token === generation) session = null; },
      async upload(files) {
        validateFiles(files);
        if (!session) throw new Error('请先新建或选择会话。');
        const form = new global.FormData(); files.forEach(file => form.append('files', file));
        const id = session.id, token = ++generation;
        try { const data = await request(BASE + '/sessions/' + encodeURIComponent(id) + '/uploads', { method: 'POST', body: form }); if (token === generation) session = data.session; return data.session; }
        catch (error) { if (token === generation) { try { await load(id); } catch (_) {} } throw error; }
      },
    };
  }
  function init(doc) {
    const $ = id => doc.getElementById(id);
    const client = createClient(global.fetch.bind(global), () => global.crypto.randomUUID());
    let authorized = false, busy = false, pollTimer = null, epoch = 0, transientError = false;
    let stream = null, cursor = 0, pendingFiles = [], activated = false, tools = [], streamText = '', nearBottom = true;
    let targetSession = null;
    const scroller = $('conversation-panel');
    const sourceViews = new Map();
    $('assistant').dataset.tab = 'conversation';
    $('assistant').classList.toggle('ta-sidebar-collapsed', global.innerWidth <= 760);
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
      ['assistant-files', 'attach-files', 'assistant-message', 'send-message'].forEach(id => { $(id).disabled = disabled || !s || !activated || running; });
      $('execute-plan').textContent = s?.plan?.settings?.publish ? '确认执行并发布' : '确认保存草稿';
      $('execute-plan').disabled = disabled || !s?.plan?.items?.length || running || Boolean(s.plan.blockers?.length) || s.plan.items.some(item => item.blockers?.length || item.questions?.some(question => question.blockers?.length)) || Boolean(s.receipt?.revision === s.revision && s.job?.status === 'succeeded');
      $('confirm-source-review').hidden = !s?.plan?.items?.some(item => item.questions?.some(question => question.metadata?.needsReview || question.needsReview));
      $('confirm-source-review').disabled = disabled || running;
      $('retry-job').hidden = !['failed', 'cancelled'].includes(s?.job?.status); $('retry-job').disabled = disabled;
      $('cancel-job').hidden = !running; $('cancel-job').disabled = disabled;
      $('stop-message').hidden = !running; $('stop-message').disabled = disabled; $('send-message').hidden = running;
      $('tab-preview').disabled = !s?.plan?.items?.length && !s?.receipt;
      $('toggle-sidebar').setAttribute('aria-expanded', String(!$('assistant').classList.contains('ta-sidebar-collapsed')));
      renderPending();
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
      nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 100;
      for (const id of ['messages', 'uploads', 'plan-preview', 'execution-receipt']) $(id).replaceChildren();
      $('welcome').hidden = Boolean(s?.messages?.length); $('files-details').hidden = !s?.uploads?.length;
      $('conversation-result').replaceChildren();
      if (!s) { $('job-status').textContent = '请选择或新建会话。'; controls(); return; }
      for (const message of s.messages || []) { const el = text($('messages'), 'article', '', 'ta-message ' + (message.role === 'user' ? 'user' : 'assistant')); text(el, 'strong', message.role === 'user' ? '你' : '教学助手'); text(el, 'div', message.content); }
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
          for (const principle of item.principles || item.principleBundle?.principles || []) text(el, 'p', readable(principle) || '请展开原则与归纳卡内容核对。');
          if (item.principleBundle) { const bundle = text(el, 'details', ''); text(bundle, 'summary', '原则与归纳卡内容'); text(bundle, 'pre', item.principleBundle); }
          if (item.mergePreview) { const merge = text(el, 'details', ''); text(merge, 'summary', '原则合并变更预览'); text(merge, 'pre', item.mergePreview); }
          if (item.changes) { const changes = text(el, 'details', ''); text(changes, 'summary', '变更清单'); text(changes, 'pre', item.changes); }
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
      if (s.plan?.items?.length || s.receipt) {
        const result = text($('conversation-result'), 'button', s.receipt?.revision === s.revision ? '查看教学成果与执行回执 ↗' : '查看整理方案 ↗', 'ta-result'); result.type = 'button';
        text(result, 'small', s.plan?.summary || '核对内容、保存草稿或下载结果'); result.onclick = () => panel(true);
      }
      if (s.job?.status === 'failed') {
        issue($('conversation-result'), s.job.error || '这次处理未完成，你可以重试或继续发消息。', 'ta-blocker');
        const retry = text($('conversation-result'), 'button', '重试这次处理'); retry.type = 'button'; retry.disabled = busy; retry.onclick = () => $('retry-job').click();
      }
      streamText = s.stream?.text || ''; cursor = Number(s.stream?.lastEventId || 0); renderStream();
      controls();
      if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
    }
    async function history() {
      const sessions = await client.list(); const select = $('session-history'); select.replaceChildren(); const empty = text(select, 'option', '选择会话'); empty.value = '';
      $('session-list').replaceChildren();
      sessions.forEach(s => { const option = text(select, 'option', s.title || '新对话'); option.value = s.id;
        const button = text($('session-list'), 'button', s.title || '新对话', 'ta-history-item'); button.dataset.sessionId = s.id;
        button.setAttribute('aria-current', String(client.session?.id === s.id)); button.onclick = () => switchSession(s.id);
      }); select.value = client.session?.id || '';
    }
    function panel(open) {
      $('preview-panel').hidden = !open; $('tab-preview').setAttribute('aria-expanded', String(open));
      $('preview-panel').setAttribute('aria-modal', String(open && global.innerWidth <= 760));
      if (open) $('tab-conversation').focus(); else $('tab-preview').focus();
    }
    function sidebar(open) {
      $('assistant').classList.toggle('ta-sidebar-collapsed', !open);
      $('sidebar-backdrop').hidden = !open || global.innerWidth > 760;
      $('toggle-sidebar').setAttribute('aria-expanded', String(open));
      $('toggle-sidebar').setAttribute('aria-label', open ? '收起会话列表' : '展开会话列表');
    }
    function disconnect() { global.clearTimeout(pollTimer); if (stream) stream.close(); stream = null; }
    function renderStream() {
      const running = activeJob(client.session);
      $('stream-message').hidden = !streamText; $('stream-text').textContent = streamText;
      $('activity-details').hidden = !running && !tools.length;
      if (!running && !busy) $('runtime-status').textContent = client.session?.job?.status === 'failed' ? '处理未完成，可重试' : client.session?.job?.status === 'cancelled' ? '已停止，可继续对话' : '处理记录';
      $('tool-activity').replaceChildren(); tools.forEach(value => text($('tool-activity'), 'p', value));
      if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
    }
    async function reconcile(id, token) {
      if (token !== epoch) return;
      await client.load(id); if (token !== epoch) return;
      clearError(true); render(); await history(); schedule();
    }
    function schedule() {
      disconnect();
      if (!activeJob(client.session)) return;
      const id = client.session.id, token = epoch;
      if (!global.EventSource) return;
      stream = new global.EventSource(BASE + '/sessions/' + encodeURIComponent(id) + '/events?after=' + cursor);
      stream.onmessage = event => {
        if (token !== epoch) return;
        let value; try { value = JSON.parse(event.data); } catch (_) { return; }
        if (Number(value.id) <= cursor) return;
        if (value.type === 'status' && value.data?.status === 'resync_required') {
          disconnect(); reconcile(id, token).catch(error => { showError(error); reconnect(id, token); }); return;
        }
        cursor = Number(value.id);
        if (value.jobId && client.session.job?.id && value.jobId !== client.session.job.id) return;
        const data = value.data || {}; clearError(true);
        if (value.type === 'text_delta') { streamText += data.text || ''; $('runtime-status').textContent = '正在回复'; }
        if (value.type === 'status') $('runtime-status').textContent = ({queued:'等待处理',running:'正在处理',stopping:'正在停止，请稍候',reading:'正在读取文件'})[data.status] || '正在处理';
        if (value.type === 'tool_start' || value.type === 'tool_end') {
          const label = data.label || (data.uploadId ? '读取文件' : '处理教学内容');
          tools.push(label + (value.type === 'tool_start' ? ' · 进行中' : data.ok === false ? ' · 未完成' : ' · 已完成'));
        }
        if (value.type === 'error') showError(new Error(data.message || '处理未完成，请重试。'));
        renderStream();
        if (value.type === 'done') { disconnect(); reconcile(id, token).catch(error => { showError(error); reconnect(id, token); }); }
      };
      stream.onerror = () => { disconnect(); reconnect(id, token); };
    }
    function reconnect(id, token) {
      pollTimer = global.setTimeout(async () => {
        if (token !== epoch) return;
        try { await reconcile(id, token); } catch (error) { showError(error); reconnect(id, token); }
      }, 1200);
    }
    async function activate(id) {
      activated = false; targetSession = id;
      for (let attempt = 0; attempt < 8; attempt++) {
        try { await client.activate(id); activated = true; targetSession = null; return; }
        catch (error) { if (error.status !== 409 || attempt === 7) throw error;
          $('runtime-status').textContent = '正在结束上一段对话，请稍候'; $('activity-details').hidden = false;
          await new Promise(resolve => global.setTimeout(resolve, Math.min(500 * (attempt + 1), 2000)));
        }
      }
    }
    async function action(fn, refreshHistory = false) {
      if (busy || !authorized) return;
      busy = true; epoch++; disconnect(); clearError(); controls();
      try { await fn(); if (refreshHistory) await history(); clearError(); }
      catch (error) { showError(error); }
      finally { busy = false; render(); schedule(); }
    }
    function clearDraft() { pendingFiles = []; $('assistant-message').value = ''; $('assistant-files').value = ''; tools = []; renderPending(); }
    function switchSession(id) {
      action(async () => { epoch++; disconnect(); sourceViews.clear(); await activate(id); clearDraft(); panel(false); if (global.innerWidth <= 760) sidebar(false); }, true);
    }
    function reconcilePending() {
      const uploads = (client.session?.uploads || []).filter(upload => upload.status !== 'expired');
      for (const entry of pendingFiles) {
        entry.stored = entry.sha256 ? uploads.find(upload => upload.sha256 === entry.sha256) : null;
        entry.uploaded = Boolean(entry.stored);
      }
    }
    async function hashPending() {
      if (!global.crypto?.subtle) throw new Error('当前浏览器无法校验文件内容，请使用安全连接或更新浏览器后重试。');
      await Promise.all(pendingFiles.map(async entry => {
        if (!entry.sha256) { const digest = await global.crypto.subtle.digest('SHA-256', await entry.file.arrayBuffer()); entry.sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''); }
      }));
    }
    function renderPending() {
      reconcilePending();
      $('pending-files').replaceChildren();
      pendingFiles.forEach((entry, index) => { const chip = text($('pending-files'), 'div', '', 'ta-attachment'); text(chip, 'span', entry.file.name + (entry.uploaded ? entry.stored.name !== entry.file.name ? ' · 已复用 ' + entry.stored.name : ' · 已上传' : ' · 待发送'));
        const remove = text(chip, 'button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', '移除 ' + entry.file.name); remove.disabled = busy;
        remove.onclick = () => { pendingFiles.splice(index, 1); renderPending(); };
      });
    }
    function addFiles(files) {
      if (!authorized || busy || activeJob(client.session)) return;
      try { const added = Array.from(files); if (!added.length) return; validateFiles([...pendingFiles.map(entry => entry.file), ...added]); pendingFiles.push(...added.map(file => ({file, uploaded:false}))); renderPending(); clearError(); }
      catch (error) { showError(error); }
      $('assistant-files').value = '';
    }
    $('new-session').onclick = () => action(async () => { epoch++; disconnect(); sourceViews.clear(); const s = await client.create(); await activate(s.id); clearDraft(); panel(false); if (global.innerWidth <= 760) sidebar(false); }, true);
    $('session-history').onchange = () => { if ($('session-history').value) switchSession($('session-history').value); };
    $('delete-session').onclick = () => { if (global.confirm('删除本会话及私人原文件？已发布内容不会撤回。')) action(async () => { epoch++; disconnect(); sourceViews.clear(); await client.remove(); clearDraft(); activated = false; panel(false); }, true); };
    $('attach-files').onclick = () => $('assistant-files').click();
    $('assistant-files').onchange = () => addFiles($('assistant-files').files);
    $('assistant-message').onpaste = event => { const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); addFiles(files); } };
    $('assistant').ondragover = event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); $('assistant').classList.add('ta-dragging'); } };
    $('assistant').ondragleave = event => { if (!$('assistant').contains(event.relatedTarget)) $('assistant').classList.remove('ta-dragging'); };
    $('assistant').ondrop = event => { event.preventDefault(); $('assistant').classList.remove('ta-dragging'); addFiles(event.dataTransfer.files); };
    $('message-form').onsubmit = event => {
      event.preventDefault(); if (!activated || activeJob(client.session)) return;
      const content = $('assistant-message').value.trim() || (pendingFiles.length ? '请先阅读这些文件，帮我概括主要内容。' : '');
      if (!content) { showError(new Error('请填写消息或添加文件。')); return; }
      action(async () => {
        $('activity-details').hidden = false; $('runtime-status').textContent = '等待处理'; tools = [];
        if (pendingFiles.length) {
          $('runtime-status').textContent = '正在校验文件';
          await hashPending();
          // Always reconcile the current owner snapshot first, including after a lost response + failed GET.
          await client.load(client.session.id); renderPending();
          const unique = new Map();
          pendingFiles.filter(entry => !entry.uploaded).forEach(entry => unique.set(entry.sha256, entry));
          const files = Array.from(unique.values());
          const existing = (client.session.uploads || []).filter(upload => upload.status !== 'expired');
          if (existing.length + files.length > 5 || [...existing, ...files.map(entry => entry.file)].reduce((total, file) => total + Number(file.size || 0), 0) > 50 * 1024 * 1024) throw new Error('每段对话最多 5 份不同文件，合计 50 MiB，请新建对话继续。');
          if (files.length) {
            $('runtime-status').textContent = '正在上传文件';
            try { await client.upload(files.map(entry => entry.file)); } catch (error) { renderPending(); throw error; }
          }
          renderPending();
          if (pendingFiles.some(entry => !entry.uploaded)) throw new Error('服务器尚未确认收到文件，请重试上传。');
        }
        await client.mutate('messages', { content }); clearDraft();
        $('runtime-status').textContent = '等待处理';
      }, true);
    };
    $('assistant-message').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); $('message-form').requestSubmit(); } };
    $('confirm-source-review').onclick = () => action(() => client.mutate('messages', { content: '我已逐题核对原文、答案和图表，确认提取内容无误，请更新预览。' }), true);
    $('execute-plan').onclick = () => action(() => client.mutate('execute', { revision: client.session.revision }));
    $('retry-job').onclick = () => action(() => client.mutate('retry'));
    $('cancel-job').onclick = $('stop-message').onclick = () => action(() => client.mutate('cancel'));
    $('refresh-session').onclick = () => action(async () => { epoch++; disconnect(); if (targetSession) await activate(targetSession); else await client.load(client.session.id); }, true);
    $('tab-preview').onclick = () => panel(true); $('tab-conversation').onclick = () => panel(false);
    $('toggle-sidebar').onclick = () => sidebar($('assistant').classList.contains('ta-sidebar-collapsed'));
    let mobileLayout = global.innerWidth <= 760;
    global.addEventListener('resize', () => { const mobile = global.innerWidth <= 760; if (mobile !== mobileLayout) { sidebar(!mobile); mobileLayout = mobile; } });
    $('sidebar-backdrop').onclick = () => { sidebar(false); $('toggle-sidebar').focus(); };
    doc.addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        const modal = !$('preview-panel').hidden && global.innerWidth <= 760 ? $('preview-panel') : !$('sidebar-backdrop').hidden ? $('sidebar') : null;
        if (modal) { const focusable = Array.from(modal.querySelectorAll('button:not(:disabled),a[href],summary,textarea:not(:disabled)')).filter(el => el.getClientRects().length); const first = focusable[0], last = focusable.at(-1);
          if (event.shiftKey && (doc.activeElement === first || !modal.contains(doc.activeElement))) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (doc.activeElement === last || !modal.contains(doc.activeElement))) { event.preventDefault(); first?.focus(); }
        }
      }
      if (event.key === 'Escape') { if (!$('preview-panel').hidden) panel(false); sidebar(false); $('toggle-sidebar').focus(); } });
    doc.querySelectorAll('[data-prompt]').forEach(button => { button.onclick = () => { $('assistant-message').value = button.dataset.prompt; $('assistant-message').focus(); }; });
    scroller.onscroll = () => { nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 100; $('jump-bottom').hidden = nearBottom; };
    $('jump-bottom').onclick = () => { nearBottom = true; scroller.scrollTop = scroller.scrollHeight; };
    async function start() {
      busy = true; controls();
      try { const data = await client.request('/api/v1/auth/me'); const user = data.user; if (!user || !['teacher', 'admin'].includes(user.role)) throw new Error('文件整理助手仅供已登录的教师和管理员使用，请返回工作台登录有权限的账号。'); authorized = true; $('assistant-account').textContent = (user.name || user.username || '') + ' · ' + (user.role === 'admin' ? '管理员' : '教师'); await history(); const id = new URL(global.location.href).searchParams.get('session'); if (id) { await activate(id); $('session-history').value = id; } else if ($('session-history').options.length > 1) { await activate($('session-history').options[1].value); $('session-history').value = client.session.id; } else { const session = await client.create(); await activate(session.id); } await history(); }
      catch (error) { showError(error); } finally { busy = false; render(); schedule(); }
    }
    start();
    global.addEventListener('pagehide', () => { epoch++; disconnect(); });
    return { client, render, start };
  }
  global.KGTeacherAssistant = { createClient, validateFiles, activeJob, init };
  if (global.document?.getElementById('assistant')) init(global.document);
})(typeof window !== 'undefined' ? window : globalThis);
