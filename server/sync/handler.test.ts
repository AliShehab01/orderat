import { beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "../agent/postgres-store.ts";
import { createSession, newSessionToken, upsertUser } from "../auth/store.ts";
import { createCloudTestSql } from "../cloud-pglite-test-support.ts";
import { createSyncHandler, type GetSignedPhotoUrl, type UploadPhoto } from "./handler.ts";
import { MAX_SYNCS_PER_MINUTE } from "./rate-limit.ts";

const NOW = new Date("2026-09-27T12:00:00Z");
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
// The timestamp format on the wire (docs/sme-phase-2-cloud.md "Record formats"): ISO 8601 UTC with
// milliseconds — what a browser's Date parses, unlike the String(Date) form the driver's Date gives.
const ISO_WITH_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let sql: SqlClient;
let uploadedPhotos: { shopId: string; photoId: string; mimeType: string }[];
let uploadShouldSucceed: boolean;
let signedUrlShouldExist: boolean;

function makeHandler(now: () => Date = () => NOW) {
  const uploadPhoto: UploadPhoto = async ({ shopId, photoId, mimeType }) => {
    if (!uploadShouldSucceed) return false;
    uploadedPhotos.push({ shopId, photoId, mimeType });
    return true;
  };
  const getSignedPhotoUrl: GetSignedPhotoUrl = async ({ shopId, photoId }) => (signedUrlShouldExist ? `https://storage.test/${shopId}/${photoId}.jpg?token=fake` : undefined);
  return createSyncHandler({ sql, uploadPhoto, getSignedPhotoUrl, now, log: () => {} });
}

async function signUp(providerSub: string): Promise<{ userId: string; session: string }> {
  const user = await upsertUser(sql, { id: crypto.randomUUID(), provider: "apple", providerSub });
  const { token, tokenHash } = await newSessionToken();
  await createSession(sql, { tokenHash, userId: user.id });
  return { userId: user.id, session: token };
}

function post(body: unknown, session?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session) headers["x-orderat-session"] = session;
  return new Request("https://example.test/orderat-sync", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(async () => {
  sql = await createCloudTestSql();
  uploadedPhotos = [];
  uploadShouldSucceed = true;
  signedUrlShouldExist = true;
});

describe("createSyncHandler / create_shop", () => {
  it("first upload makes the caller the owner with full permissions", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = crypto.randomUUID();
    const res = await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shop: { id: shopId, name: "Sara's Cakes", role: "owner", permissions: { orders: true, prepare: true, money: true, products: true } } });
  });

  it("is idempotent for the same owner calling twice", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));
    const second = await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));
    expect(second.status).toBe(200);
  });

  it("refuses to let a different user claim an already-owned shopId", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const { session: otherSession } = await signUp("owner-2");
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, ownerSession));
    const res = await handler(post({ action: "create_shop", shopId, name: "Hijack attempt" }, otherSession));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "shop_exists" });
  });

  it("requires a valid session", async () => {
    const handler = makeHandler();
    const res = await handler(post({ action: "create_shop", shopId: crypto.randomUUID(), name: "x" }));
    expect(res.status).toBe(401);
  });
});

