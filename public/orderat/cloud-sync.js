// Orderat web: the sync engine for one cloud shop (docs/sme-phase-2-cloud.md "Sync"). It keeps the
// server's copy of every record (raw data and seq) and the cursor, builds the web state from them with
// cloud-map.js, and pushes what the web changed.
//
//   const sync = createSync({ api, map, shopId, ctx: { deviceCode }, onChange, onNotice });
//   await sync.start();   // pulls every page from cursor 0, then onChange(state)
//   sync.commit(S);       // after local edits: push what changed (nothing to push, no call)
//   sync.pull(S);         // on a timer and on focus: send what changed, apply what others changed
//
// The app adopts each onChange state into its own S in place (Object.assign(S, state)), keeps editing
// S, and hands S itself to both commit() and pull(): a list or value replaced on S is only seen through S
// (called without a state, they use the last one handed over, else the last one built).
// Edit web objects in place (or replace a list); an object replaced by a copy has no origin and is judged
// against the latest record. A state is
//   { shop, vat, stockEnabled, products, customers, orders, expenses, occasions, waTemplates, subscription }
// with deleted records left out; subscription is the `setting/subscription` record's value (or null) and
// is never written, like every setting other than whatsappTemplates (waTemplates) and every entity the
// web does not show (stock_move). The web never deletes the shop or a setting.
//
// How edits reach the server:
// - Each web object remembers the cloud data (and seq) it was built from. A commit hands the live object
//   and that data to xToCloud (ctx = { decimals of the shop currency, now, deviceCode }); a result that
//   differs is a pending change, sent with baseSeq = the seq it was based on, so a phone's change that
//   arrived meanwhile is reported as a conflict. Diffing each object against its own origin, never against
//   a newer record, means a copy of the state from before a pull cannot undo another device's change.
// - Deletions: a record in the build a list came from (its oldest member's build) but gone from the list
//   becomes a tombstone (with its last data); a record the server never had (and not on its way there) is
//   simply dropped. A list from an older build never deletes records that came later.
// - The server's limits: a record over 32 KB of JSON is never sent; the server copy is put back (a new
//   record is dropped) and onNotice('invalid') says so. A call carries at most 500 changes and ~1.8 MB.
// - Changes go out in map.ENTITY_ORDER. The same call pulls: pages are applied while `more`, then the
//   state is rebuilt from the records (and the changes still pending) and handed to onChange, so nothing
//   stale is ever diffed.
// - Edits made while a call is out are picked up before its answer is applied, so the rebuild keeps them.
// - One call at a time: commit() and pull() made meanwhile share one more round after it.
//
// onNotice(notice, detail):
//   'conflict'   detail: the answer's conflicts  another device wrote first; the web's copy won
//   'forbidden'  detail: the rejected entries     refused changes, now back to the server's copy (or gone)
//   'invalid'    detail: [{ entity, id, reason: 'too_large' }]   records too large to send, put back
//   'offline' | 'unauthorized' | 'rate_limited' | 'server' | 'invalid'   detail: the CloudError
//   'no_access'  detail: the CloudError (403)    the account is no longer a member of this shop
// After a failure the changes stay pending (see `pending`) and the next commit() or pull() sends them.
// commit() and pull() resolve true when their round went through, false when it failed or could not
// run (before start(), after stop()). start() again reloads from cursor 0 and keeps changes not sent
// yet, edits on the state last handed over included; a start() again that fails changes nothing.
// stop() is for good (sign-out, another shop): later answers are ignored and nothing runs any more.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrderatCloudSync = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // server/sync/validate.ts: MAX_CHANGES_PER_REQUEST, MAX_RECORD_DATA_BYTES, and under MAX_BODY_BYTES (2 MB).
  const MAX_CHANGES = 500;
  const MAX_RECORD_BYTES = 32 * 1024;
  const MAX_BATCH_BYTES = 1.8 * 1024 * 1024;
  // How many recent builds keep their key sets, for deletions from lists built by them.
  const KEEP_BUILDS = 20;
  // The web state's list for each listed entity.
  const LISTS = { customer: 'customers', product: 'products', occasion: 'occasions', order: 'orders', expense: 'expenses' };
  // The settings the web edits, by setting id.
  const WEB_SETTINGS = { whatsappTemplates: 'waTemplates' };
  // A 403 on the whole sync call: this account is not a member of the shop any more.
  const FAILURE_NOTICES = { forbidden: 'no_access' };

  const G = typeof globalThis !== 'undefined' ? globalThis : self;
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const keyOf = (entity, id) => `${entity}/${id}`;
  const seqOf = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const isCloudError = e => !!e && e.name === 'CloudError' && typeof e.kind === 'string';
  // Whether a sync answer brings records or refusals, the two things that make the state be rebuilt.
  const hasNews = a => isObj(a) && ((Array.isArray(a.changes) && a.changes.length > 0) || (Array.isArray(a.rejected) && a.rejected.length > 0));
  // UTF-8 bytes of JSON, as the server measures it.
  const jsonBytes = v => {
    const s = JSON.stringify(v);
    return typeof G.TextEncoder === 'function' ? new G.TextEncoder().encode(s).length : s.length * 3;
  };

  // JSON with sorted keys, so two values compare equal whatever their key order.
  function stable(v) {
    if (v && typeof v.toJSON === 'function') return stable(v.toJSON());
    if (Array.isArray(v)) return `[${v.map(x => (x === undefined || typeof x === 'function' ? 'null' : stable(x))).join(',')}]`;
    if (v !== null && typeof v === 'object') {
      return `{${Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== 'function').sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    }
    return v === undefined ? 'undefined' : JSON.stringify(v);
  }
  const same = (a, b) => stable(a) === stable(b);

  function createSync(options) {
    const opts = options || {};
    const api = opts.api, map = opts.map, shopId = opts.shopId;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
    const onNotice = typeof opts.onNotice === 'function' ? opts.onNotice : () => {};
    const baseCtx = isObj(opts.ctx) ? opts.ctx : {};
    const SHOP_KEY = keyOf('shop', shopId);
    const entityRank = e => {
      const i = map.ENTITY_ORDER.indexOf(e);
      return i < 0 ? map.ENTITY_ORDER.length : i;
    };

    const records = new Map(); // key → { entity, id, data, deleted, seq }: the server's copies
    // key → { entity, id, data, deleted, baseSeq, gen }: web changes the server has not taken yet
    // (gen: the latest build when the change was made).
    const pending = new Map();
    const keyedMeta = new Map(); // key → origin of a setting value that is not an object
    const tooLarge = new Map(); // key → { entity, id, reason }: changes refused here for their size
    const buildKeys = new Map(); // build number → { entity → keys }, for the last KEEP_BUILDS builds
    let origins = new WeakMap(); // web object → { key, base, seq, fromPending, gen, fp, out }
    let builtLists = new WeakMap(); // web list → the build it was made by
    let lastBuild = 0;
    let cursor = 0, membership = null;
    let started = false, stopped = false;
    let committed = null, built = null; // the state last handed to commit()/pull(), the state last built
    let chain = Promise.resolve(), queued = null, queuedPull = false;
    let inFlight = new Set(); // keys of the changes in the call that is out

    // A record as the web sees it: its pending change if there is one, else the server's copy.
    function local(key) {
      const p = pending.get(key);
      if (p) return p.deleted ? undefined : { data: p.data, fromPending: true, seq: p.baseSeq };
      const r = records.get(key);
      return r && !r.deleted ? { data: r.data, fromPending: false, seq: r.seq } : undefined;
    }

    function makeCtx() {
      const shop = records.get(SHOP_KEY);
      const code = shop && !shop.deleted && isObj(shop.data) ? shop.data.currencyCode : undefined;
      return Object.assign({}, baseCtx, { decimals: map.decimalsFor(code), now: new Date() });
    }

    function setOrigin(holder, key, origin) {
      if (holder !== null && typeof holder === 'object') origins.set(holder, origin);
      else keyedMeta.set(key, origin);
    }
    function getOrigin(holder, key) {
      return holder !== null && typeof holder === 'object' ? origins.get(holder) : keyedMeta.get(key);
    }
    // holder: the object the origin is kept on (the web object; for the shop, state.shop);
    // value: what xToCloud takes; fpValue: what is compared to see whether the web edited it.
    function remember(holder, key, view, fpValue, gen) {
      setOrigin(holder, key, {
        key, base: view ? view.data : undefined, seq: view ? view.seq : 0, fromPending: !!(view && view.fromPending), gen, fp: stable(fpValue), out: undefined,
      });
    }

    function buildState() {
      const ctx = makeCtx();
      const gen = ++lastBuild;
      const state = { shop: null, vat: null, stockEnabled: false, products: [], customers: [], orders: [], expenses: [], occasions: [], waTemplates: null, subscription: null };
      const keys = {};
      Object.keys(LISTS).forEach(entity => { keys[entity] = new Set(); });
      // The server's records in the order they first came, then records only the web has so far.
      const all = new Map(records);
      pending.forEach((p, key) => { if (!all.has(key)) all.set(key, p); });
      all.forEach((record, key) => {
        const view = local(key);
        if (!view) return;
        const entity = record.entity, id = record.id;
        if (LISTS[entity]) {
          if (!map.safeId(id)) return; // never shown, so never edited or deleted from here
          const obj = map[`${entity}ToWeb`](id, view.data, ctx);
          remember(obj, key, view, obj, gen);
          state[LISTS[entity]].push(obj);
          keys[entity].add(key);
        } else if (entity === 'setting' && (WEB_SETTINGS[id] || id === 'subscription')) {
          const value = map.settingToWeb(id, view.data);
          if (id === 'subscription') state.subscription = value === undefined ? null : value;
          else {
            state[WEB_SETTINGS[id]] = value === undefined ? null : value;
            remember(value, key, view, value, gen);
          }
        }
      });
      const shopView = local(SHOP_KEY);
      const shop = map.shopToWeb(shopId, shopView ? shopView.data : undefined, ctx);
      Object.assign(state, shop);
      remember(state.shop, SHOP_KEY, shopView, shop, gen);
      Object.keys(LISTS).forEach(entity => builtLists.set(state[LISTS[entity]], gen));
      buildKeys.set(gen, keys);
      buildKeys.delete(gen - KEEP_BUILDS);
      built = state;
      return state;
    }

    // Makes the pending change for `key` match the web object's cloud form: its edit, else the pending
    // change it was built from. Nothing is pending when there is neither, or the server already has it.
    function settle(entity, id, key, origin) {
      const data = origin.out !== undefined ? origin.out : origin.fromPending ? origin.base : undefined;
      const r = records.get(key);
      if (data === undefined || (r && !r.deleted && (r.data === data || same(r.data, data)))) {
        pending.delete(key);
        return;
      }
      const p = pending.get(key);
      if (p && !p.deleted && p.data === data) return;
      if (origin.out !== undefined && jsonBytes(data) > MAX_RECORD_BYTES) {
        pending.delete(key); // the server would refuse the whole call: keep its copy instead
        tooLarge.set(key, { entity, id, reason: 'too_large' });
        return;
      }
      pending.set(key, { entity, id, data, deleted: false, baseSeq: origin.seq, gen: lastBuild });
    }

    function look(entity, key, id, value, holder, fpValue, ctx) {
      let origin = getOrigin(holder, key);
      if (!origin || origin.key !== key || origin.fp !== stable(fpValue)) {
        const from = origin && origin.key === key ? origin : local(key) || { data: undefined, fromPending: false, seq: 0 };
        const base = origin && origin.key === key ? origin.base : from.data;
        const out = map[`${entity}ToCloud`](value, base, ctx);
        const edited = base === undefined || !same(out, base);
        // Taken after xToCloud, which writes new ids onto the web object.
        origin = { key, base, seq: from.seq, fromPending: from.fromPending, gen: origin && origin.key === key ? origin.gen : undefined, fp: stable(fpValue), out: edited ? out : undefined };
        setOrigin(holder, key, origin);
      }
      settle(entity, id, key, origin);
    }

    // The build a list came from: its own, else its oldest member's, else the latest.
    function buildOf(list) {
      const own = builtLists.get(list);
      if (own !== undefined) return own;
      let oldest;
      list.forEach(obj => {
        const origin = isObj(obj) ? origins.get(obj) : undefined;
        if (origin && origin.gen !== undefined && (oldest === undefined || origin.gen < oldest)) oldest = origin.gen;
      });
      return oldest === undefined ? lastBuild : oldest;
    }

    // Records what the web state `ws` changed as pending changes.
    function capture(ws) {
      if (!isObj(ws)) return;
      const ctx = makeCtx();
      map.ENTITY_ORDER.forEach(entity => {
        if (entity === 'shop') {
          if (!isObj(ws.shop)) return;
          const part = { shop: ws.shop, vat: ws.vat, stockEnabled: ws.stockEnabled };
          look('shop', SHOP_KEY, shopId, part, ws.shop, part, ctx);
        } else if (entity === 'setting') {
          Object.keys(WEB_SETTINGS).forEach(id => {
            const value = ws[WEB_SETTINGS[id]];
            if (value !== undefined && value !== null) look('setting', keyOf('setting', id), id, value, value, value, ctx);
          });
        } else if (LISTS[entity] && Array.isArray(ws[LISTS[entity]])) {
          const list = ws[LISTS[entity]];
          const seen = new Set();
          list.forEach(obj => {
            if (!isObj(obj) || typeof obj.id !== 'string' || !obj.id) return;
            const key = keyOf(entity, obj.id);
            if (seen.has(key)) return;
            seen.add(key);
            look(entity, key, obj.id, obj, obj, obj, ctx);
          });
          deletions(entity, list, seen);
        }
      });
    }

    // Records the list's build had (and records the web added since) that are gone from the list.
    function deletions(entity, list, seen) {
      const gen = buildOf(list);
      const keys = buildKeys.get(gen);
      if (!keys) return; // a list from a build too old to know: delete nothing
      const candidates = new Set(keys[entity]);
      pending.forEach((p, key) => {
        if (p.entity === entity && !p.deleted && !records.has(key) && p.gen <= gen) candidates.add(key);
      });
      candidates.forEach(key => {
        const view = seen.has(key) ? undefined : local(key);
        if (!view) return;
        const r = records.get(key), p = pending.get(key);
        // The server never had it (or no longer has it), and it is not on its way there: just drop it.
        if ((!r || r.deleted) && !inFlight.has(key)) pending.delete(key);
        else pending.set(key, { entity, id: (r || p).id, data: view.data, deleted: true, baseSeq: view.seq, gen: lastBuild });
      });
    }

    // Applies a sync answer: refused changes, the changes sent, pulled records, cursor, membership.
    // Returns whether any record changed on the server's side.
    function applyAnswer(answer, sent, notices) {
      const a = isObj(answer) ? answer : {};
      let changed = false;
      const rejected = Array.isArray(a.rejected) ? a.rejected.filter(isObj) : [];
      const refused = new Set();
      rejected.forEach(r => {
        const key = keyOf(r.entity, r.id);
        refused.add(key);
        if (isObj(r.record)) records.set(key, { entity: r.entity, id: r.id, data: isObj(r.record.data) ? r.record.data : {}, deleted: r.record.deleted === true, seq: seqOf(r.record.seq) });
        else records.delete(key);
        pending.delete(key);
        changed = true;
      });
      // Taken: the server now holds what was sent. Its pulled copy (on this page or a later one) brings
      // the new seq. A change the web made again meanwhile stays pending, based on that copy.
      sent.forEach(p => {
        const key = keyOf(p.entity, p.id);
        if (refused.has(key)) return;
        const r = records.get(key);
        records.set(key, { entity: p.entity, id: p.id, data: p.data, deleted: p.deleted, seq: r ? r.seq : 0 });
        const now = pending.get(key);
        if (now === p) pending.delete(key);
        else if (now) now.afterOwn = p; // made on top of this push: based on its copy once that comes back
      });
      (Array.isArray(a.changes) ? a.changes : []).forEach(c => {
        if (!isObj(c) || typeof c.entity !== 'string' || typeof c.id !== 'string') return;
        const key = keyOf(c.entity, c.id);
        records.set(key, { entity: c.entity, id: c.id, data: isObj(c.data) ? c.data : {}, deleted: c.deleted === true, seq: seqOf(c.seq) });
        const p = pending.get(key);
        if (p && p.afterOwn) {
          // The copy of the web's own push this change was made on top of. Anything else is another
          // device's write, and the old base keeps it a conflict.
          if (p.afterOwn.deleted === (c.deleted === true) && same(p.afterOwn.data, c.data)) p.baseSeq = seqOf(c.seq);
          p.afterOwn = null;
        }
        changed = true;
      });
      if (Number.isInteger(a.cursor) && a.cursor > cursor) cursor = a.cursor;
      if (isObj(a.membership)) membership = a.membership;
      if (notices && Array.isArray(a.conflicts) && a.conflicts.length) notices.push(['conflict', a.conflicts]);
      if (notices && rejected.length) notices.push(['forbidden', rejected]);
      return changed;
    }

    // The next call's changes: due and not sent yet, in entity order, at most 500 and ~1.8 MB.
    function nextBatch(due, sent) {
      const waiting = due.filter(key => !sent.has(key) && pending.has(key)).map(key => pending.get(key));
      waiting.sort((a, b) => entityRank(a.entity) - entityRank(b.entity));
      const batch = [];
      let bytes = 0;
      for (const p of waiting) {
        const size = jsonBytes(p.data) + 200;
        if (batch.length && (batch.length === MAX_CHANGES || bytes + size > MAX_BATCH_BYTES)) break;
        batch.push(p);
        bytes += size;
      }
      return batch;
    }

    const liveState = () => committed || built;
    const publish = () => onChange(buildState());
    function reportTooLarge() {
      if (!tooLarge.size) return;
      const list = Array.from(tooLarge.values());
      tooLarge.clear();
      onNotice('invalid', list);
    }

    async function round(mustCall) {
      if (stopped) return false;
      capture(liveState());
      const due = Array.from(pending.keys());
      if (!due.length && !mustCall) {
        if (tooLarge.size) {
          publish(); // puts back the server copy of what was too large to send
          reportTooLarge();
        }
        return true;
      }
      const sent = new Set(), notices = [];
      let changed = tooLarge.size > 0;
      for (;;) {
        const batch = nextBatch(due, sent);
        const changes = batch.map(p => ({ entity: p.entity, id: p.id, data: p.data, deleted: p.deleted, baseSeq: p.baseSeq }));
        const from = cursor;
        let answer;
        inFlight = new Set(batch.map(p => keyOf(p.entity, p.id)));
        try {
          answer = await api.sync({ shopId, cursor, changes });
        } catch (error) {
          if (stopped) {
            inFlight = new Set();
            return false;
          }
          // Edits made while this call was out, taken while its changes still count as in flight: the
          // server may have applied them, so a record removed meanwhile needs a tombstone.
          capture(liveState());
          inFlight = new Set();
          if (changed) {
            publish(); // the pages this round did apply
            reportTooLarge();
          }
          if (!isCloudError(error)) throw error;
          onNotice(FAILURE_NOTICES[error.kind] || error.kind, error);
          return false;
        }
        if (stopped) return false;
        // Edits made while the call was out, taken before the answer changes anything (after it, a refused
        // edit would come straight back). Only needed when this round will rebuild the state; otherwise
        // they stay on S for the next commit or pull.
        if (changed || hasNews(answer)) capture(liveState());
        inFlight = new Set();
        batch.forEach(p => sent.add(keyOf(p.entity, p.id)));
        if (applyAnswer(answer, batch, notices)) changed = true;
        const unsent = due.some(key => !sent.has(key) && pending.has(key));
        if (!unsent && !(isObj(answer) && answer.more && cursor > from)) break;
      }
      if (changed) publish();
      reportTooLarge();
      notices.forEach(([notice, detail]) => onNotice(notice, detail));
      return true;
    }

    // Runs after the round in progress; calls made meanwhile share that one round.
    function schedule(pull, webState) {
      if (!started || stopped) return Promise.resolve(false);
      if (isObj(webState)) committed = webState;
      queuedPull = queuedPull || pull;
      if (!queued) {
        queued = chain.then(() => {
          const mustCall = queuedPull;
          queued = null;
          queuedPull = false;
          return round(mustCall);
        });
        chain = queued.catch(() => {});
      }
      return queued;
    }

    // Changes not sent yet survive a reload: they stay pending and are laid over the fresh records.
    // The pages are fetched first and swapped in only once all of them came: a failed reload changes
    // nothing, and the sync keeps running on the copy it had.
    function start() {
      const run = chain.then(async () => {
        const pages = [];
        let at = 0;
        for (;;) {
          const answer = await api.sync({ shopId, cursor: at, changes: [] });
          if (stopped) return null;
          pages.push(answer);
          const next = isObj(answer) && Number.isInteger(answer.cursor) && answer.cursor > at ? answer.cursor : at;
          if (!(isObj(answer) && answer.more && next > at)) break;
          at = next;
        }
        if (started) capture(liveState()); // edits on S not handed over yet become pending
        records.clear();
        keyedMeta.clear();
        buildKeys.clear();
        origins = new WeakMap();
        builtLists = new WeakMap();
        cursor = 0;
        membership = null;
        committed = built = null;
        pages.forEach(answer => applyAnswer(answer, [], null));
        started = true;
        const state = buildState();
        onChange(state);
        reportTooLarge();
        return state;
      });
      chain = run.catch(() => {});
      return run;
    }

    return {
      start,
      commit: webState => schedule(false, webState),
      pull: webState => schedule(true, webState),
      buildState,
      stop() { stopped = true; },
      get membership() { return membership; },
      get pending() { return pending.size; },
    };
  }

  return { createSync };
});
