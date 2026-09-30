// public/orderat/cloud-api.js: the web app's HTTP client for the orderat-* Edge Functions (bodies as
// server/auth/validate.ts, server/sync/validate.ts and the parse/ask/studio validators expect them).
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = createRequire(import.meta.url);
const { createApi, CloudError } = load('../public/orderat/cloud-api.js');

const BASE = 'https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1';
const SESSION = 'c2Vzc2lvbi10b2tlbi1mb3ItdGVzdHM';
const SHOP_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER_ID = '5d0e7a61-8b2c-4f3d-9a1e-6c7b8d9e0f12';
const INSTALL_KEY = 'orderat.web.installId';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// A fetch that records every request and answers with `respond(url, init)` (200 {ok:true} by default).
function fakeFetch(respond = () => json({ ok: true })) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init, headers: init.headers, body: JSON.parse(init.body) });
    return respond(url, init);
  });
  return { fetchImpl, calls };
}

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: k => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => { items.set(k, String(v)); },
    removeItem: k => { items.delete(k); },
  };
}

function signedIn(respond) {
  const f = fakeFetch(respond);
  return { ...f, api: createApi({ baseUrl: BASE, getSession: () => SESSION, fetchImpl: f.fetchImpl }) };
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requests', () => {
  it('posts JSON to the named function with the session header and returns the parsed answer', async () => {
    const { api, calls } = signedIn(() => json({ user: { id: USER_ID, provider: 'google', email: 'a@b.c', name: 'Ali' } }));
    await expect(api.me()).resolves.toEqual({ user: { id: USER_ID, provider: 'google', email: 'a@b.c', name: 'Ali' } });
    expect(calls).toHaveLength(1);
    const [{ url, init, headers, body }] = calls;
    expect(url).toBe(`${BASE}/orderat-auth`);
    expect(init.method).toBe('POST');
    expect(headers).toEqual({ 'Content-Type': 'application/json', 'X-Orderat-Session': SESSION });
    expect(init).not.toHaveProperty('credentials');
    expect(body).toEqual({ action: 'me' });
  });

  it('marks a small sync call keepalive (it survives the tab closing), never a large one or another call', async () => {
    const { api, calls } = signedIn(() => json({ changes: [], cursor: 0, more: false }));
    await api.sync({ shopId: SHOP_ID, cursor: 0, changes: [{ entity: 'order', id: SHOP_ID, data: { notes: 'x' }, deleted: false, baseSeq: 0 }] });
    await api.sync({ shopId: SHOP_ID, cursor: 0, changes: [{ entity: 'order', id: SHOP_ID, data: { notes: 'x'.repeat(70 * 1024) }, deleted: false, baseSeq: 0 }] });
    await api.me();
    expect(calls.map(c => c.init.keepalive === true)).toEqual([true, false, false]);
  });

  it('sends no session header when signed out', async () => {
    const { fetchImpl, calls } = fakeFetch();
    await createApi({ baseUrl: BASE, getSession: () => null, fetchImpl }).shopsList();
    expect(calls[0].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('signs in as the web client with the raw nonce, without sending an old session', async () => {
    const { api, calls } = signedIn(() => json({ session: 'new-session', user: { id: USER_ID } }));
    await expect(api.signin({ provider: 'google', idToken: 'header.payload.sig', nonce: 'raw-nonce-1', deviceName: 'Chrome on Windows' }))
      .resolves.toEqual({ session: 'new-session', user: { id: USER_ID } });
    expect(calls[0].url).toBe(`${BASE}/orderat-auth`);
    expect(calls[0].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(calls[0].body).toEqual({ action: 'signin', provider: 'google', idToken: 'header.payload.sig', nonce: 'raw-nonce-1', deviceName: 'Chrome on Windows', client: 'web' });
  });

  it('leaves out a missing nonce and an empty device name, and cuts a long one to the 100 characters the server takes', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const api = createApi({ baseUrl: BASE, getSession: () => null, fetchImpl });
    await api.signin({ provider: 'apple', idToken: 't', deviceName: '' });
    await api.signin({ provider: 'apple', idToken: 't', nonce: 'n', deviceName: 'x'.repeat(130) });
    expect(calls[0].body).toEqual({ action: 'signin', provider: 'apple', idToken: 't', client: 'web' });
    expect(calls[1].body.deviceName).toBe('x'.repeat(100));
  });

  it('sends the Apple authorization code when there is one', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const api = createApi({ baseUrl: BASE, getSession: () => null, fetchImpl });
    await api.signin({ provider: 'apple', idToken: 't', nonce: 'n', authorizationCode: 'code1' });
    expect(calls[0].body.authorizationCode).toBe('code1');
  });

  it('names every account action', async () => {
    const { api, calls } = signedIn();
    await api.signout();
    await api.deleteAccount();
    expect(calls.map(c => [c.url, c.body])).toEqual([
      [`${BASE}/orderat-auth`, { action: 'signout' }],
      [`${BASE}/orderat-auth`, { action: 'delete_account' }],
    ]);
  });

  it('sends each sync action with the body the server validates', async () => {
    const { api, calls } = signedIn();
    const change = { entity: 'product', id: 'c3a8e2f4-1b5d-4e6f-a7b8-9c0d1e2f3a4b', data: { nameAr: 'كيك' }, deleted: false, baseSeq: 7 };
    await api.shopsList();
    await api.sync({ shopId: SHOP_ID, cursor: 12, changes: [change] });
    await api.inviteCreate(SHOP_ID);
    await api.membersList(SHOP_ID);
    await api.membersUpdate(SHOP_ID, USER_ID, { orders: true, prepare: 1, products: false, extra: true });
    await api.membersRemove(SHOP_ID, USER_ID);
    await api.photoUpload(SHOP_ID, 'image/jpeg', '/9j/4AAQSkZJRg==');
    await api.photoUrl(SHOP_ID, '3f5a9c2e7b1d4f6a');
    expect(calls.every(c => c.url === `${BASE}/orderat-sync` && c.headers['X-Orderat-Session'] === SESSION)).toBe(true);
    expect(calls.map(c => c.body)).toEqual([
      { action: 'shops_list' },
      { action: 'sync', shopId: SHOP_ID, cursor: 12, changes: [change] },
      { action: 'invite_create', shopId: SHOP_ID },
      { action: 'members_list', shopId: SHOP_ID },
      { action: 'members_update', shopId: SHOP_ID, userId: USER_ID, permissions: { orders: true, prepare: true, money: false, products: false } },
      { action: 'members_remove', shopId: SHOP_ID, userId: USER_ID },
      { action: 'photo_upload', shopId: SHOP_ID, mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' },
      { action: 'photo_url', shopId: SHOP_ID, photoId: '3f5a9c2e7b1d4f6a' },
    ]);
  });

  it('starts and polls a phone pairing without a session', async () => {
    const { api, calls } = signedIn(() => json({ status: 'pending' }));
    await api.pairStart();
    await expect(api.pairPoll('pair-1', 'poll-token-1')).resolves.toEqual({ status: 'pending' });
    expect(calls.map(c => [c.url, c.headers, c.body])).toEqual([
      [`${BASE}/orderat-auth`, { 'Content-Type': 'application/json' }, { action: 'pair_start' }],
      [`${BASE}/orderat-auth`, { 'Content-Type': 'application/json' }, { action: 'pair_poll', pairId: 'pair-1', pollToken: 'poll-token-1' }],
    ]);
  });

  it('adds the web client fields to AI requests and passes the rest of the body through', async () => {
    const { api, calls } = signedIn();
    const products = [{ id: 'p1', name: 'Vanilla Sponge Cake', nameAr: 'كيك إسفنجي', aliases: ['كيك'] }];
    await api.parse({ text: 'ابي كيكتين', products, lang: 'en' });
    await api.ask({ question: 'How much did I sell?', history: [], snapshot: { shop: { currency: 'BHD' } }, lang: 'ar', addressAs: 'female' });
    await api.studio({ task: 'photo', styleId: 'white', aspect: '1:1', image: { mimeType: 'image/png', data: 'iVBORw0K' }, demo: true });
    expect(calls.map(c => c.url)).toEqual([`${BASE}/orderat-parse`, `${BASE}/orderat-ask`, `${BASE}/orderat-studio`]);
    const installId = calls[0].body.installId;
    expect(installId).toMatch(UUID_V4);
    expect(localStorage.getItem(INSTALL_KEY)).toBe(installId);
    expect(calls.map(c => c.body)).toEqual([
      { text: 'ابي كيكتين', products, lang: 'en', installId, platform: 'web', appVersion: 'web-1', demo: false },
      { question: 'How much did I sell?', history: [], snapshot: { shop: { currency: 'BHD' } }, lang: 'ar', addressAs: 'female', installId, platform: 'web', appVersion: 'web-1', demo: false },
      { task: 'photo', styleId: 'white', aspect: '1:1', image: { mimeType: 'image/png', data: 'iVBORw0K' }, demo: true, lang: 'ar', installId, platform: 'web', appVersion: 'web-1' },
    ]);
  });

  it('keeps one install id per browser and takes the language from getLang when the body has none', async () => {
    localStorage.setItem(INSTALL_KEY, '0b6c1f9e-2d3a-4c5b-8e7f-1a2b3c4d5e6f');
    const { fetchImpl, calls } = fakeFetch();
    const api = createApi({ baseUrl: BASE, getSession: () => null, fetchImpl, getLang: () => 'en' });
    await api.studio({ task: 'caption', channel: 'instagram', shopName: 'Zad', currency: 'BHD', items: [{ name: 'Karak', priceMinor: 300 }] });
    expect(calls[0].body).toMatchObject({ installId: '0b6c1f9e-2d3a-4c5b-8e7f-1a2b3c4d5e6f', lang: 'en', platform: 'web' });
  });

  it('still sends a steady install id when the browser keeps no storage', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } });
    const { api, calls } = signedIn();
    await api.parse({ text: 'x' });
    await api.parse({ text: 'y' });
    expect(calls[0].body.installId).toMatch(UUID_V4);
    expect(calls[1].body.installId).toBe(calls[0].body.installId);
  });

  it('uses the production functions by default and tolerates a trailing slash', async () => {
    const a = fakeFetch();
    await createApi({ getSession: () => null, fetchImpl: a.fetchImpl }).shopsList();
    const b = fakeFetch();
    await createApi({ baseUrl: 'http://127.0.0.1:54321/functions/v1/', getSession: () => null, fetchImpl: b.fetchImpl }).shopsList();
    expect([a.calls[0].url, b.calls[0].url]).toEqual([`${BASE}/orderat-sync`, 'http://127.0.0.1:54321/functions/v1/orderat-sync']);
  });
});