describe("createSyncHandler / shops_list", () => {
  it("is an empty array for a signed-in user with no shops", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const res = await handler(post({ action: "shops_list" }, session));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shops: [] });
  });

  it("lists a shop right after create_shop, with name/updatedAt null until a real sync pushes its own record", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));

    const res = await handler(post({ action: "shops_list" }, session));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shops: [{ shopId, role: "owner", name: null, updatedAt: null }] });
  });

  it("picks up the shop's name and updatedAt once its own 'shop' entity has been synced", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));
    await handler(post({ action: "sync", shopId, cursor: 0, changes: [{ entity: "shop", id: shopId, data: { nameAr: "كيكس سارة" } }] }, session));

    const res = await handler(post({ action: "shops_list" }, session));
    expect(await res.json()).toEqual({ shops: [{ shopId, role: "owner", name: "كيكس سارة", updatedAt: expect.any(String) }] });
  });

  it("reports updatedAt as ISO 8601 UTC with milliseconds", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));
    await handler(post({ action: "sync", shopId, cursor: 0, changes: [{ entity: "shop", id: shopId, data: { nameAr: "كيكس سارة" } }] }, session));

    const { shops } = await (await handler(post({ action: "shops_list" }, session))).json();
    expect(shops[0].updatedAt).toMatch(ISO_WITH_MS);
    expect(new Date(shops[0].updatedAt).toISOString()).toBe(shops[0].updatedAt); // A browser reads it back exactly.
  });

  it("includes shops the caller is staff on, alongside ones they own", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const ownedShopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId: ownedShopId, name: "Owner's shop" }, ownerSession));

    const { session: staffSession } = await signUp("staff-1");
    const staffShopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId: staffShopId, name: "Someone else's shop" }, staffSession));
    const { code } = await (await handler(post({ action: "invite_create", shopId: staffShopId }, staffSession))).json();
    await handler(post({ action: "invite_join", code }, ownerSession)); // The owner also staffs another shop.

    const res = await handler(post({ action: "shops_list" }, ownerSession));
    const { shops } = await res.json();
    expect(shops).toHaveLength(2);
    expect(shops.map((s: { shopId: string; role: string }) => ({ shopId: s.shopId, role: s.role }))).toEqual(
      expect.arrayContaining([{ shopId: ownedShopId, role: "owner" }, { shopId: staffShopId, role: "staff" }]),
    );
  });

  it("never returns another user's shop", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    await handler(post({ action: "create_shop", shopId: crypto.randomUUID(), name: "Sara's Cakes" }, ownerSession));

    const { session: strangerSession } = await signUp("stranger-1");
    const res = await handler(post({ action: "shops_list" }, strangerSession));
    expect(await res.json()).toEqual({ shops: [] });
  });

  it("requires a valid session", async () => {
    const handler = makeHandler();
    const res = await handler(post({ action: "shops_list" }));
    expect(res.status).toBe(401);
  });
});

describe("createSyncHandler / sync", () => {
  async function createShop(handler: (req: Request) => Promise<Response>, session: string) {
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));
    return shopId;
  }

  it("pushes and pulls in one call, reporting no conflicts for a clean first upload", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = await createShop(handler, session);

    const res = await handler(post({ action: "sync", shopId, cursor: 0, changes: [{ entity: "product", id: "p1", data: { name: "Cake" } }] }, session));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([]);
    expect(body.more).toBe(false);
    expect(body.changes.some((c: { entity: string; id: string }) => c.entity === "product" && c.id === "p1")).toBe(true);
    // The caller's current membership rides along on every sync.
    expect(body.membership.role).toBe("owner");
    expect(body.membership.permissions).toMatchObject({ orders: true, prepare: true, money: true, products: true });
  });

  it("reports each pulled change's updatedAt as ISO 8601 UTC with milliseconds", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = await createShop(handler, session);

    const res = await handler(post({ action: "sync", shopId, cursor: 0, changes: [{ entity: "product", id: "p1", data: { name: "Cake" } }] }, session));
    const { changes } = await res.json();
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) expect(change.updatedAt).toMatch(ISO_WITH_MS);
  });

  it("is forbidden for a signed-in user who isn't a member of the shop", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const shopId = await createShop(handler, ownerSession);
    const { session: strangerSession } = await signUp("stranger-1");

    const res = await handler(post({ action: "sync", shopId, cursor: 0, changes: [] }, strangerSession));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("enforces 60 syncs per minute per session with rate_limited", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = await createShop(handler, session);

    for (let i = 0; i < MAX_SYNCS_PER_MINUTE; i++) {
      const res = await handler(post({ action: "sync", shopId, cursor: 0, changes: [] }, session));
      expect(res.status).toBe(200);
    }
    const res = await handler(post({ action: "sync", shopId, cursor: 0, changes: [] }, session));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("keeps rate limits independent per session (a second device isn't throttled by the first)", async () => {
    const handler = makeHandler();
    const { session } = await signUp("owner-1");
    const shopId = await createShop(handler, session);
    const { token: secondDeviceToken, tokenHash } = await newSessionToken();
    const owner = await sql.query<{ user_id: string }>(`select user_id from orderat.shop_members where shop_id = $1 and role = 'owner'`, [shopId]);
    await createSession(sql, { tokenHash, userId: owner[0]!.user_id });

    for (let i = 0; i < MAX_SYNCS_PER_MINUTE; i++) await handler(post({ action: "sync", shopId, cursor: 0, changes: [] }, session));
    const res = await handler(post({ action: "sync", shopId, cursor: 0, changes: [] }, secondDeviceToken));
    expect(res.status).toBe(200);
  });
});

