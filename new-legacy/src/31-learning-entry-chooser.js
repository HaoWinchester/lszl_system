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
    { label: "知识图谱", description: "进入知识图谱", destination: "index.html" },
    { label: "知识回忆", description: "深度回忆", destination: "knowledge-recall.html" },
    { label: "知识归纳", description: "归纳", destination: "question-workspace.html" },
    { label: "知识巩固", description: "刷题", destination: "practice-mode.html" },
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

  function sessionFromBootstrap() {
    const entry = global.__KG_DIRECT_BOOTSTRAP__;
    if (!entry || !entry.authUser || typeof entry.authUser !== "object") return null;
    return { authenticated: true, loginSessionId: entry.authUser.loginSessionId, user: entry.authUser };
  }

  async function currentServerSession(auth) {
    if (auth && typeof auth.getCurrentSession === "function") {
      try { const result = await auth.getCurrentSession(); if (result && typeof result === "object") return result; } catch (_error) {}
    }
    return sessionFromBootstrap();
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
    if (typeof storage.flush !== "function") return;
    try { await storage.flush(); } catch (_error) {}
  }
  async function consume(storage, digest) {
    if (consumed(storage, digest)) return false;
    if (!writeJSON(storage, CONSUMED_KEY, { schemaVersion: SCHEMA_VERSION, consumedDigest: digest, consumedAt: Date.now() })) return false;
    if (typeof storage.flush === "function") {
      try {
        if (await storage.flush() === false) {
          await rollbackConsumption(storage, digest);
          return false;
        }
      } catch (_error) {
        await rollbackConsumption(storage, digest);
        return false;
      }
    }
    notify(digest); return true;
  }
  async function claimWithLocks(storage, lockName, digest) {
    let shown = false;
    await global.navigator.locks.request(lockName, { mode: "exclusive" }, async function () { shown = await consume(storage, digest); });
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

  function focusChoices() { return active ? Array.from(active.dialog.querySelectorAll("[data-learning-entry-choice]")) : []; }
  function setPageInert(doc, dialogRoot, inert) {
    Array.from(doc.body.children).forEach(child => {
      if (child === dialogRoot) return;
      child.inert = inert;
      if (inert) child.setAttribute("aria-hidden", "true");
      else child.removeAttribute("aria-hidden");
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
    current.document.removeEventListener("keydown", current.onKeydown);
    setPageInert(current.document, current.root, false);
    if (current.created) current.root.remove();
    else { current.root.classList.remove("show"); current.root.hidden = true; }
    active = null;
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
    if (choice.destination === "index.html") { closeDialog({ focusGraph: true }); return; }
    button.disabled = true; button.setAttribute("aria-busy", "true"); errorMessage("");
    try {
      const response = await active.fetch(choice.destination, { credentials: "same-origin" });
      const contentType = response && response.headers && typeof response.headers.get === "function" ? response.headers.get("content-type") : "";
      if (!response || !response.ok || !/\btext\/html\b/i.test(String(contentType || ""))) throw new Error("unavailable");
      navigate(active.location, choice.destination);
    } catch (_error) {
      button.disabled = false; button.setAttribute("aria-busy", "false"); errorMessage(ERROR_TEXT); button.focus();
    }
  }
  function showDialog(options) {
    if (active) return active.dialog;
    const doc = options.document || global.document;
    if (!doc || !doc.body || typeof doc.createElement !== "function") return null;
    let root = doc.getElementById("learningEntryChooserRoot");
    const created = !root;
    if (!root) {
      root = element(doc, "div", { class: "modal-backdrop learning-entry-chooser-backdrop", id: "learningEntryChooserRoot" });
      const dialog = element(doc, "section", { class: "modal learning-entry-chooser-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "learningEntryChooserTitle" });
      const title = element(doc, "h2", { id: "learningEntryChooserTitle" }, "选择学习方式");
      const intro = element(doc, "p", { class: "learning-entry-chooser-intro" }, "请选择本次学习的进入方式");
      const choices = element(doc, "div", { class: "learning-entry-chooser-grid" });
      const error = element(doc, "p", { class: "learning-entry-chooser-error", id: "learningEntryChooserError", "aria-live": "polite" });
      CHOICES.forEach(choice => {
        const button = element(doc, "button", { type: "button", class: "learning-entry-choice", "data-learning-entry-choice": choice.label, "data-destination": choice.destination, "data-description": choice.description });
        button.append(element(doc, "strong", { class: "learning-entry-choice-title" }, choice.label), element(doc, "span", { class: "learning-entry-choice-description" }, choice.description)); choices.append(button);
      });
      dialog.append(title, intro, choices, error); root.append(dialog); doc.body.append(root);
    }
    root.hidden = false; root.classList.add("show");
    const dialog = root.querySelector("[role=dialog]") || root.querySelector(".learning-entry-chooser-modal");
    const error = root.querySelector("#learningEntryChooserError");
    const buttons = root.querySelectorAll("[data-learning-entry-choice]");
    buttons.forEach((button, index) => button.addEventListener("click", () => choose(button, CHOICES[index])));
    const onKeydown = event => {
      if (!active || active.dialog !== dialog) return;
      if (event.key === "Escape") { event.preventDefault(); return; }
      if (event.key !== "Tab") return;
      const items = focusChoices(); if (!items.length) return;
      const index = items.indexOf(doc.activeElement);
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index === items.length - 1 ? 0 : index + 1);
      event.preventDefault(); items[next].focus();
    };
    active = { document: doc, root, dialog, error, onKeydown, location: options.location || global.location, fetch: options.fetch || global.fetch, restoreFocus: doc.activeElement, created };
    setPageInert(doc, root, true); doc.addEventListener("keydown", onKeydown); focusChoices()[0].focus();
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

  global.KGLearningEntryChooser = { init };
})(window);
