'use strict';

/*
 * 当前学习模式与历史模式的唯一策略边界。
 * 当前选择器只能读取 ACTIVE_MODES；已停用标识仅供历史记录解析和安全降级。
 */
(function installLearningModePolicy(global) {
  const ACTIVE_MODES = Object.freeze([
    Object.freeze({ id: 'practice_mode', label: '刷题', retired: false }),
    Object.freeze({ id: 'deep_recall', label: '深度回忆', retired: false }),
    Object.freeze({ id: 'multi_question_canvas', label: '归纳', retired: false }),
  ]);
  const IDS = Object.freeze(ACTIVE_MODES.map(mode => mode.id));
  const LABELS = Object.freeze(Object.fromEntries(ACTIVE_MODES.map(mode => [mode.id, mode.label])));
  const ACTIVE_MODE_ALIASES = Object.freeze({
    practice: 'practice_mode',
    'practice-mode': 'practice_mode',
    practice_mode: 'practice_mode',
    recall: 'deep_recall',
    'deep-recall': 'deep_recall',
    deep_recall: 'deep_recall',
    multi_question: 'multi_question_canvas',
    'multi-question': 'multi_question_canvas',
    canvas: 'multi_question_canvas',
    multi_question_canvas: 'multi_question_canvas',
  });
  const HISTORICAL_MODE_ALIASES = Object.freeze({
    single_deep_study: 'single_deep_study',
    single_deep: 'single_deep_study',
    'single-deep': 'single_deep_study',
  });
  const ALIASES = Object.freeze({ ...ACTIVE_MODE_ALIASES, ...HISTORICAL_MODE_ALIASES });
  const RETIRED_SINGLE_DEEP = Object.freeze({
    id: 'single_deep_study',
    label: '单题深学（已停用）',
    retired: true,
    fallbackId: 'practice_mode',
  });
  const CONFIG_VERSION = 2;
  const PUBLISHED_STATUSES = Object.freeze(['published', 'active', 'released']);
  const WITHDRAWN_STATUSES = Object.freeze(['withdrawn', 'revoked', 'unpublished', 'archived', 'disabled']);

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function number(value, fallback = 0) {
    const resolved = Number(value);
    return Number.isFinite(resolved) ? resolved : fallback;
  }

  function aliasKey(value) {
    return text(value).toLowerCase();
  }

  function canonical(value) {
    return ALIASES[aliasKey(value)] || '';
  }

  function activeById(id) {
    return ACTIVE_MODES.find(mode => mode.id === id) || null;
  }

  function listActive() {
    return ACTIVE_MODES;
  }

  function list() {
    return listActive();
  }

  function resolveHistorical(value) {
    return HISTORICAL_MODE_ALIASES[aliasKey(value)] ? RETIRED_SINGLE_DEEP : null;
  }

  function normalizeForLaunch(value) {
    const originalId = text(value);
    const key = aliasKey(originalId);
    const active = activeById(ACTIVE_MODE_ALIASES[key]);
    if (active) return active;
    const historical = resolveHistorical(originalId);
    const fallback = activeById(historical?.fallbackId) || ACTIVE_MODES[0];
    if (!historical) return fallback;
    return Object.freeze({ ...fallback, retiredFrom: originalId });
  }

  function normalize(value, version = 0) {
    if (!Array.isArray(value)) return Array.from(IDS);
    const activeIds = value
      .map(item => ACTIVE_MODE_ALIASES[aliasKey(item)] || '')
      .filter(Boolean);
    if (!activeIds.length) {
      if (!value.length && number(version, 0) < CONFIG_VERSION) return Array.from(IDS);
      return [];
    }
    const modes = Array.from(new Set(activeIds));
    if (number(version, 0) < CONFIG_VERSION && !modes.includes('practice_mode')) {
      modes.unshift('practice_mode');
    }
    return modes;
  }

  function normalizePaper(paper) {
    return normalize(paper?.enabledModes, paper?.modeConfigVersion);
  }

  function supports(paper, mode) {
    const raw = text(mode);
    if (!raw) return true;
    const activeId = ACTIVE_MODE_ALIASES[aliasKey(raw)] || '';
    return !!activeId && normalizePaper(paper).includes(activeId);
  }

  function validate(paper, options = {}) {
    const modes = normalizePaper(paper);
    const requireOne = options.requireOne !== false;
    return Object.freeze({
      ok: !requireOne || modes.length > 0,
      modes,
      error: requireOne && !modes.length ? '请至少选择一种学习模式后再发布。' : '',
    });
  }

  function status(value, fallback = 'draft') {
    return text(value || fallback).toLowerCase() || fallback;
  }

  function isPublishedStatus(value) {
    return PUBLISHED_STATUSES.includes(status(value, 'published'));
  }

  function isWithdrawnStatus(value) {
    return WITHDRAWN_STATUSES.includes(status(value, ''));
  }

  function label(mode) {
    const raw = text(mode);
    const activeId = ACTIVE_MODE_ALIASES[aliasKey(raw)] || '';
    if (activeId) return LABELS[activeId];
    return resolveHistorical(raw)?.label || raw;
  }

  function labels(value, version = 0) {
    return normalize(value, version).map(mode => LABELS[mode]);
  }

  const api = Object.freeze({
    ACTIVE_MODES,
    ACTIVE_MODE_ALIASES,
    HISTORICAL_MODE_ALIASES,
    IDS,
    LABELS,
    ALIASES,
    CONFIG_VERSION,
    PUBLISHED_STATUSES,
    WITHDRAWN_STATUSES,
    listActive,
    list,
    resolveHistorical,
    normalizeForLaunch,
    canonical,
    normalize,
    normalizePaper,
    supports,
    validate,
    status,
    isPublishedStatus,
    isWithdrawnStatus,
    label,
    labels,
  });

  global.KGPaperLearningModes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
