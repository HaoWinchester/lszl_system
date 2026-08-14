"use strict";

/*
 * 回忆 / 归纳 / 做题三板块于 2026-08-17（周日）14:00 一次性开放。
 * 开放前在学习入口弹窗与三页显示倒计时；开放后永久可用。admin/teacher 不受限。
 */
(function (global) {
  const OPEN_AT = new Date(2026, 7, 17, 14, 0, 0, 0);
  const OPEN_AT_MS = OPEN_AT.getTime();
  const OPEN_LABEL = "8月17日（周日）14:00";
  const SCHEDULED_ENTRIES = Object.freeze({ recall: true, synthesis: true, practice: true });
  const SCHEDULED_DESTINATIONS = Object.freeze({
    "knowledge-recall.html": "recall",
    "question-workspace.html": "synthesis",
    "practice-mode.html": "practice",
  });
  const PAGE_GATES = Object.freeze({
    "knowledge-recall.html": { title: "深度回忆", backHref: "index.html", backLabel: "返回知识图谱" },
    "question-workspace.html": { title: "多题归纳", backHref: "index.html?mode=free", backLabel: "返回知识图谱" },
    "practice-mode.html": { title: "做题模式", backHref: "index.html", backLabel: "返回知识图谱" },
  });

  let entryTimer = null;
  let gateTimer = null;
  let gateRoot = null;

  function canBypass() {
    const api = global.KGRolePermissions;
    if (!api || typeof api.currentRole !== "function") return false;
    const role = String(api.currentRole() || "");
    return role === "admin" || role === "teacher";
  }

  function isOpen(now = Date.now()) {
    if (canBypass()) return true;
    return now >= OPEN_AT_MS;
  }

  function nextOpenAt() {
    return new Date(OPEN_AT_MS);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatCountdown(ms) {
    const remaining = Math.max(0, Number(ms) || 0);
    if (!remaining) return "00:00:00";
    const totalSec = Math.floor(remaining / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return days > 0 ? `${days}天 ${clock}` : clock;
  }

  function countdownLabel(now = Date.now()) {
    if (isOpen(now)) return "";
    return `${OPEN_LABEL} 开放 · 倒计时 ${formatCountdown(OPEN_AT_MS - now)}`;
  }

  function destinationScheduled(destination) {
    return Object.prototype.hasOwnProperty.call(SCHEDULED_DESTINATIONS, String(destination || ""));
  }

  function isDestinationOpen(destination, now = Date.now()) {
    if (!destinationScheduled(destination)) return true;
    return isOpen(now);
  }

  function currentPage() {
    return (global.location?.pathname?.split("/").pop() || "index.html").toLowerCase() || "index.html";
  }

  function ensureEntryBadge(button) {
    let badge = button.querySelector(".learning-entry-countdown");
    if (!badge) {
      badge = global.document.createElement("span");
      badge.className = "learning-entry-countdown";
      badge.setAttribute("aria-live", "polite");
      button.appendChild(badge);
    }
    return badge;
  }

  function refreshEntryCountdowns(root) {
    const doc = global.document;
    if (!root || !doc) return;
    const now = Date.now();
    const open = isOpen(now);
    root.querySelectorAll("[data-learning-entry]").forEach(button => {
      const entry = button.getAttribute("data-learning-entry");
      if (!SCHEDULED_ENTRIES[entry]) return;
      const badge = ensureEntryBadge(button);
      if (open) {
        button.classList.remove("is-scheduled-closed");
        badge.remove();
        return;
      }
      button.classList.add("is-scheduled-closed");
      badge.hidden = false;
      badge.textContent = countdownLabel(now);
    });
  }

  function bindEntryCountdowns(root) {
    refreshEntryCountdowns(root);
    if (isOpen()) return;
    if (entryTimer) global.clearInterval(entryTimer);
    entryTimer = global.setInterval(() => {
      refreshEntryCountdowns(root);
      if (isOpen()) stopEntryCountdowns();
    }, 1000);
  }

  function stopEntryCountdowns() {
    if (!entryTimer) return;
    global.clearInterval(entryTimer);
    entryTimer = null;
  }

  function renderGate(config) {
    return `<div class="learning-open-gate-card" role="dialog" aria-modal="true" aria-labelledby="learningOpenGateTitle">`
      + `<span class="learning-open-gate-kicker">SCHEDULED OPEN</span>`
      + `<h1 id="learningOpenGateTitle">${config.title}尚未开放</h1>`
      + `<p class="learning-open-gate-copy">本板块将于 ${OPEN_LABEL} 开放，请稍后再来。</p>`
      + `<p class="learning-open-gate-countdown" aria-live="polite">${countdownLabel()}</p>`
      + `<a class="learning-open-gate-back" href="${config.backHref}">${config.backLabel}</a>`
      + `</div>`;
  }

  function releaseGateInert() {
    const doc = global.document;
    if (!doc?.body) return;
    Array.from(doc.body.children).forEach(child => {
      child.inert = false;
      child.removeAttribute("aria-hidden");
    });
  }

  function refreshGate() {
    if (!gateRoot) return;
    if (isOpen()) {
      gateRoot.remove();
      gateRoot = null;
      releaseGateInert();
      if (gateTimer) {
        global.clearInterval(gateTimer);
        gateTimer = null;
      }
      return;
    }
    const countdown = gateRoot.querySelector(".learning-open-gate-countdown");
    if (countdown) countdown.textContent = countdownLabel();
  }

  function mountPageGate() {
    const doc = global.document;
    if (!doc || !doc.body || gateRoot || isOpen()) return null;
    const config = PAGE_GATES[currentPage()];
    if (!config) return null;
    gateRoot = doc.createElement("div");
    gateRoot.className = "learning-open-gate-backdrop";
    gateRoot.innerHTML = renderGate(config);
    doc.body.appendChild(gateRoot);
    Array.from(doc.body.children).forEach(child => {
      if (child === gateRoot) return;
      child.inert = true;
      child.setAttribute("aria-hidden", "true");
    });
    gateRoot.querySelector(".learning-open-gate-card")?.setAttribute("tabindex", "-1");
    gateTimer = global.setInterval(refreshGate, 1000);
    refreshGate();
    return gateRoot;
  }

  function schedulePageGate() {
    const doc = global.document;
    if (!doc || !doc.body) return;
    if (isOpen()) return;
    // 新标签页里认证会话是异步恢复的：先等 kg-auth-session-change 再判定，
    // 避免已登录的老师/管理员在新开页面时被倒计时门槛短暂误拦。
    const knownUser = (() => {
      try { return !!global.KGRolePermissions?.currentUser?.(); } catch (e) { return false; }
    })();
    if (knownUser || !global.KGRolePermissions) {
      mountPageGate();
      return;
    }
    let settled = false;
    const proceed = () => {
      if (settled) return;
      settled = true;
      doc.removeEventListener("kg-auth-session-change", proceed);
      if (gateTimer) return; // 已挂载
      mountPageGate();
    };
    doc.addEventListener("kg-auth-session-change", proceed, { once: true });
    global.setTimeout(proceed, 2500);
  }

  const api = Object.freeze({
    OPEN_AT,
    OPEN_AT_MS,
    OPEN_LABEL,
    SCHEDULED_ENTRIES,
    SCHEDULED_DESTINATIONS,
    canBypass,
    isOpen,
    nextOpenAt,
    formatCountdown,
    countdownLabel,
    destinationScheduled,
    isDestinationOpen,
    bindEntryCountdowns,
    refreshEntryCountdowns,
    stopEntryCountdowns,
    mountPageGate,
  });

  global.KGLearningWeeklyOpen = api;

  if (global.document) {
    const boot = () => schedulePageGate();
    if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
})(window);
