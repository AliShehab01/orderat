// Orderat web: the one HTTP client for the Edge Functions the phones use (orderat-auth, orderat-sync,
// orderat-parse, orderat-ask, orderat-studio). Transport and error mapping only: every method POSTs one
// JSON body, exactly as server/auth/validate.ts, server/sync/validate.ts and the parse/ask/studio
// validators take it, and resolves with the parsed JSON answer.
//
// Headers: Content-Type: application/json, plus X-Orderat-Session when signed in (not on signin or
// the pairing calls, which run before there is a session). No cookies: the default credentials mode
// never sends any to another origin.
//
// Every failure rejects with a CloudError { kind, status, code }: kind 'offline' (no connection, or no
// answer within the timeout; status 0), 'unauthorized' (401), 'forbidden' (403), 'not_found' (404),
// 'rate_limited' (429), 'invalid' (400, 413 and any other 4xx, such as studio's 422 unsafe_image) or
// 'server' (5xx, or a success answer that is not JSON); code is the answer's JSON `error` when present.
//
// AI calls (parse, ask, studio) get the fields every AI validator requires: installId (one random UUID
// per browser, kept in localStorage), platform 'web', appVersion 'web-1', demo (the body's own, else
// false) and lang (the body's own, else getLang(), else 'ar'). The rest of the body passes through.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrderatCloudApi = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = typeof globalThis !== 'undefined' ? globalThis : self;
  const DEFAULT_BASE_URL = 'https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1';
  const INSTALL_KEY = 'orderat.web.installId';
  const APP_VERSION = 'web-1';
  const TIMEOUT_MS = 30000;
  // A model call (an edited product photo above all) can take far longer than a sync.
  const AI_TIMEOUT_MS = 120000;
  // server/auth/validate.ts MAX_DEVICE_NAME_CHARS.
  const MAX_DEVICE_NAME = 100;

  class CloudError extends Error {
    constructor(kind, status, code, cause) {
      super(code ? `${kind} (${code})` : kind);
      this.name = 'CloudError';
      this.kind = kind;
      this.status = status;
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }

  function kindFor(status) {
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    return status >= 400 && status < 500 ? 'invalid' : 'server';
  }

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  // A lowercase v4 UUID; crypto.randomUUID exists only on secure pages, so fall back to getRandomValues.
  function uuid() {
    const c = G.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID().toLowerCase();
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // One id per browser; a page that cannot keep one (private mode) still sends the same id all visit.
  let pageInstallId = null;
  function installId() {
    let id = null;
    try { id = G.localStorage.getItem(INSTALL_KEY); } catch (e) { id = null; }
    if (typeof id === 'string' && id) return id;
    if (!pageInstallId) pageInstallId = uuid();
    try { G.localStorage.setItem(INSTALL_KEY, pageInstallId); } catch (e) { /* kept for this page only */ }
    return pageInstallId;
  }

  // Rejects as offline when `promise` has not settled after `ms`, and aborts the request.
  function withTimeout(promise, ms, controller) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new CloudError('offline', 0, 'timeout'));
      }, ms);
      promise.then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); },
      );
    });
  }

  async function read(res) {
    let text;
    try { text = await res.text(); } catch (e) { throw new CloudError('offline', 0, 'network', e); }
    let body;
    try { body = text ? JSON.parse(text) : undefined; } catch (e) { body = undefined; }
    if (res.ok) {
      if (isObj(body)) return body;
      throw new CloudError('server', res.status, 'bad_response');
    }
    throw new CloudError(kindFor(res.status), res.status, isObj(body) && typeof body.error === 'string' ? body.error : undefined);
  }

  function createApi(options) {
    const opts = options || {};
    const base = String(opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const getSession = typeof opts.getSession === 'function' ? opts.getSession : () => null;
    const getLang = typeof opts.getLang === 'function' ? opts.getLang : () => 'ar';
    const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : (url, init) => G.fetch(url, init);
    const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : TIMEOUT_MS;
    const aiTimeoutMs = Math.max(timeoutMs, AI_TIMEOUT_MS);

    // A keepalive request survives the tab closing (beforeunload, pagehide), but browsers cap all of
    // them in flight at 64 KB, so only a small sync call asks for it.
    const KEEPALIVE_MAX = 60 * 1024;
    function post(fn, body, withSession, ms, keepalive) {
      const headers = { 'Content-Type': 'application/json' };
      const session = withSession ? getSession() : null;
      if (typeof session === 'string' && session) headers['X-Orderat-Session'] = session;
      const controller = typeof G.AbortController === 'function' ? new G.AbortController() : null;
      const init = { method: 'POST', headers, body: JSON.stringify(body) };
      if (keepalive && init.body.length * 3 <= KEEPALIVE_MAX) init.keepalive = true;
      if (controller) init.signal = controller.signal;
      const answer = Promise.resolve()
        .then(() => fetchImpl(`${base}/${fn}`, init))
        .then(read, error => { throw new CloudError('offline', 0, 'network', error); });
      return withTimeout(answer, ms, controller);
    }

    const authCall = (body, withSession) => post('orderat-auth', body, withSession, timeoutMs);
    const syncCall = (body, keepalive) => post('orderat-sync', body, true, timeoutMs, keepalive);
    function aiCall(fn, body) {
      const b = isObj(body) ? body : {};
      const lang = typeof b.lang === 'string' && b.lang ? b.lang : getLang() || 'ar';
      return post(fn, Object.assign({}, b, { installId: installId(), platform: 'web', appVersion: APP_VERSION, demo: b.demo === true, lang }), true, aiTimeoutMs);
    }

    return {
      signin(p) {
        const q = p || {};
        const deviceName = typeof q.deviceName === 'string' && q.deviceName ? q.deviceName.slice(0, MAX_DEVICE_NAME) : undefined;
        return authCall({ action: 'signin', provider: q.provider, idToken: q.idToken, nonce: q.nonce || undefined, authorizationCode: typeof q.authorizationCode === 'string' && q.authorizationCode ? q.authorizationCode : undefined, deviceName, client: 'web' }, false);
      },
      me: () => authCall({ action: 'me' }, true),
      signout: () => authCall({ action: 'signout' }, true),
      deleteAccount: () => authCall({ action: 'delete_account' }, true),
      pairStart: () => authCall({ action: 'pair_start' }, false),
      pairPoll: (pairId, pollToken) => authCall({ action: 'pair_poll', pairId, pollToken }, false),

      shopsList: () => syncCall({ action: 'shops_list' }),
      sync: p => syncCall({ action: 'sync', shopId: p.shopId, cursor: p.cursor, changes: p.changes }, true),
      inviteCreate: shopId => syncCall({ action: 'invite_create', shopId }),
      membersList: shopId => syncCall({ action: 'members_list', shopId }),
      membersUpdate(shopId, userId, permissions) {
        const p = permissions || {};
        return syncCall({ action: 'members_update', shopId, userId, permissions: { orders: !!p.orders, prepare: !!p.prepare, money: !!p.money, products: !!p.products } });
      },
      membersRemove: (shopId, userId) => syncCall({ action: 'members_remove', shopId, userId }),
      photoUpload: (shopId, mimeType, base64) => syncCall({ action: 'photo_upload', shopId, mimeType, data: base64 }),
      photoUrl: (shopId, photoId) => syncCall({ action: 'photo_url', shopId, photoId }),

      parse: body => aiCall('orderat-parse', body),
      ask: body => aiCall('orderat-ask', body),
      studio: body => aiCall('orderat-studio', body),
    };
  }

  return { createApi, CloudError };
});
