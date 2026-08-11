"use strict";

/*
 * Owns the invisible, once-per-server-login claim only.  The caller decides
 * how a winning claim is rendered, so this asset never creates UI or changes
 * navigation by itself.
 */
(function (global) {
  const CONSUMED_KEY = "kg_learning_entry_chooser_consumed_v1";
  const CLAIM_KEY = "kg_learning_entry_chooser_claim_v1";
  const CHANNEL = "kg-learning-entry-chooser-v1";
  const SCHEMA_VERSION = 1;

  function validMarker(value) {
    return value
      && value.schemaVersion === SCHEMA_VERSION
      && typeof value.consumedDigest === "string"
      && /^[a-f0-9]{64}$/.test(value.consumedDigest)
      && Number.isFinite(value.consumedAt);
  }

  function readJSON(storage, key) {
    try {
      const raw = storage && storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function writeJSON(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function sha256(value) {
    const subtle = global.crypto && global.crypto.subtle;
    if (!subtle || typeof global.TextEncoder !== "function") return null;
    try {
      const bytes = new global.TextEncoder().encode(value);
      const digest = await subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    } catch (_error) {
      return null;
    }
  }

  function sessionFromBootstrap() {
    const entry = global.__KG_DIRECT_BOOTSTRAP__;
    if (!entry || !entry.authUser || typeof entry.authUser !== "object") return null;
    return {
      authenticated: true,
      loginSessionId: entry.authUser.loginSessionId,
      user: entry.authUser,
    };
  }

  async function currentServerSession(auth) {
    if (auth && typeof auth.getCurrentSession === "function") {
      try {
        const result = await auth.getCurrentSession();
        if (result && typeof result === "object") return result;
      } catch (_error) {
        // Bootstrap can still have the already-resolved server session.
      }
    }
    return sessionFromBootstrap();
  }

  function authenticatedSession(session) {
    if (!session || typeof session !== "object" || session.authenticated === false) return null;
    const user = session.user || session.authUser;
    const loginSessionId = session.loginSessionId;
    if (!user || typeof user !== "object" || typeof loginSessionId !== "string" || !loginSessionId) return null;
    return loginSessionId;
  }

  function consumed(storage, digest) {
    const marker = readJSON(storage, CONSUMED_KEY);
    return validMarker(marker) && marker.consumedDigest === digest;
  }

  function nonce() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function nextTurn() {
    return new Promise(resolve => global.setTimeout(resolve, 0));
  }

  function notify(digest) {
    const BroadcastChannel = global.BroadcastChannel;
    if (typeof BroadcastChannel !== "function") return;
    let channel;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.postMessage({ type: "consumed", digest });
    } catch (_error) {
      // localStorage remains the durable coordination source.
    } finally {
      try { channel && channel.close(); } catch (_error) {}
    }
  }

  function consume(storage, digest) {
    if (consumed(storage, digest)) return false;
    const marker = { schemaVersion: SCHEMA_VERSION, consumedDigest: digest, consumedAt: Date.now() };
    if (!writeJSON(storage, CONSUMED_KEY, marker)) return false;
    notify(digest);
    return true;
  }

  async function claimWithLocks(storage, lockName, digest) {
    let shown = false;
    await global.navigator.locks.request(lockName, { mode: "exclusive" }, async function () {
      shown = consume(storage, digest);
    });
    return shown;
  }

  async function claimWithStorage(storage, digest) {
    if (consumed(storage, digest)) return false;
    const tabNonce = nonce();
    const claim = { digest, nonce: tabNonce, claimedAt: Date.now() };
    if (!writeJSON(storage, CLAIM_KEY, claim)) return false;
    const immediatelyRead = readJSON(storage, CLAIM_KEY);
    if (!immediatelyRead || immediatelyRead.nonce !== tabNonce || immediatelyRead.digest !== digest) return false;

    // Give competing tabs two storage-event turns, then prove our claim still
    // owns the shared record before writing the durable consumed marker.
    await nextTurn();
    await nextTurn();
    const settledClaim = readJSON(storage, CLAIM_KEY);
    if (!settledClaim || settledClaim.nonce !== tabNonce || settledClaim.digest !== digest) return false;
    return consume(storage, digest);
  }

  async function init(options) {
    const config = options || {};
    const auth = config.auth || global.KGAuthCore;
    const storage = config.storage || global.localStorage;
    if (!storage) return { shown: false };

    const loginSessionId = authenticatedSession(await currentServerSession(auth));
    if (!loginSessionId) return { shown: false };

    const digest = await sha256(loginSessionId);
    if (!digest || consumed(storage, digest)) return { shown: false };

    const lockName = `kg-learning-entry-chooser:${loginSessionId}`;
    const locks = global.navigator && global.navigator.locks;
    const shown = locks && typeof locks.request === "function"
      ? await claimWithLocks(storage, lockName, digest)
      : await claimWithStorage(storage, digest);
    return { shown: !!shown };
  }

  global.KGLearningEntryChooser = { init };
})(window);
