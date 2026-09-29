'use strict';
// Orderat web: the signed-in ("live") mode. The start screen (Google, Apple, log in with the phone, or
// the demo), the shop picker, the paid gate, and the live shop itself: S is this browser's display prefs
// (lang, addressAs, theme) plus the cloud state from cloud-sync.js, edits go to the cloud with
// sync.commit(S) 800 ms after save(), and other devices' changes arrive with sync.pull(S) every 20 s and
// when the tab comes back. The pure rules live in live-core.js; this file is the screens and the wiring.
//
// Loaded before app.js and only called after it has run, so it uses app.js's globals (S, D, render, t,
// esc, icon, toast, openModal...) at call time. app.js asks Live.on to decide between the demo and the
// live shop; the demo (local data, simulated features) is unchanged and needs no account.
//
// Rules from cloud-sync.js: adopt every onChange state into S in place; never keep a web object across
// an onChange (forms look records up by id on save); always hand S itself to commit() and pull().

const Live = (() => {
  const core = () => window.OrderatLiveCore;
  const Auth = () => window.OrderatCloudAuth;
  const SHOP_KEY = 'orderat.web.shop';
  const PREFS_KEY = 'orderat.web.prefs';
  const SAVE_DELAY = 800;
  const PULL_EVERY = 20000;
  const PHOTO_MAX_BYTES = 1024 * 1024; // orderat-sync photo_upload
  const AI_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // orderat-parse / orderat-studio
  // The web studio's style ids → content/studio-styles.json ids.
  const STUDIO_IDS = { white: 'white', marble: 'marble', pastel: 'pastel', wood: 'wood', flowers: 'flatlay_flowers', dark: 'dark_luxury' };
  const ASPECTS = { square: '1:1', portrait: '4:5', story: '9:16' };

  let client = null;
  let sync = null, shopId = null, deviceCode = '', shops = [];
  let on = false;
  let screen = null; // 'start' | 'pair' | 'loading' | 'shops' | 'noShops' | 'ended' | 'error' | null
  let info = {}; // what the current screen shows (a message, a retry)
  let pairing = null, pair = null; // { code, qrText, state: 'loading' | 'waiting' | 'expired' | 'failed' }
  let saveTimer = 0, pullTimer = 0, offline = false, lastSynced = null, deferred = false, listening = false;
  let nos = new Map();
  let team = null; // { members, invite, error, loading }
  const photoUrls = new Map(), photoLoading = new Set();
  const askHistory = [];

  const api = () => {
    if (!client) client = window.OrderatCloudApi.createApi({ baseUrl: (window.ORDERAT_CONFIG || {}).apiBase, getSession: Auth().getSession, getLang: () => S.lang });
    return client;
  };
  const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* this visit only */ } };
  const access = () => core().access(sync ? sync.membership : null);
  const can = k => !on || !!access()[k];
  const aiDemo = () => core().aiDemo(S.subscription, sync && sync.membership ? sync.membership.role : null, new Date());
  const minor = v => OrderatCloudMap.toMinor(v, currency()[0]);
  const user = () => Auth().getUser() || {};
  const accountName = () => user().email || user().name || '';
  const storeLinks = () => (window.ORDERAT_CONFIG || {}).storeLinks || {};

  // ---------- Device prefs ----------

  function readPrefs() {
    try { return JSON.parse(read(PREFS_KEY)) || {}; } catch { return {}; }
  }
  // lang, addressAs and theme go into the demo's own store (shared by both modes); the rest into PREFS_KEY.
  function writePrefs() {
    let d = null;
    try { d = JSON.parse(read(STORE_KEY)); } catch { d = null; }
    if (!d || d.v !== 1) d = { v: 1, onboarded: false };
    Object.assign(d, { lang: S.lang, addressAs: S.addressAs, theme: S.theme });
    write(STORE_KEY, JSON.stringify(d));
    write(PREFS_KEY, JSON.stringify({ askEnabled: S.askEnabled !== false, hiddenCampaigns: S.hiddenCampaigns || [] }));
  }
  function liveState() {
    const p = readPrefs();
    return {
      v: 1, lang: S.lang, addressAs: S.addressAs, theme: S.theme, onboarded: true, live: true, isDemo: false,
      askEnabled: p.askEnabled !== false, hiddenCampaigns: Array.isArray(p.hiddenCampaigns) ? p.hiddenCampaigns : [],
      webOrders: [], nextOrderNo: 1, cloud: { signedIn: true, email: accountName(), team: [], invite: null },
      shopLink: { slug: '', bio: '', leadDays: 1, delivery: 'both', acceptsWebOrders: true, showAll: true, published: false },
      shop: { nameAr: '', nameEn: '', phone: '', currency: 'BHD', pickupHours: '', dailyCapacity: null, businessType: 'home' },
      vat: { enabled: false, trn: '', pricesInclude: true, rateBps: null }, stockEnabled: false,
      products: [], customers: [], orders: [], expenses: [], occasions: [], waTemplates: null, subscription: null,
    };
  }

  // ---------- Screens outside the shop ----------

  function show(name, data) {
    screen = name;
    info = data || {};
    render();
  }
  const card = (body, cls = '') => `<div class="onb"><div class="onb-card ${cls}">
    <div class="onb-head"><img src="favicon.svg" width="56" height="56" alt=""><button class="pill" data-act="lang">${icon('globe')} ${esc(t('web.switchLang'))}</button></div>
    ${body}</div></div>`;
  const storeText = () => {
    const l = storeLinks();
    const one = (href, soon, get) => (href ? `<a class="chip" href="${esc(href)}" target="_blank" rel="noopener">${esc(t(get))}</a>` : `<span class="chip static">${esc(t(soon))}</span>`);
    return `<div class="chips wrap store">${one(l.ios, 'store.iosSoon', 'store.ios')}${one(l.android, 'store.androidSoon', 'store.android')}</div>`;
  };
  const APPLE_LOGO = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.8-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.5.9-1.4 1.3-2.7 1.3-2.8 0 0-2.4-1-2.4-4.2ZM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4Z"/></svg>';

  function viewStart() {
    const busy = info.busy;
    return card(`<h1>${esc(t('start.title'))}</h1>
      <p class="muted">${esc(t('start.subtitle'))}</p>
      <div class="signin">
        <div id="g-btn" class="g-btn" aria-live="polite"><span class="muted small">${esc(t('start.googleLoading'))}</span></div>
        <button class="btn apple block" data-act="live-apple"${busy ? ' disabled' : ''}>${APPLE_LOGO} ${esc(t('start.apple'))}</button>
        <button class="btn ghost block" data-act="live-pair"${busy ? ' disabled' : ''}>${icon('link')} ${esc(t('start.phone'))}</button>
      </div>
      ${busy ? `<p class="muted small center">${esc(t('start.signingIn'))}</p>` : ''}
      ${info.error ? `<p class="form-error" role="alert">${esc(info.error)}</p>` : ''}
      <div class="or"><span>${esc(t('start.or'))}</span></div>
      <button class="btn primary block big" data-act="live-demo">${esc(t(S.onboarded ? 'start.backToDemo' : 'start.demo'))}</button>
      <p class="note">${esc(t('start.note'))}</p>`, 'start');
  }
  function afterStart() {
    let tries = 0;
    const mount = () => {
      const el = $('#g-btn');
      if (!el || screenName() !== 'start') return;
      const width = Math.min(400, Math.max(200, el.clientWidth || 300)); // Google's button is at most 400 px
      if (Auth().googleButton(el, signIn, { locale: S.lang, width, text: 'continue_with' })) return;
      if (++tries < 24) setTimeout(mount, 500);
      else el.innerHTML = `<span class="muted small">${esc(t('start.googleMissing'))}</span>`;
    };
    mount();
  }

  function qrSvg(text) {
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    return `<svg class="qr" viewBox="-4 -4 ${n + 8} ${n + 8}" role="img" aria-label="QR"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  function viewPair() {
    const p = pair || { state: 'loading' };
    const code = p.code ? `${p.code.slice(0, 3)} ${p.code.slice(3)}` : '';
    const box = p.state === 'waiting'
      ? `<div class="pair-box"><div class="pair-qr">${qrSvg(p.qrText)}</div><p class="pair-code" dir="ltr">${esc(code)}</p><p class="muted small center">${esc(t('pair.waiting'))}</p></div>`
      : p.state === 'loading'
        ? `<div class="pair-box"><p class="muted center">${esc(t('pair.loading'))}</p></div>`
        : `<div class="pair-box"><p class="form-error center" role="alert">${esc(t(p.state === 'expired' ? 'pair.expired' : 'pair.failed'))}</p><button class="btn primary" data-act="live-pair">${esc(t('pair.newCode'))}</button></div>`;
    return card(`<h1>${esc(t('pair.title'))}</h1>
      <ol class="steps"><li>${esc(t('pair.step1'))}</li><li>${esc(t('pair.step2'))}</li><li>${esc(t('pair.step3'))}</li></ol>
      ${box}
      <p class="note">${esc(t('pair.hint'))}</p>
      <button class="btn ghost block" data-act="live-start">${icon('back')} ${esc(t('common.back'))}</button>`, 'start');
  }
  function startPair() {
    if (pairing) pairing.cancel();
    pair = { state: 'loading' };
    const p = Auth().startPairing(api(), { onCode: c => { if (pairing === p) { pair = { state: 'waiting', code: String(c.code), qrText: c.qrText }; render(); } } });
    pairing = p;
    show('pair');
    p.done.then(result => {
      if (pairing !== p) return;
      pairing = null;
      const who = result.user && (result.user.email || result.user.name);
      if (who) toast(t('live.signedInAs', who));
      openAccount();
    }, error => {
      if (pairing !== p || (error && error.name === 'AbortError')) return;
      pairing = null;
      pair = { state: error && error.code === 'expired' ? 'expired' : 'failed' };
      if (screen === 'pair') render();
    });
  }
  function stopPair() {
    if (pairing) { const p = pairing; pairing = null; p.cancel(); }
  }

  function deviceName() {
    const ua = navigator.userAgent || '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
    return `Orderat Web · ${browser}${os ? ' on ' + os : ''}`;
  }
  function signIn(token) {
    info = { busy: true };
    if (screen === 'start' || screen === null) { screen = 'start'; render(); }
    return api().signin({ provider: token.provider, idToken: token.idToken, nonce: token.rawNonce, deviceName: deviceName() })
      .then(answer => {
        Auth().setSession(answer);
        const who = answer.user && (answer.user.email || answer.user.name);
        if (who) toast(t('live.signedInAs', who));
        openAccount();
      })
      .catch(error => show('start', { error: error && error.kind === 'offline' ? t('ai.offline') : t('start.error') }));
  }
  function appleSignIn() {
    Auth().appleSignIn().then(signIn, error => {
      const code = error && (error.error || error.code);
      if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return;
      show('start', { error: code === 'apple_unavailable' ? t('start.appleMissing') : t('start.error') });
    });
  }

  const loadingView = () => card(`<div class="loading"><span class="spinner" aria-hidden="true"></span><p>${esc(info.msg || t('live.opening'))}</p>${accountName() ? `<p class="muted small">${esc(t('live.signedInAs', accountName()))}</p>` : ''}</div>`, 'start');
  function viewShops() {
    const rows = shops.map(s => `<button class="row" data-act="live-open-shop" data-id="${esc(s.shopId)}"><span class="avatar">${esc(initial(s.name || 'O'))}</span><span class="row-main"><b>${esc(s.name || t('shops.unnamed'))}</b><small>${esc(t(s.role === 'owner' ? 'cloud.team.owner' : 'shops.staff'))}</small></span>${icon('chev', 'chev')}</button>`).join('');
    return card(`<h1>${esc(t('shops.title'))}</h1><p class="muted small">${esc(t('live.signedInAs', accountName()))}</p><div class="card list">${rows}</div>
      <button class="btn ghost block" data-act="live-sign-out">${esc(t('cloud.signOut'))}</button>`, 'start');
  }
  const viewNoShops = () => card(`<h1>${esc(t('noShops.title'))}</h1><p class="muted">${esc(t('noShops.body'))}</p>${storeText()}
      <p class="muted small">${esc(t('live.signedInAs', accountName()))}</p>
      <button class="btn primary block" data-act="live-account">${esc(t('noShops.again'))}</button>
      <button class="btn ghost block" data-act="live-demo">${esc(t('start.demo'))}</button>
      <button class="btn ghost block" data-act="live-sign-out">${esc(t('cloud.signOut'))}</button>`, 'start');
  const viewEnded = () => card(`<h1>${esc(t('ended.title'))}</h1><p class="muted">${esc(t('ended.body'))}</p>${storeText()}
      ${shops.length > 1 ? `<button class="btn primary block" data-act="live-switch">${esc(t('live.switchShop'))}</button>` : ''}
      <button class="btn ghost block" data-act="live-sign-out">${esc(t('cloud.signOut'))}</button>`, 'start');
  const viewError = () => card(`<h1>${esc(t('live.errorTitle'))}</h1><p class="muted">${esc(info.msg || t('live.error'))}</p>
      <button class="btn primary block" data-act="live-retry">${esc(t('live.retry'))}</button>
      <button class="btn ghost block" data-act="live-sign-out">${esc(t('cloud.signOut'))}</button>`, 'start');

  const screenName = () => screen || (!on && (!S.onboarded || route()[0] === 'start') ? 'start' : null);
  // The screen to show instead of the app, or null.
  function gate() {
    const name = screenName();
    if (!name) return null;
    const views = { start: [viewStart, afterStart], pair: [viewPair], loading: [loadingView], shops: [viewShops], noShops: [viewNoShops], ended: [viewEnded], error: [viewError] };
    if (name === 'start' && !screen && !S.onboarded && info.demoPick) return null; // "Try the demo" → the business-type picker
    const [view, after] = views[name];
    return { title: t(name === 'pair' ? 'pair.title' : name === 'ended' ? 'ended.title' : 'start.title'), html: view(), after };
  }

  // ---------- Account and shop ----------

  async function openAccount(options) {
    stopShop();
    show('loading', { msg: t('live.loadingShops') });
    let answer;
    try {
      answer = await api().shopsList();
    } catch (error) {
      if (error && error.kind === 'unauthorized') return signedOut(t('live.sessionEnded'));
      return show('error', { retry: () => openAccount(options), msg: error && error.kind === 'offline' ? t('ai.offline') : t('live.error') });
    }
    if (screen !== 'loading') return; // signed out meanwhile
    shops = Array.isArray(answer.shops) ? answer.shops : [];
    if (!shops.length) return show('noShops');
    const remembered = read(SHOP_KEY);
    const pick = options && options.choose ? null : shops.find(s => s.shopId === remembered) || (shops.length === 1 ? shops[0] : null);
    if (pick) return openShop(pick.shopId);
    show('shops');
  }

  async function openShop(id) {
    stopShop();
    write(SHOP_KEY, id);
    show('loading', { msg: t('live.opening') });
    deviceCode = await Auth().deviceCode(Auth().getSession()).catch(() => '');
    S = liveState();
    D = null; E = null;
    ASK.msgs = []; askHistory.length = 0;
    Object.assign(ST, { photo: null, result: null, busy: false, left: undefined, campaign: null });
    Object.assign(CAP, { ai: '', busy: false });
    // Only the current shop's engine may touch S (one being stopped may still send a last edit).
    const s = OrderatCloudSync.createSync({
      api: api(), map: OrderatCloudMap, shopId: id, ctx: { deviceCode },
      onChange: state => { if (sync === s) onChange(state); },
      onNotice: (kind, detail) => { if (sync === s) notice(kind, detail); },
    });
    sync = s;
    shopId = id;
    try {
      await s.start();
    } catch (error) {
      if (sync !== s) return;
      s.stop();
      sync = null;
      if (error && error.kind === 'unauthorized') return signedOut(t('live.sessionEnded'));
      if (error && error.kind === 'forbidden') { write(SHOP_KEY, null); toast(t('live.noAccess')); return openAccount({ choose: true }); }
      return show('error', { retry: () => openShop(id), msg: error && error.kind === 'offline' ? t('ai.offline') : t('live.error') });
    }
    if (sync !== s) return;
    lastSynced = new Date();
    if (!core().subscriptionAllowed(S.subscription, new Date())) return endShop();
    on = true;
    screen = null;
    info = {};
    listen();
    pullTimer = setInterval(() => { if (document.visibilityState !== 'hidden') pull(); }, PULL_EVERY);
    lastPath = '';
    const tab = route()[0];
    if (!tab || tab === 'start' || !VIEWS[tab]) go('today'); else render();
  }

  function stopShop() {
    clearInterval(pullTimer);
    pullTimer = 0;
    const s = sync, last = saveTimer && on;
    clearTimeout(saveTimer);
    saveTimer = 0;
    sync = null;
    // The last edit before leaving still goes out; stop() is for good, so only after it.
    if (s && last) s.commit(S).finally(() => s.stop());
    else if (s) s.stop();
    on = false;
    shopId = null;
    team = null;
    nos = new Map();
    setOffline(false);
  }
  function endShop() {
    stopShop();
    show('ended');
  }
  // Back to the start screen; the demo's own data is still there.
  function signedOut(message) {
    stopPair();
    stopShop();
    Auth().clearSession();
    write(SHOP_KEY, null);
    shops = [];
    S = loadState();
    D = null;
    ST.left = 3; // the demo studio's own count
    lastPath = '';
    show('start', message ? { error: message } : {});
  }
  function signOut() {
    if (!confirm(t('live.signOutConfirm'))) return;
    const out = api().signout().catch(() => {});
    signedOut();
    return out;
  }

  // ---------- Sync wiring ----------

  function onChange(state) {
    Object.assign(S, state);
    nos = core().orderNumbers(S.orders);
    lastSynced = new Date();
    if (!on) return;
    if (!core().subscriptionAllowed(S.subscription, new Date())) return endShop();
    refresh();
  }
  // Re-renders unless the seller is typing in the page; then after they leave the field.
  function refresh() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('#app') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { deferred = true; return; }
    deferred = false;
    render();
  }
  function notice(kind, detail) {
    if (kind === 'offline') return setOffline(true);
    if (kind === 'unauthorized') return signedOut(t('live.sessionEnded'));
    if (kind === 'no_access') {
      write(SHOP_KEY, null);
      toast(t('live.noAccess'));
      return openAccount({ choose: true });
    }
    if (kind === 'rate_limited') return;
    if (kind === 'conflict') return toast(t('live.conflict'));
    if (kind === 'forbidden') return toast(t('live.forbidden'));
    if (kind === 'invalid' && Array.isArray(detail)) return toast(t('live.tooLarge'));
    toast(t('live.serverError'));
  }
  const settled = ok => { if (ok) { setOffline(false); lastSynced = new Date(); } return ok; };
  function commit() {
    return sync && on ? sync.commit(S).then(settled, () => false) : Promise.resolve(false);
  }
  function pull() {
    return sync && on ? sync.pull(S).then(settled, () => false) : Promise.resolve(false);
  }
  function save() {
    writePrefs();
    if (!on || !sync) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = 0; commit(); }, SAVE_DELAY);
  }
  function setOffline(value) {
    if (offline === value) return;
    offline = value;
    let el = document.getElementById('live-banner');
    if (!value) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'live-banner';
      el.className = 'live-banner';
      el.setAttribute('role', 'status');
      document.body.append(el);
    }
    el.textContent = t('live.offline');
  }
  function listen() {
    if (listening) return;
    listening = true;
    document.addEventListener('visibilitychange', () => { if (on && document.visibilityState === 'visible') pull(); });
    window.addEventListener('online', () => { if (on) pull(); });
    window.addEventListener('beforeunload', e => {
      if (!on || !sync) return;
      const waiting = !!saveTimer || sync.pending > 0;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; commit(); }
      if (waiting) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('focusout', () => setTimeout(() => { if (deferred && on) refresh(); }, 0));
  }

  // ---------- Helpers app.js uses in live mode ----------

  const newId = () => OrderatCloudMap.newId();
  const invoiceStore = { getItem: k => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) };
  const issueInvoice = () => core().nextInvoice(invoiceStore, shopId, deviceCode);
  function noOf(o) {
    if (!nos.has(o.id)) nos = core().orderNumbers(S.orders);
    return nos.get(o.id) || 0;
  }
  const invoiceNo = o => core().invoiceLabel(o) || `#${noOf(o)}`;
  const vatOf = o => (typeof o.vatIncluded === 'boolean' && o.vatRateBps > 0 ? o.vatRateBps / 100 : 0);
  function totals(o) {
    const d = currency()[0], u = Math.pow(10, d), m = core().orderMinor(o, d);
    const subtotal = o.vatIncluded === true ? m.itemsAndDelivery - m.vat : m.itemsAndDelivery;
    return { subtotal: subtotal / u, vat: m.vat / u, total: m.total / u, paid: m.paid / u, due: Math.max(0, m.due) / u };
  }
  function applyOrderVat(o) {
    core().applyVat(o, S.vat, S.shop.currency, issueInvoice);
  }
  const deducted = s => ['confirmed', 'ready', 'collected'].includes(s);
  function stockForStatus(o, status) {
    if (S.stockEnabled && can('products')) core().stockForStatus(S.products, o, o.status, status, new Date().toISOString(), newId);
    o.stockApplied = deducted(status);
  }
  function stockForEdit(o, items) {
    if (S.stockEnabled && deducted(o.status) && can('products')) core().stockForEdit(S.products, o.items, items, o.id, new Date().toISOString(), newId);
  }
  function stockCorrection(p, qty) {
    const delta = Math.round(qty) - Math.round(p.qty || 0);
    if (!p.track || !delta) return;
    p.stockMoves = [{ id: newId(), delta, reason: 'correction', orderId: null, note: null, at: new Date().toISOString() }].concat(p.stockMoves || []).slice(0, 50);
  }

  function aiError(error) {
    if (error && error.kind === 'rate_limited') return t('ai.limit');
    if (error && error.kind === 'offline') return t('ai.offline');
    if (error && error.code === 'unsafe_image') return t('studio.unsafe');
    if (error && error.code === 'too_large') return t('ai.imageTooBig');
    return t('ai.error');
  }

  // A picked image file (or data URL) as base64 JPEG/PNG within maxBytes, downscaled like the phones
  // (longest side 1600 px, JPEG quality 0.8) when it is larger or another format.
  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  const b64Bytes = b64 => Math.floor((b64.length * 3) / 4);
  async function encodeImage(source, maxBytes, allowPng) {
    const url = typeof source === 'string' ? source : await readDataUrl(source);
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(url);
    if (m && (m[1] === 'image/jpeg' || (allowPng && m[1] === 'image/png')) && b64Bytes(m[2]) <= maxBytes) return { mimeType: m[1], data: m[2], url };
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    for (let side = 1600, q = 0.8; side >= 400; side = Math.round(side * 0.75), q = Math.max(0.6, q - 0.05)) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * scale));
      cv.height = Math.max(1, Math.round(img.height * scale));
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      const out = cv.toDataURL('image/jpeg', q), data = out.slice(out.indexOf(',') + 1);
      if (b64Bytes(data) <= maxBytes) return { mimeType: 'image/jpeg', data, url: out };
    }
    const error = new Error('too_large');
    error.code = 'too_large';
    throw error;
  }

  // ---------- AI order entry ----------

  function parse(body) {
    if (!D) return;
    D.reading = true;
    D.note = '';
    render();
    const products = core().parseProducts(S.products);
    Promise.resolve(body)
      .then(b => api().parse(Object.assign({ products, addressAs: S.addressAs, demo: aiDemo() }, b)))
      .then(answer => {
        if (!D) return;
        const f = core().draftFields(answer.draft, S.products);
        if (f.items.length) D.items = f.items;
        if (f.name) {
          D.name = f.name;
          const c = S.customers.find(x => x.name === f.name || x.nameEn === f.name);
          if (c && c.phone) D.phone = c.phone;
        }
        if (f.due) D.due = f.due;
        if (f.notes) D.notes = f.notes;
        D.note = f.items.length ? t('neworder.aiRead') : t('neworder.noMatch');
      })
      .catch(error => { if (D) D.note = aiError(error); })
      .finally(() => { if (D) D.reading = false; if (route()[0] === 'new') render(); });
  }
  const parseText = text => parse({ text: String(text).slice(0, 4000) });
  const parseImage = file => parse(encodeImage(file, AI_IMAGE_MAX_BYTES, true).then(img => ({ image: { mimeType: img.mimeType, data: img.data } })));

  // ---------- Ask Orderat ----------

  function ask(question) {
    const q = String(question || '').trim().slice(0, 500);
    if (!q || ASK.busy) return;
    ASK.msgs.push({ me: true, html: esc(q) });
    ASK.busy = true;
    renderAsk();
    const built = core().buildAskSnapshot(S, { now: new Date(), lang: S.lang });
    const history = askHistory.slice(-6);
    api().ask({ question: q, history, snapshot: built.snapshot, addressAs: S.addressAs, demo: aiDemo() })
      .then(answer => {
        const text = typeof answer.answer === 'string' ? answer.answer : '';
        askHistory.push({ role: 'user', text: q }, { role: 'assistant', text });
        ASK.msgs.push({ me: false, html: answerHtml(text, Array.isArray(answer.actions) ? answer.actions : [], built.refs) });
      })
      .catch(error => ASK.msgs.push({ me: false, html: `<p>${esc(aiError(error))}</p>` }))
      .finally(() => {
        ASK.busy = false;
        if (modalEl().open) { renderAsk(); $('.ask-form input')?.focus(); }
      });
  }
  function answerHtml(text, actions, refs) {
    const paras = text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    const out = actions.map(a => {
      if (a.type === 'send_reminders') {
        return (a.customerRefs || []).map(ref => {
          const c = S.customers.find(x => x.id === refs.customers[ref]);
          if (!c || !c.phone) return '';
          const due = sum(live().filter(o => o.customerId === c.id), o => totals(o).due);
          return `<a class="chip" href="${esc(waLink(c.phone, t('whatsapp.message.paymentReminder', firstName(c), shopName(), money(due))))}" target="_blank" rel="noopener">${icon('whatsapp')} ${esc(cName(c))}</a>`;
        }).join('');
      }
      if (a.type === 'add_expense' && can('money')) {
        const amount = OrderatCloudMap.fromMinor(a.amountMinor, currency()[0]);
        return `<button class="chip" data-act="live-ask-expense" data-amount="${esc(amount)}" data-cat="${esc(a.category)}" data-note="${esc(a.note || '')}">${icon('plus')} ${esc(t('money.addExpense'))} · ${esc(money(amount))}</button>`;
      }
      if (a.type === 'draft_caption') return `<p class="caption-box">${esc(a.text)}</p><button class="chip" data-act="copy" data-text="${esc(a.text)}">${icon('copy')} ${esc(t('marketing.copy'))}</button>`;
      if (a.type === 'open_order' && refs.orders[a.orderRef]) return `<button class="chip" data-act="live-open-order" data-id="${esc(refs.orders[a.orderRef])}">${icon('orders')} ${esc(t('ask.openOrder'))}</button>`;
      return '';
    }).join('');
    return paras + (out ? `<div class="chips wrap">${out}</div>` : '');
  }

  // ---------- Photo studio and captions ----------

  async function studioGenerate() {
    if (!ST.photo || ST.busy) return;
    ST.busy = true;
    render();
    try {
      const img = await encodeImage(ST.photo, AI_IMAGE_MAX_BYTES, true);
      let styleId = STUDIO_IDS[ST.style];
      if (ST.style === 'campaign') {
        const c = (CAMPAIGNS || []).find(x => x.id === ST.campaign);
        styleId = (c && Array.isArray(c.studioStyles) && c.studioStyles[0]) || 'white';
      }
      const answer = await api().studio({ task: 'photo', styleId: styleId || 'white', aspect: ASPECTS[ST.shape] || '1:1', image: { mimeType: img.mimeType, data: img.data }, demo: aiDemo() });
      if (answer.image && answer.image.data) ST.result = `data:${answer.image.mimeType || 'image/png'};base64,${answer.image.data}`;
      if (typeof answer.remainingToday === 'number') ST.left = answer.remainingToday;
    } catch (error) {
      toast(aiError(error));
      if (error && error.kind === 'rate_limited') ST.left = 0;
    }
    ST.busy = false;
    if (route()[2] === 'studio') render();
  }
  function studioUse() {
    if (!ST.result) return;
    if (!can('products')) return toast(t('live.forbidden'));
    const ps = S.products;
    if (!ps.length) return toast(t('shop.noItems'));
    openModal(t('studio.pickProduct'), `<form data-form="live-studio-use" class="stack">
      ${field(t('neworder.menuItem'), `<select name="pid">${ps.map(p => `<option value="${esc(p.id)}">${esc(pName(p))}</option>`).join('')}</select>`)}
      <button class="btn primary block">${esc(t('studio.useAsProductPhoto'))}</button></form>`);
  }
  async function uploadPhoto(productId, source) {
    if (!can('products')) return toast(t('live.forbidden'));
    toast(t('photo.uploading'));
    try {
      const img = await encodeImage(source, PHOTO_MAX_BYTES, false);
      const answer = await api().photoUpload(shopId, img.mimeType, img.data);
      const p = productOf(productId);
      if (!p || !answer.photoId) return;
      p.photoId = answer.photoId;
      photoUrls.set(answer.photoId, img.url);
      save();
      toast(t('studio.saved'));
      render();
    } catch (error) {
      toast(error && error.code === 'too_large' ? t('ai.imageTooBig') : t('photo.failed'));
    }
  }
  function caption() {
    const p = productOf(CAP.pid) || S.products.find(x => x.active);
    CAP.busy = true;
    render();
    const items = p ? [{ name: pName(p).slice(0, 80) || 'Item', priceMinor: minor(p.price) }] : [];
    const body = { task: 'caption', channel: 'instagram', shopName: (shopName() || 'Orderat').slice(0, 60), currency: S.shop.currency, items, demo: aiDemo(), lang: S.lang };
    (items.length ? api().studio(body) : Promise.reject(new Error('no_items')))
      .then(answer => {
        const caps = Array.isArray(answer.captions) ? answer.captions.filter(x => typeof x === 'string') : [];
        const tags = Array.isArray(answer.hashtags) ? answer.hashtags.filter(x => typeof x === 'string') : [];
        CAP.ai = [caps[0] || '', tags.join(' ')].filter(Boolean).join('\n\n');
      })
      .catch(error => toast(error && error.message === 'no_items' ? t('marketing.noContent') : aiError(error)))
      .finally(() => { CAP.busy = false; if (route()[1] === 'marketing') render(); });
  }

  // Product photos: <img data-photo="id"> gets a signed URL, fetched once per visit.
  function afterRender() {
    if (!on) return;
    document.querySelectorAll('img[data-photo]').forEach(img => {
      const id = img.dataset.photo;
      if (photoUrls.has(id)) { img.src = photoUrls.get(id); return; }
      if (photoLoading.has(id)) return;
      photoLoading.add(id);
      api().photoUrl(shopId, id).then(a => {
        if (a && a.url) photoUrls.set(id, a.url);
        document.querySelectorAll(`img[data-photo="${CSS.escape(id)}"]`).forEach(x => { if (a && a.url) x.src = a.url; });
      }).catch(() => {}).finally(() => photoLoading.delete(id));
    });
  }

  // ---------- Screens inside the shop ----------

  function paywall() {
    openModal(t('live.subscribeInApp'), `<div class="paywall stack"><img src="favicon.svg" width="64" height="64" alt=""><p>${esc(t('live.subscribeBody'))}</p>${storeText()}</div>`);
  }
  function viewShopLink() {
    return { title: t('shoplink.title'), back: 'shop/marketing', body: `<div class="stack"><section class="card stack-sm"><h3 class="card-title">${icon('link')} ${esc(t('live.shopLinkInApp'))}</h3><p class="muted">${esc(t('live.shopLinkBody'))}</p>${storeText()}</section></div>` };
  }
  function planText() {
    const a = access();
    if (a.staff) return t('live.plan.staff');
    const sub = S.subscription;
    if (!sub) return t('live.plan.free');
    if (core().subscriptionActive(sub, new Date())) return t(sub.status === 'trial' ? 'live.plan.trial' : 'live.plan.subscribed');
    return t('live.plan.ended');
  }
  function settingsTop() {
    const a = access();
    const pending = sync ? sync.pending : 0;
    const when = lastSynced ? `${fmtShort(lastSynced)} ${fmtTime(lastSynced)}` : t('cloud.neverSynced');
    return `<section class="card split"><span class="row-main"><b>${esc(t('settingsSubscription'))}</b><small>${esc(planText())}</small></span>${a.owner ? `<button class="btn ghost small" data-act="paywall">${esc(t('live.manage'))}</button>` : ''}</section>
    <section class="card stack-sm"><h3 class="card-title">${icon('cloud')} ${esc(t('live.account'))}</h3>
      <div class="line"><span>${esc(t('cloud.signedInAs'))}</span><b dir="ltr">${esc(accountName())}</b></div>
      <div class="line"><span>${esc(t('live.shop'))}</span><b>${esc(shopName())} · ${esc(t(a.owner ? 'cloud.team.owner' : 'shops.staff'))}</b></div>
      <div class="line"><span>${esc(t('cloud.lastSynced'))}: ${esc(when)}${pending ? ` · ${esc(t('live.pending', pending))}` : ''}</span><button class="btn ghost small" data-act="live-sync-now">${esc(t('cloud.syncNow'))}</button></div>
      ${a.owner ? navRow('shop/settings/team', 'users', t('cloud.team')) : ''}
      <div class="btn-row"><button class="btn ghost small" data-act="live-switch">${esc(t('live.switchShop'))}</button><button class="btn danger-soft small" data-act="live-sign-out">${esc(t('cloud.signOut'))}</button></div>
    </section>`;
  }

  function loadTeam() {
    team = { loading: true, members: [], invite: team && team.invite };
    api().membersList(shopId).then(a => {
      team.members = Array.isArray(a.members) ? a.members : [];
      team.loading = false;
    }, () => { team.loading = false; team.error = true; }).finally(() => { if (route()[2] === 'team') render(); });
  }
  function viewTeam() {
    if (!access().owner) return { title: t('cloud.team'), back: 'shop/settings', body: empty(t('live.forbidden')) };
    if (!team) loadTeam();
    const inv = team.invite && new Date(team.invite.expiresAt) > new Date() ? team.invite : null;
    const invite = `<section class="card stack-sm"><h3 class="card-title">${esc(t('cloud.team.invite'))}</h3>${inv
      ? `<p class="invite-code"><bdi dir="ltr">${esc(inv.code)}</bdi></p><p class="muted small">${esc(t('cloud.team.inviteExpires', `${fmtShort(new Date(inv.expiresAt))} ${fmtTime(new Date(inv.expiresAt))}`))}</p><a class="btn ghost small" href="https://wa.me/?text=${encodeURIComponent(t('cloud.team.shareMessage', inv.code))}" target="_blank" rel="noopener">${icon('whatsapp')} ${esc(t('common.share'))}</a>`
      : `<div><button class="btn primary small" data-act="live-invite">${icon('plus')} ${esc(t('cloud.team.invite'))}</button></div>`}<p class="muted small">${esc(t('cloud.team.inviteFooter'))}</p></section>`;
    const perms = ['orders', 'prepare', 'money', 'products'];
    const rows = team.loading ? empty(t('team.loading')) : team.error ? empty(t('team.error')) : team.members.map(m => {
      const who = m.email || m.name || m.userId;
      if (m.role === 'owner') return `<div class="split"><span class="row-main"><b><bdi dir="ltr">${esc(who)}</bdi></b></span>${badge('brand', t('cloud.team.owner'))}</div>`;
      const p = m.permissions || {};
      return `<div class="member"><div class="split"><b><bdi dir="ltr">${esc(who)}</bdi></b><button class="link-btn danger small" data-act="live-remove-member" data-id="${esc(m.userId)}">${esc(t('cloud.team.remove'))}</button></div><div class="perm-grid">${perms.map(k => `<label class="check"><input type="checkbox" data-live="live-perm" data-id="${esc(m.userId)}" data-k="${k}"${p[k] ? ' checked' : ''}><span>${esc(t('cloud.permission.' + k))}</span></label>`).join('')}</div></div>`;
    }).join('');
    return { title: t('cloud.team'), back: 'shop/settings', body: `<div class="stack">${invite}<section class="card stack-sm"><h3 class="card-title">${esc(t('cloud.team.members'))}</h3>${rows}</section></div>` };
  }

  // ---------- Events ----------

  const actions = {
    'live-start'() { stopPair(); info = {}; screen = 'start'; render(); },
    'live-apple': appleSignIn,
    'live-pair': startPair,
    'live-demo'() {
      stopPair();
      screen = null;
      info = { demoPick: true };
      if (S.live) { S = loadState(); ST.left = 3; }
      if (S.onboarded) { lastPath = ''; go('today'); } else render();
    },
    'live-back-start'() { info = {}; screen = 'start'; render(); },
    'live-account'() { openAccount(); },
    'live-open-shop'(el) { openShop(el.dataset.id); },
    'live-switch'() { openAccount({ choose: true }); },
    'live-retry'() { if (typeof info.retry === 'function') info.retry(); else openAccount(); },
    'live-sign-out': signOut,
    'live-sync-now'() { pull().then(ok => { toast(ok ? t('cloud.justNow') : t('ai.offline')); render(); }); },
    'live-invite'() {
      api().inviteCreate(shopId).then(a => { team = team || { members: [] }; team.invite = a; render(); }, () => toast(t('live.serverError')));
    },
    'live-remove-member'(el) {
      if (!confirm(t('team.removeConfirm'))) return;
      api().membersRemove(shopId, el.dataset.id).then(() => loadTeam(), () => toast(t('live.serverError'))).finally(() => render());
    },
    'live-open-order'(el) { closeModal(); go('orders/' + el.dataset.id); },
    'live-ask-expense'(el) {
      const amount = parseFloat(el.dataset.amount);
      if (!(amount > 0)) return;
      S.expenses.push({ id: newId(), amount, category: EXPENSE_CATS.includes(el.dataset.cat) ? el.dataset.cat : 'other', note: el.dataset.note || '', date: new Date().toISOString() });
      save();
      el.disabled = true;
      toast(t('common.saved'));
    },
  };
  const liveHandlers = {
    'live-perm'(el) {
      const m = team && team.members.find(x => x.userId === el.dataset.id);
      if (!m) return;
      const next = Object.assign({}, m.permissions, { [el.dataset.k]: el.checked });
      api().membersUpdate(shopId, m.userId, next).then(() => { m.permissions = next; }, () => { el.checked = !el.checked; toast(t('live.serverError')); });
    },
    'live-photo'(el) {
      const f = el.files && el.files[0];
      el.value = '';
      if (f) uploadPhoto(el.dataset.id, f);
    },
  };
  const forms = {
    'live-studio-use'(f, fd) {
      const id = String(fd.get('pid') || '');
      closeModal();
      if (id && ST.result) uploadPhoto(id, ST.result);
    },
  };

  function boot() {
    if (Auth() && Auth().getSession()) openAccount();
    else render();
  }

  return {
    get on() { return on; },
    get deviceCode() { return deviceCode; },
    boot, gate, save, can, access, newId, noOf, invoiceNo, vatOf, totals, applyOrderVat, stockForStatus, stockForEdit, stockCorrection,
    parseText, parseImage, ask, studioGenerate, studioUse, caption, afterRender, paywall, viewShopLink, viewTeam, settingsTop,
    actions, liveHandlers, forms,
  };
})();
