// public/orderat/cloud-auth.js: Google and Apple sign-in helpers, the stored session, the invoice device
// code, and signing in from the phone (pairing: a 6-digit code or its QR, approved on the phone).
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = createRequire(import.meta.url);
const auth = load('../public/orderat/cloud-auth.js');
const { CloudError } = load('../public/orderat/cloud-api.js');

const SESSION_KEY = 'orderat.web.session';
const GOOGLE_CLIENT_ID = '799835600648-rj4qq9ia615jfob5eg6k4lgop3aq3i6l.apps.googleusercontent.com';
const NOW = new Date('2026-09-29T08:00:00.000Z');
// Node's own SHA-256, independent of the module's crypto.subtle.
const sha256hex = text => createHash('sha256').update(text).digest('hex');

function memoryStorage() {
  const items = new Map();
  return {
    getItem: k => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => { items.set(k, String(v)); },
    removeItem: k => { items.delete(k); },
  };
}

function pairingApi(polls, expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()) {
  return {
    pairStart: vi.fn(async () => ({ pairId: 'pair-1', code: '482913', pollToken: 'poll-token-1', expiresAt })),
    pairPoll: vi.fn(polls),
  };
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => {
  auth.clearSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session', () => {
  it('keeps the session and user under orderat.web.session until cleared', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    expect(auth.getSession()).toBeNull();
    auth.setSession({ session: 'session-token-1', user: { id: 'u1', email: 'fatima@example.com' } });
    expect(JSON.parse(localStorage.getItem(SESSION_KEY))).toEqual({ session: 'session-token-1', user: { id: 'u1', email: 'fatima@example.com' }, at: NOW.toISOString() });
    expect(auth.getSession()).toBe('session-token-1');
    expect(auth.getUser()).toEqual({ id: 'u1', email: 'fatima@example.com' });
    auth.clearSession();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect([auth.getSession(), auth.getUser()]).toEqual([null, null]);
  });

  it('reads a damaged or foreign stored value as signed out', () => {
    auth.setSession({ session: 'earlier-session', user: null });
    for (const stored of ['not json', '{"session":42}', '{"user":{"id":"u1"}}', '"session-token-1"']) {
      localStorage.setItem(SESSION_KEY, stored);
      expect(auth.getSession()).toBeNull();
    }
  });

  it.each([
    ['refuses all access', { getItem: 'throw', setItem: 'throw', removeItem: 'throw' }],
    ['reads but refuses writes (a full or private store)', { getItem: null, setItem: 'throw', removeItem: 'throw' }],
  ])('keeps the session for the visit when the browser %s', (_, how) => {
    const refuse = () => { throw new Error('QuotaExceededError'); };
    vi.stubGlobal('localStorage', Object.fromEntries(Object.entries(how).map(([k, v]) => [k, v === 'throw' ? refuse : () => v])));
    expect(auth.getSession()).toBeNull();
    auth.setSession({ session: 'session-token-1', user: null });
    expect(auth.getSession()).toBe('session-token-1');
    auth.setSession({ user: { id: 'u1' } }); // an answer without a session signs out
    expect([auth.getSession(), auth.getUser()]).toEqual([null, null]);
    auth.setSession({ session: 'session-token-2', user: null });
    auth.clearSession();
    expect(auth.getSession()).toBeNull();
  });
});