describe("createSyncHandler / invites", () => {
  async function createShop(handler: (req: Request) => Promise<Response>, session: string) {
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, session));
    return shopId;
  }

  it("lets the owner create an invite and a staff member join with it", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const shopId = await createShop(handler, ownerSession);

    const createRes = await handler(post({ action: "invite_create", shopId }, ownerSession));
    expect(createRes.status).toBe(200);
    const { code, expiresAt } = await createRes.json();
    expect(code).toMatch(/^\d{6}$/);
    expect(new Date(expiresAt).getTime() - NOW.getTime()).toBe(48 * 60 * 60 * 1000);

    const { session: staffSession } = await signUp("staff-1");
    const joinRes = await handler(post({ action: "invite_join", code }, staffSession));
    expect(joinRes.status).toBe(200);
    expect(await joinRes.json()).toEqual({ shop: { id: shopId, name: "Sara's Cakes" }, role: "staff", permissions: { orders: false, prepare: false, money: false, products: false } });
  });

  it("refuses invite_create from staff (owner only)", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const shopId = await createShop(handler, ownerSession);
    const createRes = await handler(post({ action: "invite_create", shopId }, ownerSession));
    const { code } = await createRes.json();
    const { session: staffSession } = await signUp("staff-1");
    await handler(post({ action: "invite_join", code }, staffSession));

    const res = await handler(post({ action: "invite_create", shopId }, staffSession));
    expect(res.status).toBe(403);
  });

  it("a code is single-use: joining twice with the same code fails the second time", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const shopId = await createShop(handler, ownerSession);
    const { code } = await (await handler(post({ action: "invite_create", shopId }, ownerSession))).json();

    const { session: staff1 } = await signUp("staff-1");
    expect((await handler(post({ action: "invite_join", code }, staff1))).status).toBe(200);

    const { session: staff2 } = await signUp("staff-2");
    const res = await handler(post({ action: "invite_join", code }, staff2));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("an expired invite cannot be joined", async () => {
    let clock = NOW;
    const handler = makeHandler(() => clock);
    const { session: ownerSession } = await signUp("owner-1");
    const shopId = await createShop(handler, ownerSession);
    const { code } = await (await handler(post({ action: "invite_create", shopId }, ownerSession))).json();

    clock = new Date(NOW.getTime() + 48 * 60 * 60 * 1000 + 1000); // Just past the 48h TTL.
    const { session: staffSession } = await signUp("staff-1");
    const res = await handler(post({ action: "invite_join", code }, staffSession));
    expect(res.status).toBe(404);
  });

  it("an unknown code is rejected", async () => {
    const handler = makeHandler();
    const { session } = await signUp("someone");
    const res = await handler(post({ action: "invite_join", code: "000000" }, session));
    expect(res.status).toBe(404);
  });

  it("enforces the 5-staff-per-shop limit", async () => {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const shopId = await createShop(handler, ownerSession);

    for (let i = 0; i < 5; i++) {
      const { code } = await (await handler(post({ action: "invite_create", shopId }, ownerSession))).json();
      const { session: staffSession } = await signUp(`staff-${i}`);
      expect((await handler(post({ action: "invite_join", code }, staffSession))).status).toBe(200);
    }

    const { code } = await (await handler(post({ action: "invite_create", shopId }, ownerSession))).json();
    const { session: sixthStaffSession } = await signUp("staff-6");
    const res = await handler(post({ action: "invite_join", code }, sixthStaffSession));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "staff_limit" });
  });
});