describe('errors', () => {
  it.each([
    [401, { error: 'unauthorized' }, 'unauthorized', 'unauthorized'],
    [401, { error: 'invalid_token' }, 'unauthorized', 'invalid_token'],
    [403, { error: 'staff_limit' }, 'forbidden', 'staff_limit'],
    [404, { error: 'invalid_code' }, 'not_found', 'invalid_code'],
    [429, { error: 'rate_limited' }, 'rate_limited', 'rate_limited'],
    [400, { error: 'invalid_body' }, 'invalid', 'invalid_body'],
    [413, { error: 'too_large' }, 'invalid', 'too_large'],
    [422, { error: 'unsafe_image' }, 'invalid', 'unsafe_image'],
    [500, { error: 'internal' }, 'server', 'internal'],
    [502, { error: 'ai_unavailable' }, 'server', 'ai_unavailable'],
  ])('maps HTTP %i %j to a CloudError of kind %s', async (status, body, kind, code) => {
    const { api } = signedIn(() => json(body, status));
    const err = await api.me().catch(e => e);
    expect(err).toBeInstanceOf(CloudError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'CloudError', kind, status, code });
  });

  it('leaves the code empty when an error answer is not JSON', async () => {
    const { api } = signedIn(() => new Response('<html>Bad gateway</html>', { status: 503 }));
    await expect(api.sync({ shopId: SHOP_ID, cursor: 0, changes: [] })).rejects.toMatchObject({ kind: 'server', status: 503, code: undefined });
  });

  it('treats a network failure as offline', async () => {
    const f = { fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) };
    const api = createApi({ baseUrl: BASE, getSession: () => SESSION, fetchImpl: f.fetchImpl });
    const err = await api.shopsList().catch(e => e);
    expect(err).toBeInstanceOf(CloudError);
    expect(err).toMatchObject({ kind: 'offline', status: 0 });
  });

  it('gives up on a request that never answers, as offline, and aborts it', async () => {
    vi.useFakeTimers();
    let signal;
    const fetchImpl = vi.fn((url, init) => { signal = init.signal; return new Promise(() => {}); });
    const api = createApi({ baseUrl: BASE, getSession: () => SESSION, fetchImpl, timeoutMs: 1000 });
    const result = api.shopsList().catch(e => e);
    await vi.advanceTimersByTimeAsync(999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'CloudError', kind: 'offline', code: 'timeout' });
    expect(signal.aborted).toBe(true);
  });

  it('treats a success answer that is not JSON as a server error', async () => {
    const { api } = signedIn(() => new Response('hello', { status: 200 }));
    await expect(api.me()).rejects.toMatchObject({ name: 'CloudError', kind: 'server', status: 200, code: 'bad_response' });
  });
});
