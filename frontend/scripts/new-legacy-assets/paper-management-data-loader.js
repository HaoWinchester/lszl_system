'use strict';

/*
 * 试卷管理页的按需数据编排器。它只持有当前页面生命周期内的缓存，
 * 所有业务数据仍以试卷与题库关系型 API 为唯一权威源。
 */
(function (global) {
  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return value; }
  }

  function text(value) { return String(value == null ? '' : value); }

  function message(error) {
    return text(error?.message || error || '数据加载失败');
  }

  function create(options = {}) {
    const paperApi = options.paperApi || global.KGPaperDraftApi;
    const catalogApi = options.catalogApi || global.KGQuestionCatalogAdapter;
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    if (!paperApi || !catalogApi) throw new Error('试卷管理按需数据接口未加载。');

    const paperDetails = new Map();
    const candidatePages = new Map();
    let catalogRevision = -1;
    let paperGeneration = 0;
    let bankGeneration = 0;
    const state = {
      papers: [],
      categories: [],
      banks: [],
      selectedPaperId: '',
      selectedPaper: null,
      paperLoading: false,
      paperError: '',
      selectedBankId: '',
      candidateQuestions: [],
      candidateTotal: 0,
      candidatePage: 1,
      candidatePageSize: 12,
      candidateSearch: '',
      candidateLoading: false,
      candidateError: '',
    };

    function snapshot() { return clone(state); }
    function publish() { onChange(snapshot()); }

    function syncCatalogBanks() {
      const catalog = typeof catalogApi.snapshot === 'function' ? catalogApi.snapshot() : {};
      const revision = Number(catalog?.contentRevision || 0);
      if (catalogRevision >= 0 && revision !== catalogRevision) candidatePages.clear();
      catalogRevision = revision;
      state.banks = Array.isArray(catalog?.banks) ? clone(catalog.banks) : [];
    }

    async function waitForCatalog() {
      const ready = typeof catalogApi.ready === 'function' ? catalogApi.ready() : catalogApi.ready;
      await ready;
      syncCatalogBanks();
    }

    async function loadSelectedPaper(paperId, { publishLoading = true, forceReload = false } = {}) {
      const id = text(paperId).trim();
      const generation = ++paperGeneration;
      state.selectedPaperId = id;
      state.paperError = '';
      state.paperLoading = Boolean(id);
      state.selectedPaper = id && paperDetails.has(id) ? clone(paperDetails.get(id)) : null;
      if (publishLoading) publish();
      if (!id) {
        state.paperLoading = false;
        publish();
        return null;
      }
      if (!forceReload && paperDetails.has(id)) {
        state.paperLoading = false;
        publish();
        return clone(paperDetails.get(id));
      }
      try {
        const paper = await paperApi.detail(id, { forceReload });
        if (generation !== paperGeneration || state.selectedPaperId !== id) return clone(paper);
        if (paper) paperDetails.set(id, clone(paper));
        state.selectedPaper = paper ? clone(paper) : null;
        state.paperLoading = false;
        publish();
        return clone(paper);
      } catch (error) {
        if (generation === paperGeneration && state.selectedPaperId === id) {
          state.paperLoading = false;
          state.paperError = message(error);
          publish();
        }
        throw error;
      }
    }

    async function initialize({ preferredPaperId = '' } = {}) {
      const [paperState] = await Promise.all([paperApi.ready(), waitForCatalog()]);
      state.papers = Array.isArray(paperState?.papers) ? clone(paperState.papers) : [];
      state.categories = Array.isArray(paperState?.categories) ? clone(paperState.categories) : [];
      const preferred = text(preferredPaperId).trim();
      const selected = state.papers.some(paper => text(paper?.id) === preferred)
        ? preferred
        : text(state.papers[0]?.id).trim();
      state.selectedPaperId = selected;
      state.selectedPaper = null;
      state.paperLoading = Boolean(selected);
      state.paperError = '';
      publish();
      return loadSelectedPaper(selected, { publishLoading: false });
    }

    function selectPaper(paperId, options = {}) {
      return loadSelectedPaper(paperId, options);
    }

    async function selectBank(bankId, options = {}) {
      syncCatalogBanks();
      const id = text(bankId).trim();
      const page = Math.max(1, Math.trunc(Number(options.page || 1)));
      const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(options.pageSize || 12))));
      const search = text(options.search).trim();
      const generation = ++bankGeneration;
      const key = JSON.stringify([id, page, pageSize, search]);
      state.selectedBankId = id;
      state.candidatePage = page;
      state.candidatePageSize = pageSize;
      state.candidateSearch = search;
      state.candidateError = '';
      state.candidateLoading = Boolean(id);
      publish();
      if (!id) {
        state.candidateQuestions = [];
        state.candidateTotal = 0;
        state.candidateLoading = false;
        publish();
        return { questions: [], total: 0, page, pageSize };
      }
      try {
        const result = options.forceReload !== true && candidatePages.has(key)
          ? clone(candidatePages.get(key))
          : await catalogApi.loadBankQuestionPage(id, { page, pageSize, search, forceReload: options.forceReload });
        if (options.forceReload === true || !candidatePages.has(key)) candidatePages.set(key, clone(result));
        if (generation !== bankGeneration || state.selectedBankId !== id) return clone(result);
        state.candidateQuestions = Array.isArray(result?.questions) ? clone(result.questions) : [];
        state.candidateTotal = Math.max(0, Number(result?.total || 0));
        state.candidatePage = Math.max(1, Number(result?.page || page));
        state.candidatePageSize = Math.max(1, Number(result?.pageSize || pageSize));
        state.candidateLoading = false;
        publish();
        return clone(result);
      } catch (error) {
        if (generation === bankGeneration && state.selectedBankId === id) {
          state.candidateLoading = false;
          state.candidateError = message(error);
          publish();
        }
        throw error;
      }
    }

    async function refreshPapers({ preferredPaperId = state.selectedPaperId, shouldApply = () => true } = {}) {
      paperDetails.clear();
      const paperState = await paperApi.ready({ forceReload: true });
      if (!shouldApply()) return snapshot();
      state.papers = Array.isArray(paperState?.papers) ? clone(paperState.papers) : [];
      state.categories = Array.isArray(paperState?.categories) ? clone(paperState.categories) : [];
      const preferred = text(preferredPaperId).trim();
      const selected = state.papers.some(paper => text(paper?.id) === preferred)
        ? preferred
        : text(state.papers[0]?.id).trim();
      state.selectedPaperId = selected;
      state.selectedPaper = null;
      state.paperLoading = Boolean(selected);
      state.paperError = '';
      publish();
      return loadSelectedPaper(selected, { publishLoading: false, forceReload: true });
    }

    return Object.freeze({ initialize, selectPaper, selectBank, refreshPapers, snapshot });
  }

  global.KGPaperManagementDataLoader = Object.freeze({ create });
})(globalThis);
