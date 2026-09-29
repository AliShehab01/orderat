// Orderat web: signing in. Google Identity Services and Sign in with Apple JS helpers (index.html loads
// both SDKs; without them the helpers say so instead of throwing at load), the stored session, the
// invoice device code, and signing in from the phone ("pairing").
//
// googleButton(el, onToken, buttonOptions?) → false when the Google script is missing. onToken gets
//   { provider: 'google', idToken, rawNonce }; Google puts the raw nonce in the token as it is.
// appleSignIn() → { provider: 'apple', idToken, rawNonce }; Apple gets sha256hex(rawNonce), like iOS.
//   Services ID and redirect URI come from window.ORDERAT_CONFIG (appleServicesId, appleRedirectUri).
// Either result goes to api.signin({ provider, idToken, nonce: rawNonce, deviceName }), whose
// { session, user } answer goes to setSession().
// getSession() → the session string or null; the store is localStorage 'orderat.web.session' =
//   { session, user, at }. A browser that stores nothing keeps it for the visit.
// deviceCode(session) → the first 2 hex characters of SHA-256(session), upper-cased (the iPhone's
//   CryptoUtil.deviceCode); '' without a session.
// startPairing(api, { onCode, intervalMs = 2000 }) → { cancel(), done }: asks for a code, shows it via
//   onCode({ code, qrText: 'orderat://pair?code=' + code, expiresAt }), polls until the phone approves
//   (done resolves { session, user }, already stored), the code expires (done rejects with CloudError
//   kind 'not_found', code 'expired'), or cancel() (done rejects with an AbortError). A dropped
//   connection or a busy server does not end it; the expiry time does.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cloud-api.js'));
  else root.OrderatCloudAuth = factory(root.OrderatCloudApi);
})(typeof self !== 'undefined' ? self : this, function (cloudApi) {
  'use strict';

  const G = typeof globalThis !== 'undefined' ? globalThis : self;
  const SESSION_KEY = 'orderat.web.session';
  // The Orderat Web OAuth client, which orderat-auth accepts as a Google audience.
  const GOOGLE_CLIENT_ID = '799835600648-rj4qq9ia615jfob5eg6k4lgop3aq3i6l.apps.googleusercontent.com';
  const QR_PREFIX = 'orderat://pair?code=';
  // Poll failures worth waiting out; the code's expiry still ends the wait.
  const TRANSIENT = { offline: true, server: true, rate_limited: true };

  const config = () => (G.ORDERAT_CONFIG && typeof G.ORDERAT_CONFIG === 'object' ? G.ORDERAT_CONFIG : {});

  function failure(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }
  function cloudError(kind, status, code) {
    if (cloudApi && cloudApi.CloudError) return new cloudApi.CloudError(kind, status, code);
    const error = failure(code);
    return Object.assign(error, { name: 'CloudError', kind, status });
  }

  // ---------- Session ----------

  let visit = null; // the session, when the browser refuses to store it
  let visitOnly = false;

  // The stored { session, user, at }, or null. Only a store that cannot be read falls back to the visit's copy.
  function stored() {
    let value = visit;
    if (!visitOnly) {
      let raw = null, readable = true;
      try { raw = G.localStorage.getItem(SESSION_KEY); } catch (e) { readable = false; }
      if (readable) {
        try { value = JSON.parse(raw); } catch (e) { value = null; }
      }
    }
    return value && typeof value === 'object' && typeof value.session === 'string' && value.session ? value : null;
  }
  function getSession() {
    const value = stored();
    return value ? value.session : null;
  }
  function getUser() {
    const value = stored();
    return value && value.user && typeof value.user === 'object' ? value.user : null;
  }
  function setSession(s) {
    const session = typeof s === 'string' ? s : s && s.session;
    const user = s && typeof s === 'object' && s.user ? s.user : null;
    visit = { session, user, at: new Date().toISOString() };
    visitOnly = false;
    try { G.localStorage.setItem(SESSION_KEY, JSON.stringify(visit)); } catch (e) { visitOnly = true; }
  }
  function clearSession() {
    visit = null;
    visitOnly = false;
    try { G.localStorage.removeItem(SESSION_KEY); } catch (e) { /* nothing was stored */ }
  }

  // ---------- Hashes and nonces ----------

  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

  async function sha256hex(text) {
    const subtle = G.crypto && G.crypto.subtle;
    if (!subtle) throw failure('crypto_unavailable'); // only on a page that is not https or localhost
    return hex(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(String(text)))));
  }
  async function deviceCode(session) {
    return typeof session === 'string' && session ? (await sha256hex(session)).slice(0, 2).toUpperCase() : '';
  }
  function randomNonce() {
    const bytes = new Uint8Array(32);
    G.crypto.getRandomValues(bytes);
    return hex(bytes);
  }

  // ---------- Google and Apple ----------

  function googleButton(el, onToken, buttonOptions) {
    const gis = G.google && G.google.accounts && G.google.accounts.id;
    if (!gis || !el) return false;
    const rawNonce = randomNonce();
    gis.initialize({
      client_id: config().googleClientId || GOOGLE_CLIENT_ID,
      nonce: rawNonce,
      callback: response => {
        if (response && typeof response.credential === 'string' && response.credential) onToken({ provider: 'google', idToken: response.credential, rawNonce });
      },
    });
    gis.renderButton(el, Object.assign({ type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' }, buttonOptions));
    return true;
  }

  async function appleSignIn() {
    const apple = G.AppleID && G.AppleID.auth;
    if (!apple) throw failure('apple_unavailable');
    const cfg = config();
    if (!cfg.appleServicesId || !cfg.appleRedirectUri) throw failure('apple_not_configured');
    const rawNonce = randomNonce();
    apple.init({ clientId: cfg.appleServicesId, scope: 'name email', redirectURI: cfg.appleRedirectUri, usePopup: true, nonce: await sha256hex(rawNonce) });
    const response = await apple.signIn();
    const idToken = response && response.authorization && response.authorization.id_token;
    if (typeof idToken !== 'string' || !idToken) throw failure('apple_no_token');
    return { provider: 'apple', idToken, rawNonce };
  }

  // ---------- Pairing with the phone ----------

  function startPairing(api, options) {
    const opts = options || {};
    const onCode = typeof opts.onCode === 'function' ? opts.onCode : () => {};
    const intervalMs = opts.intervalMs > 0 ? opts.intervalMs : 2000;
    let cancelled = false, timer = null, fail = null;

    const done = new Promise((resolve, reject) => {
      fail = reject;
      Promise.resolve()
        .then(() => api.pairStart())
        .then(start => {
          if (cancelled) return;
          const code = String(start.code);
          const expiresAt = Date.parse(start.expiresAt);
          onCode({ code, qrText: QR_PREFIX + code, expiresAt: start.expiresAt });
          const wait = () => { timer = setTimeout(poll, intervalMs); };
          const poll = () => {
            timer = null;
            if (cancelled) return;
            if (Date.now() >= expiresAt) return reject(cloudError('not_found', 404, 'expired'));
            Promise.resolve().then(() => api.pairPoll(start.pairId, start.pollToken)).then(answer => {
              if (cancelled) return;
              const status = answer && answer.status;
              if (status === 'approved' && typeof answer.session === 'string' && answer.session) {
                const result = { session: answer.session, user: answer.user || null };
                setSession(result);
                resolve(result);
              } else if (status === 'expired') reject(cloudError('not_found', 404, 'expired'));
              else wait();
            }, error => {
              if (cancelled) return;
              if (error && error.name === 'CloudError' && TRANSIENT[error.kind]) wait();
              else reject(error);
            });
          };
          wait();
        })
        .catch(error => { if (!cancelled) reject(error); });
    });
    done.catch(() => {}); // a caller that cancels need not handle the rejection

    return {
      done,
      cancel() {
        if (cancelled) return;
        cancelled = true;
        if (timer) clearTimeout(timer);
        const error = failure('cancelled');
        error.name = 'AbortError';
        fail(error);
      },
    };
  }

  return { googleButton, appleSignIn, getSession, getUser, setSession, clearSession, deviceCode, sha256hex, startPairing };
});