describe("createSyncHandler / members", () => {
  async function setUpShopWithStaff() {
    const handler = makeHandler();
    const { session: ownerSession, userId: ownerId } = await signUp("owner-1");
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, ownerSession));
    const { code } = await (await handler(post({ action: "invite_create", shopId }, ownerSession))).json();
    const { session: staffSession, userId: staffId } = await signUp("staff-1");
    await handler(post({ action: "invite_join", code }, staffSession));
    return { handler, ownerSession, ownerId, shopId, staffSession, staffId };
  }

  it("lists members with the owner and staff", async () => {
    const { handler, ownerSession, shopId, staffId } = await setUpShopWithStaff();
    const res = await handler(post({ action: "members_list", shopId }, ownerSession));
    expect(res.status).toBe(200);
    const { members } = await res.json();
    expect(members.map((m: { role: string }) => m.role)).toEqual(["owner", "staff"]);
    expect(members[1].userId).toBe(staffId);
  });

  it("reports each member's joinedAt as ISO 8601 UTC with milliseconds", async () => {
    const { handler, ownerSession, shopId } = await setUpShopWithStaff();
    const { members } = await (await handler(post({ action: "members_list", shopId }, ownerSession))).json();
    expect(members).toHaveLength(2);
    for (const member of members) expect(member.joinedAt).toMatch(ISO_WITH_MS);
  });

  it("refuses members_list from staff", async () => {
    const { handler, staffSession, shopId } = await setUpShopWithStaff();
    expect((await handler(post({ action: "members_list", shopId }, staffSession))).status).toBe(403);
  });

  it("lets the owner update a staff member's permissions", async () => {
    const { handler, ownerSession, shopId, staffId } = await setUpShopWithStaff();
    const permissions = { orders: true, prepare: false, money: false, products: true };
    const res = await handler(post({ action: "members_update", shopId, userId: staffId, permissions }, ownerSession));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const listRes = await handler(post({ action: "members_list", shopId }, ownerSession));
    const { members } = await listRes.json();
    expect(members.find((m: { userId: string }) => m.userId === staffId).permissions).toEqual(permissions);
  });

  it("members_update on an unknown staff id returns not_found", async () => {
    const { handler, ownerSession, shopId } = await setUpShopWithStaff();
    const res = await handler(post({ action: "members_update", shopId, userId: crypto.randomUUID(), permissions: { orders: true, prepare: false, money: false, products: false } }, ownerSession));
    expect(res.status).toBe(404);
  });

  it("lets the owner remove a staff member", async () => {
    const { handler, ownerSession, shopId, staffId } = await setUpShopWithStaff();
    const res = await handler(post({ action: "members_remove", shopId, userId: staffId }, ownerSession));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: true });
  });

  it("removing the owner is a no-op that reports removed: false", async () => {
    const { handler, ownerSession, ownerId, shopId } = await setUpShopWithStaff();
    const res = await handler(post({ action: "members_remove", shopId, userId: ownerId }, ownerSession));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: false });
  });

  // Security review F01: a new staff member starts with every flag off and pulls just the shop, so their
  // phone's cursor moves past every order. The phones keep their cursor when flags change; the grant
  // gives what it makes visible a fresh seq, so the next sync brings it (customers before orders).
  describe("permission grants re-send what they make visible", () => {
    const SYNCED_AT = /^\d{4}-\d{2}-\d{2}T/;
    async function shopWithRecords() {
      const ctx = await setUpShopWithStaff();
      const changes = [
        { entity: "shop", id: ctx.shopId, data: { nameAr: "كيك سارة" } },
        { entity: "product", id: "p1", data: { nameAr: "كيك", priceMinor: 5000 } },
        { entity: "customer", id: "c1", data: { name: "Fatima" } },
        { entity: "order", id: "o1", data: { customerId: "c1", status: "new" } },
        { entity: "expense", id: "e1", data: { amountMinor: 3000 } },
      ];
      await ctx.handler(post({ action: "sync", shopId: ctx.shopId, cursor: 0, changes }, ctx.ownerSession));
      return ctx;
    }
    const sync = async (handler: (req: Request) => Promise<Response>, shopId: string, session: string, cursor: number) =>
      (await handler(post({ action: "sync", shopId, cursor, changes: [] }, session))).json();
    const grant = (handler: (req: Request) => Promise<Response>, shopId: string, ownerSession: string, userId: string, flags: Record<string, boolean>) =>
      handler(post({ action: "members_update", shopId, userId, permissions: { orders: false, prepare: false, money: false, products: false, ...flags } }, ownerSession));

    it("a staff phone already past every record gets customers, products and orders once orders is granted", async () => {
      const { handler, ownerSession, shopId, staffSession, staffId } = await shopWithRecords();
      const first = await sync(handler, shopId, staffSession, 0);
      expect(first.changes.map((c: { entity: string }) => c.entity)).toEqual(["shop"]);

      expect((await grant(handler, shopId, ownerSession, staffId, { orders: true })).status).toBe(200);
      const next = await sync(handler, shopId, staffSession, first.cursor);
      expect(next.changes.map((c: { entity: string; id: string }) => `${c.entity}/${c.id}`)).toEqual(["product/p1", "customer/c1", "order/o1"]);
      expect(next.membership.permissions).toEqual({ orders: true, prepare: false, money: false, products: false });
      expect(next.changes.every((c: { updatedAt: string }) => SYNCED_AT.test(c.updatedAt))).toBe(true);
      // Nothing more on the sync after that.
      expect((await sync(handler, shopId, staffSession, next.cursor)).changes).toEqual([]);
    });

    it("re-sent records are the same records: the owner's phone gets them again unchanged", async () => {
      const { handler, ownerSession, shopId, staffId } = await shopWithRecords();
      const ownerFirst = await sync(handler, shopId, ownerSession, 0);
      await grant(handler, shopId, ownerSession, staffId, { money: true });
      const ownerNext = await sync(handler, shopId, ownerSession, ownerFirst.cursor);
      const before = new Map(ownerFirst.changes.map((c: { entity: string; id: string }) => [`${c.entity}/${c.id}`, c]));
      expect(ownerNext.changes.length).toBeGreaterThan(0);
      for (const c of ownerNext.changes) {
        const old = before.get(`${c.entity}/${c.id}`) as { data: unknown; updatedAt: string; seq: number };
        expect(c.data).toEqual(old.data);
        expect(c.updatedAt).toBe(old.updatedAt);
        expect(c.seq).toBeGreaterThan(old.seq);
      }
    });

    it("a grant that shows nothing new, and a revocation, re-send nothing", async () => {
      const { handler, ownerSession, shopId, staffSession, staffId } = await shopWithRecords();
      await grant(handler, shopId, ownerSession, staffId, { orders: true });
      const all = await sync(handler, shopId, staffSession, 0);
      await grant(handler, shopId, ownerSession, staffId, { prepare: true }); // Same reach as orders.
      expect((await sync(handler, shopId, staffSession, all.cursor)).changes).toEqual([]);
      await grant(handler, shopId, ownerSession, staffId, {}); // Every flag off.
      expect((await sync(handler, shopId, staffSession, all.cursor)).changes).toEqual([]);
    });
  });
});

