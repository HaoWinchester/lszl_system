"use strict";

/*
 * A server-issued login session may claim this prompt exactly once.  The
 * claim remains independent of rendering so competing tabs cannot bypass the
 * required learning-entry choice.
 */
(function (global) {
  const CONSUMED_KEY = "kg_learning_entry_chooser_consumed_v1";
  const CLAIM_KEY = "kg_learning_entry_chooser_claim_v1";
  const CHANNEL = "kg-learning-entry-chooser-v1";
  const SCHEMA_VERSION = 1;
  const ERROR_TEXT = "该学习页面暂时不可用，请稍后重试";
  const CHOICES = [
    { label: "知识图谱", description: "梳理知识结构与关系 · 当前首页", destination: "index.html" },
    { label: "深度回忆", description: "主动回忆关键词与知识线索 · 深度回忆", destination: "knowledge-recall.html" },
    { label: "多题归纳", description: "多题比较、归纳与连接 · 多题画布", destination: "question-workspace.html" },
    { label: "知识星空", description: "按科目与分类探索练习足迹", destination: "knowledge-space" },
  ];
  let active = null;

  function validMarker(value) {
    return value && value.schemaVersion === SCHEMA_VERSION && typeof value.consumedDigest === "string"
      && /^[a-f0-9]{64}$/.test(value.consumedDigest) && Number.isFinite(value.consumedAt);
  }

  function readJSON(storage, key) {
    try { const raw = storage && storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_error) { return null; }
  }

  function writeJSON(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); return true; } catch (_error) { return false; }
  }

  async function sha256(value) {
    const subtle = global.crypto && global.crypto.subtle;
    if (!subtle || typeof global.TextEncoder !== "function") return null;
    try {
      const bytes = new global.TextEncoder().encode(value);
      const digest = await subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    } catch (_error) { return null; }
  }

  async function currentServerSession(auth) {
    if (global.KGAuthSessionBootstrap && typeof global.KGAuthSessionBootstrap.load === "function") {
      try { return await global.KGAuthSessionBootstrap.load(); } catch (_error) { return null; }
    }
    if (auth && typeof auth.getCurrentSession === "function") {
      try { const result = await auth.getCurrentSession(); if (result && typeof result === "object") return result; } catch (_error) {}
    }
    return null;
  }

  function authenticatedSession(session) {
    if (!session || typeof session !== "object" || session.authenticated === false) return null;
    const user = session.user || session.authUser;
    const loginSessionId = session.loginSessionId;
    return user && typeof user === "object" && typeof loginSessionId === "string" && loginSessionId ? loginSessionId : null;
  }

  function consumed(storage, digest) { const marker = readJSON(storage, CONSUMED_KEY); return validMarker(marker) && marker.consumedDigest === digest; }
  function nonce() { return global.crypto && typeof global.crypto.randomUUID === "function" ? global.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
  function nextTurn() { return new Promise(resolve => global.setTimeout(resolve, 0)); }
  function notify(digest) {
    const BroadcastChannel = global.BroadcastChannel;
    if (typeof BroadcastChannel !== "function") return;
    let channel;
    try { channel = new BroadcastChannel(CHANNEL); channel.postMessage({ type: "consumed", digest }); } catch (_error) {} finally { try { channel && channel.close(); } catch (_error) {} }
  }
  async function rollbackConsumption(storage, digest) {
    if (!consumed(storage, digest)) return;
    try { storage.removeItem(CONSUMED_KEY); } catch (_error) { return; }
  }
  async function consume(storage, digest) {
    if (consumed(storage, digest)) return false;
    if (!writeJSON(storage, CONSUMED_KEY, { schemaVersion: SCHEMA_VERSION, consumedDigest: digest, consumedAt: Date.now() })) return false;
    notify(digest); return true;
  }
  async function claimWithLocks(storage, lockName, digest) {
    let shown = false;
    await global.navigator.locks.request(lockName, { mode: "exclusive" }, async function () {
      shown = await consume(storage, digest);
    });
    return shown;
  }
  async function claimWithStorage(storage, digest) {
    if (consumed(storage, digest)) return false;
    const tabNonce = nonce();
    if (!writeJSON(storage, CLAIM_KEY, { digest, nonce: tabNonce, claimedAt: Date.now() })) return false;
    const immediate = readJSON(storage, CLAIM_KEY);
    if (!immediate || immediate.nonce !== tabNonce || immediate.digest !== digest) return false;
    await nextTurn(); await nextTurn();
    const settled = readJSON(storage, CLAIM_KEY);
    return settled && settled.nonce === tabNonce && settled.digest === digest ? consume(storage, digest) : false;
  }

  function element(doc, tag, attributes, text) {
    const node = doc.createElement(tag);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function focusChoices() {
    if (!active) return [];
    const dialog = active.dialog;
    return [
      ...Array.from(dialog.querySelectorAll("[data-learning-entry-choice]")),
      dialog.querySelector("#learningEntryDismissBtn"),
    ].filter(Boolean);
  }
  function setPageInert(doc, dialogRoot) {
    const previous = [];
    // Disable siblings along the dialog's ancestor path, including a fullscreen
    // canvas host, while keeping every ancestor needed to operate it active.
    for (let branch = dialogRoot; branch && branch !== doc.body; branch = branch.parentNode) {
      const parent = branch.parentNode; if (!parent) break;
      Array.from(parent.children).forEach(child => {
        if (child === branch) return;
        previous.push({ child, inert: child.inert, hidden: child.getAttribute("aria-hidden") });
        child.inert = true; child.setAttribute("aria-hidden", "true");
      });
    }
    return () => previous.forEach(({ child, inert, hidden }) => {
      child.inert = inert;
      if (hidden === null) child.removeAttribute("aria-hidden");
      else child.setAttribute("aria-hidden", hidden);
    });
  }
  function restoreGraphFocus(doc) {
    const graph = doc.getElementById("stage") || doc.querySelector(".stage");
    if (graph && typeof graph.focus === "function") {
      if (!graph.getAttribute("tabindex")) graph.setAttribute("tabindex", "-1");
      graph.focus();
    }
  }
  function closeDialog({ focusGraph = false } = {}) {
    if (!active) return false;
    const current = active;
    global.KGLearningWeeklyOpen?.stopEntryCountdowns?.();
    current.document.removeEventListener("keydown", current.onKeydown);
    current.restorePage(); current.unmount();
    if (current.created) current.root.remove();
    else { current.root.classList.remove("show"); current.root.hidden = true; current.root.setAttribute("aria-hidden", "true"); }
    active = null;
    if (typeof global.CustomEvent === "function") global.dispatchEvent(new global.CustomEvent("kg-learning-entry-dialog-closed"));
    if (focusGraph) restoreGraphFocus(current.document);
    else if (current.restoreFocus && typeof current.restoreFocus.focus === "function") current.restoreFocus.focus();
    return true;
  }
  function errorMessage(text) { if (active) active.error.textContent = text || ""; }
  function navigate(location, destination) {
    if (typeof location.assign === "function") location.assign(destination);
    else location.href = destination;
  }
  async function choose(button, choice) {
    if (!active || button.disabled) return;
    if (choice.destination === "knowledge-space") { closeDialog(); void global.KGKnowledgeDashboard?.open(); return; }
    if (choice.destination === "index.html") { closeDialog({ focusGraph: true }); return; }
    if (global.KGLearningWeeklyOpen && !global.KGLearningWeeklyOpen.isDestinationOpen(choice.destination)) {
      errorMessage(global.KGLearningWeeklyOpen.countdownLabel() || "该学习板块尚未开放");
      button.focus();
      return;
    }
    button.disabled = true; button.setAttribute("aria-busy", "true"); errorMessage("");
    try {
      const response = await active.fetch.call(active.fetchReceiver, choice.destination, { credentials: "same-origin" });
      const contentType = response && response.headers && typeof response.headers.get === "function" ? response.headers.get("content-type") : "";
      if (!response || !response.ok || !/\btext\/html\b/i.test(String(contentType || ""))) throw new Error("unavailable");
      navigate(active.location, choice.destination);
    } catch (_error) {
      button.disabled = false; button.setAttribute("aria-busy", "false"); errorMessage(ERROR_TEXT); button.focus();
    }
  }
  function bindOnce(node, eventName, listener) {
    if (!node || node.getAttribute("data-learning-entry-bound") === "true") return;
    node.setAttribute("data-learning-entry-bound", "true");
    node.addEventListener(eventName, listener);
  }
  function showDialog(options) {
    if (active) return active.dialog;
    const doc = options.document || global.document;
    if (!doc || !doc.body || typeof doc.createElement !== "function") return null;
    let root = doc.getElementById("learningEntryModal") || doc.getElementById("learningEntryChooserRoot");
    const created = !root;
    if (!root) {
      root = element(doc, "div", { class: "modal-backdrop learning-entry-backdrop kg-learning-entry-dialog", id: "learningEntryModal", "aria-hidden": "true" });
      const dialog = element(doc, "section", { class: "modal learning-entry-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "learningEntryTitle" });
      const head = element(doc, "div", { class: "learning-entry-head" });
      const heading = element(doc, "div");
      heading.append(element(doc, "h2", { id: "learningEntryTitle" }, "从这里开始学习"), element(doc, "p", {}, "选择你现在最想做的事，直接进入对应学习板块。"));
      head.append(heading);
      const choices = element(doc, "div", { class: "learning-entry-grid" });
      const error = element(doc, "p", { class: "learning-entry-error", id: "learningEntryChooserError", "aria-live": "polite" });
      CHOICES.forEach(choice => {
        const style = { "知识图谱": "entry-graph is-current", "深度回忆": "entry-recall", "多题归纳": "entry-synthesis", "知识星空": "entry-practice" }[choice.label];
        const avatar = { "知识图谱": "图", "深度回忆": "忆", "多题归纳": "归", "知识星空": "星" }[choice.label];
        const button = element(doc, "button", { type: "button", class: `learning-entry-card ${style}`, "data-learning-entry": choice.label, "data-learning-entry-choice": choice.label, "data-destination": choice.destination, "data-description": choice.description });
        button.append(element(doc, "span", { class: "learning-entry-avatar" }, avatar), element(doc, "span", { class: "learning-entry-name" }, choice.label), element(doc, "span", { class: "learning-entry-id" }, choice.description)); choices.append(button);
      });
      const foot = element(doc, "div", { class: "learning-entry-foot" });
      const dismiss = element(doc, "button", { type: "button", id: "learningEntryDismissBtn", "data-learning-entry-focusable": "" }, "进入知识图谱");
      foot.append(element(doc, "span", {}, "以后可从首页右上角“学习入口”再次打开。"), dismiss);
      dialog.append(head, choices, error, foot); root.append(dialog); doc.body.append(root);
    }
    root.classList.add("kg-learning-entry-dialog"); root.hidden = false; root.classList.add("show"); root.setAttribute("aria-hidden", "false");
    if (typeof global.CustomEvent === "function") global.dispatchEvent(new global.CustomEvent("kg-learning-entry-dialog-opened"));
    const dialog = root.querySelector("[role=dialog]") || root.querySelector(".learning-entry-modal");
    const error = root.querySelector("#learningEntryChooserError");
    const buttons = root.querySelectorAll("[data-learning-entry-choice]");
    bindOnce(root.querySelector("#learningEntryDismissBtn"), "click", () => closeDialog({ focusGraph: true }));
    buttons.forEach(button => {
      const choice = CHOICES.find(item => item.label === button.getAttribute("data-learning-entry-choice"));
      if (choice) bindOnce(button, "click", () => choose(button, choice));
    });
    global.KGLearningWeeklyOpen?.bindEntryCountdowns?.(root);
    const onKeydown = event => {
      if (!active || active.dialog !== dialog) return;
      if (event.key === "Escape") { event.preventDefault(); closeDialog({ focusGraph: true }); return; }
      if (event.key !== "Tab") return;
      const items = focusChoices(); if (!items.length) return;
      const index = items.indexOf(doc.activeElement);
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index === items.length - 1 ? 0 : index + 1);
      event.preventDefault(); items[next].focus();
    };
    let restorePage = () => {};
    const syncBackground = () => { restorePage(); restorePage = setPageInert(doc, root); };
    const unmount = global.KGCanvasDomInteraction?.mountOverlay?.(root, undefined, syncBackground) || (() => {});
    syncBackground();
    const fetchImpl = options.fetch || global.fetch;
    active = { document: doc, root, dialog, error, onKeydown, location: options.location || global.location, fetch: fetchImpl, fetchReceiver: fetchImpl === global.fetch ? global : undefined, restoreFocus: doc.activeElement, created, restorePage: () => restorePage(), unmount };
    doc.addEventListener("keydown", onKeydown); focusChoices()[0].focus();
    return dialog;
  }

  async function init(options) {
    const config = options || {}; const storage = config.storage || global.localStorage;
    if (!storage) return { shown: false };
    const loginSessionId = authenticatedSession(await currentServerSession(config.auth || global.KGAuthCore));
    if (!loginSessionId) return { shown: false };
    const digest = await sha256(loginSessionId);
    if (!digest || consumed(storage, digest)) return { shown: false };
    const locks = global.navigator && global.navigator.locks;
    const shown = locks && typeof locks.request === "function" ? await claimWithLocks(storage, `kg-learning-entry-chooser:${loginSessionId}`, digest) : await claimWithStorage(storage, digest);
    if (shown) showDialog(config);
    return { shown: !!shown };
  }

  function bindManualEntry() {
    const doc = global.document;
    const triggers = doc && doc.getElementById ? [doc.getElementById("learningEntryTopBtn"),doc.getElementById("learningEntryMobileBtn")] : [];
    triggers.forEach(trigger=>bindOnce(trigger, "click", event => {
      event.preventDefault();
      showDialog({ document: doc, location: global.location });
    }));
  }

  if (global.document) {
    if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", bindManualEntry, { once: true });
    else bindManualEntry();
  }

  global.KGLearningEntryChooser = { init, show: showDialog };
})(window);