describe('hashes', () => {
  it('hashes text as lowercase SHA-256 hex', async () => {
    await expect(auth.sha256hex('abc')).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('takes the device code from the first two hex characters of the session hash, upper-cased', async () => {
    await expect(auth.deviceCode('abc')).resolves.toBe('BA');
    for (const session of ['c2Vzc2lvbi0x', 'dG9rZW4tMg', 'ZmFrZS0z']) {
      await expect(auth.deviceCode(session)).resolves.toBe(sha256hex(session).slice(0, 2).toUpperCase());
    }
    await expect(auth.deviceCode('')).resolves.toBe('');
  });
});

describe('Google', () => {
  it('renders the button with the web client id and a raw nonce, and hands on the token', () => {
    const id = { initialize: vi.fn(), renderButton: vi.fn() };
    vi.stubGlobal('google', { accounts: { id } });
    const el = { nodeName: 'DIV' };
    const onToken = vi.fn();
    expect(auth.googleButton(el, onToken, { locale: 'ar', width: 280 })).toBe(true);
    const init = id.initialize.mock.calls[0][0];
    expect(init.client_id).toBe(GOOGLE_CLIENT_ID);
    expect(init.nonce.length).toBeGreaterThanOrEqual(32);
    expect(id.renderButton).toHaveBeenCalledWith(el, expect.objectContaining({ locale: 'ar', width: 280 }));
    init.callback({ credential: 'google.id.token' });
    expect(onToken).toHaveBeenCalledWith({ provider: 'google', idToken: 'google.id.token', rawNonce: init.nonce });
  });

  it('takes the client id from ORDERAT_CONFIG and a new nonce for each button', () => {
    const id = { initialize: vi.fn(), renderButton: vi.fn() };
    vi.stubGlobal('google', { accounts: { id } });
    vi.stubGlobal('ORDERAT_CONFIG', { googleClientId: 'staging-client.apps.googleusercontent.com' });
    auth.googleButton({}, () => {});
    auth.googleButton({}, () => {});
    const [first, second] = id.initialize.mock.calls.map(c => c[0]);
    expect(first.client_id).toBe('staging-client.apps.googleusercontent.com');
    expect(first.nonce).not.toBe(second.nonce);
  });

  it('draws nothing when the Google script is not loaded', () => {
    expect(auth.googleButton({}, () => {})).toBe(false);
  });
});

describe('Apple', () => {
  const config = { appleServicesId: 'com.ams.orderat.web', appleRedirectUri: 'https://orderatweb.com/app/' };

  it('signs in with the popup, giving Apple the SHA-256 of the raw nonce', async () => {
    vi.stubGlobal('ORDERAT_CONFIG', config);
    const appleAuth = { init: vi.fn(), signIn: vi.fn(async () => ({ authorization: { id_token: 'apple.id.token', code: 'c1' }, user: { email: 'fatima@example.com' } })) };
    vi.stubGlobal('AppleID', { auth: appleAuth });
    const result = await auth.appleSignIn();
    expect(result).toEqual({ provider: 'apple', idToken: 'apple.id.token', rawNonce: expect.any(String) });
    expect(result.rawNonce.length).toBeGreaterThanOrEqual(32);
    expect(appleAuth.init).toHaveBeenCalledWith({ clientId: 'com.ams.orderat.web', scope: 'name email', redirectURI: 'https://orderatweb.com/app/', usePopup: true, nonce: sha256hex(result.rawNonce) });
    expect(appleAuth.init.mock.invocationCallOrder[0]).toBeLessThan(appleAuth.signIn.mock.invocationCallOrder[0]);
  });

  it('fails with a code when the Apple script, its configuration or the token is missing', async () => {
    await expect(auth.appleSignIn()).rejects.toMatchObject({ code: 'apple_unavailable' });
    vi.stubGlobal('AppleID', { auth: { init: vi.fn(), signIn: vi.fn(async () => ({ authorization: {} })) } });
    await expect(auth.appleSignIn()).rejects.toMatchObject({ code: 'apple_not_configured' });
    vi.stubGlobal('ORDERAT_CONFIG', config);
    await expect(auth.appleSignIn()).rejects.toMatchObject({ code: 'apple_no_token' });
  });

  it("passes on Apple's own error, such as a closed popup", async () => {
    vi.stubGlobal('ORDERAT_CONFIG', config);
    vi.stubGlobal('AppleID', { auth: { init: vi.fn(), signIn: vi.fn(async () => { throw { error: 'popup_closed_by_user' }; }) } });
    await expect(auth.appleSignIn()).rejects.toEqual({ error: 'popup_closed_by_user' });
  });
});

describe('pairing with the phone', () => {
  it('shows the code and its QR text, polls until the phone approves, then keeps the session', async () => {
    vi.useFakeTimers({ now: NOW });
    const answers = [{ status: 'pending' }, { status: 'pending' }, { status: 'approved', session: 'web-session-1', user: { id: 'u1', email: 'fatima@example.com' } }];
    const api = pairingApi(async () => answers.shift());
    const onCode = vi.fn();
    const pairing = auth.startPairing(api, { onCode });
    await vi.advanceTimersByTimeAsync(0);
    expect(onCode).toHaveBeenCalledWith({ code: '482913', qrText: 'orderat://pair?code=482913', expiresAt: '2026-09-29T08:05:00.000Z' });
    expect(api.pairPoll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.pairPoll).toHaveBeenCalledTimes(1);
    expect(api.pairPoll).toHaveBeenCalledWith('pair-1', 'poll-token-1');
    await vi.advanceTimersByTimeAsync(4000);
    await expect(pairing.done).resolves.toEqual({ session: 'web-session-1', user: { id: 'u1', email: 'fatima@example.com' } });
    expect(auth.getSession()).toBe('web-session-1');
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.pairPoll).toHaveBeenCalledTimes(3);
  });

  it('rejects with not_found / expired when the code has expired', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = pairingApi(async () => ({ status: 'expired' }));
    const pairing = auth.startPairing(api, { onCode() {}, intervalMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    const error = await pairing.done.catch(e => e);
    expect(error).toBeInstanceOf(CloudError);
    expect(error).toMatchObject({ kind: 'not_found', code: 'expired' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.pairPoll).toHaveBeenCalledTimes(1);
    expect(auth.getSession()).toBeNull();
  });

  it('stops polling when cancelled', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = pairingApi(async () => ({ status: 'pending' }));
    const pairing = auth.startPairing(api, { onCode() {} });
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.pairPoll).toHaveBeenCalledTimes(1);
    pairing.cancel();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.pairPoll).toHaveBeenCalledTimes(1);
    await expect(pairing.done).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('shows no code when cancelled before the code arrives', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = pairingApi(async () => ({ status: 'pending' }));
    const onCode = vi.fn();
    auth.startPairing(api, { onCode }).cancel();
    await vi.advanceTimersByTimeAsync(10000);
    expect(onCode).not.toHaveBeenCalled();
    expect(api.pairPoll).not.toHaveBeenCalled();
  });

  it('keeps polling through a dropped connection, and gives up by itself once the code has expired', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = pairingApi(async () => { throw new CloudError('offline', 0, 'network'); }, new Date(NOW.getTime() + 5000).toISOString());
    const pairing = auth.startPairing(api, { onCode() {}, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.pairPoll).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pairing.done).rejects.toMatchObject({ kind: 'not_found', code: 'expired' });
    expect(api.pairPoll).toHaveBeenCalledTimes(4);
  });

  it('ends with the error when polling fails for good', async () => {
    vi.useFakeTimers({ now: NOW });
    const broken = new TypeError('api.pairPoll is broken');
    const api = pairingApi(() => { throw broken; });
    const pairing = auth.startPairing(api, { onCode() {} });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pairing.done).rejects.toBe(broken);
  });

  it('passes on a failure to start', async () => {
    const api = { pairStart: vi.fn(async () => { throw new CloudError('rate_limited', 429, 'rate_limited'); }), pairPoll: vi.fn() };
    const onCode = vi.fn();
    await expect(auth.startPairing(api, { onCode }).done).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(onCode).not.toHaveBeenCalled();
  });

  it('a rate-limited pair_start (429) rejects so the screen can try again, and a new try works', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = pairingApi(async () => ({ status: 'approved', session: 'web-session-2', user: null }));
    api.pairStart.mockRejectedValueOnce(new CloudError('rate_limited', 429, 'rate_limited'));
    const onCode = vi.fn();
    const first = auth.startPairing(api, { onCode });
    await expect(first.done).rejects.toMatchObject({ name: 'CloudError', kind: 'rate_limited', status: 429, code: 'rate_limited' });
    expect(api.pairPoll).not.toHaveBeenCalled();
    const again = auth.startPairing(api, { onCode });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(again.done).resolves.toEqual({ session: 'web-session-2', user: null });
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(auth.getSession()).toBe('web-session-2');
  });
});