describe("createSyncHandler / photos", () => {
  async function setUpShop(permissions: { orders?: boolean; prepare?: boolean; money?: boolean; products?: boolean } = {}) {
    const handler = makeHandler();
    const { session: ownerSession } = await signUp("owner-1");
    const shopId = crypto.randomUUID();
    await handler(post({ action: "create_shop", shopId, name: "Sara's Cakes" }, ownerSession));
    const { code } = await (await handler(post({ action: "invite_create", shopId }, ownerSession))).json();
    const { session: staffSession, userId: staffId } = await signUp("staff-1");
    await handler(post({ action: "invite_join", code }, staffSession));
    if (Object.keys(permissions).length > 0) {
      await handler(post({ action: "members_update", shopId, userId: staffId, permissions: { orders: false, prepare: false, money: false, products: false, ...permissions } }, ownerSession));
    }
    return { handler, ownerSession, shopId, staffSession };
  }

  it("lets the owner upload a photo and returns its content-addressed photoId", async () => {
    const { handler, ownerSession, shopId } = await setUpShop();
    const res = await handler(post({ action: "photo_upload", shopId, mimeType: "image/jpeg", data: JPEG_BYTES.toString("base64") }, ownerSession));
    expect(res.status).toBe(200);
    const { photoId } = await res.json();
    expect(photoId).toMatch(/^[0-9a-f]{64}$/);
    expect(uploadedPhotos).toEqual([{ shopId, photoId, mimeType: "image/jpeg" }]);
  });

  it("refuses a photo upload from staff without products", async () => {
    const { handler, staffSession, shopId } = await setUpShop();
    const res = await handler(post({ action: "photo_upload", shopId, mimeType: "image/jpeg", data: JPEG_BYTES.toString("base64") }, staffSession));
    expect(res.status).toBe(403);
  });

  it("allows a photo upload from staff with products", async () => {
    const { handler, staffSession, shopId } = await setUpShop({ products: true });
    const res = await handler(post({ action: "photo_upload", shopId, mimeType: "image/jpeg", data: JPEG_BYTES.toString("base64") }, staffSession));
    expect(res.status).toBe(200);
  });

  it("rejects a mimeType that doesn't match the bytes' magic number", async () => {
    const { handler, ownerSession, shopId } = await setUpShop();
    const res = await handler(post({ action: "photo_upload", shopId, mimeType: "image/png", data: JPEG_BYTES.toString("base64") }, ownerSession));
    expect(res.status).toBe(400);
  });

  it("returns upload_failed (502) when the storage dependency fails", async () => {
    uploadShouldSucceed = false;
    const { handler, ownerSession, shopId } = await setUpShop();
    const res = await handler(post({ action: "photo_upload", shopId, mimeType: "image/jpeg", data: JPEG_BYTES.toString("base64") }, ownerSession));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upload_failed" });
  });

  it("allows a photo upload from staff with money (an expense's receipt photo)", async () => {
    const { handler, staffSession, shopId } = await setUpShop({ money: true });
    const res = await handler(post({ action: "photo_upload", shopId, mimeType: "image/jpeg", data: JPEG_BYTES.toString("base64") }, staffSession));
    expect(res.status).toBe(200);
  });

  it("still refuses a photo upload from staff with only orders or prepare", async () => {
    for (const flags of [{ orders: true }, { prepare: true }]) {
      const { handler, staffSession, shopId } = await setUpShop(flags);
      const res = await handler(post({ action: "photo_upload", shopId, mimeType: "image/jpeg", data: JPEG_BYTES.toString("base64") }, staffSession));
      expect(res.status).toBe(403);
    }
  });

  it("any member holding a permission (not just owner/products) can fetch a signed photo_url", async () => {
    const { handler, staffSession, shopId } = await setUpShop({ prepare: true });
    const res = await handler(post({ action: "photo_url", shopId, photoId: "a".repeat(64) }, staffSession));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain(shopId);
  });

  it("a member with every flag off pulls no photo ids and gets no photo_url (security review F01)", async () => {
    const { handler, staffSession, shopId } = await setUpShop();
    const res = await handler(post({ action: "photo_url", shopId, photoId: "a".repeat(64) }, staffSession));
    expect(res.status).toBe(403);
  });

  it("returns not_found when the signed URL dependency has nothing for that photo", async () => {
    signedUrlShouldExist = false;
    const { handler, ownerSession, shopId } = await setUpShop();
    const res = await handler(post({ action: "photo_url", shopId, photoId: "a".repeat(64) }, ownerSession));
    expect(res.status).toBe(404);
  });
});

describe("createSyncHandler / request shape", () => {
  it("rejects a non-POST request", async () => {
    const handler = makeHandler();
    expect((await handler(new Request("https://example.test/orderat-sync", { method: "GET" }))).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("https://example.test/orderat-sync", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
  });
});
