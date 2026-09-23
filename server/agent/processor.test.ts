import { describe, expect, it } from "vitest";
import { createMessageProcessor } from "./processor";
import { MemoryStore, type StoredOrder } from "./store";
import { demoProducts } from "../../src/lib/plan";
import type { IncomingMessage } from "../whatsapp/incoming";

// Monday 2026-09-21 09:00 Bahrain time.
const NOW = new Date("2026-09-21T06:00:00Z");

/** A store that throws on add() for one chosen customer, to simulate a persistence failure for one message. */
class ThrowingStore extends MemoryStore {
  constructor(private readonly throwForCustomerId: string) {
    super();
  }
  override async add(stored: StoredOrder): Promise<void> {
    if (stored.customerId === this.throwForCustomerId) throw new Error("database is down");
    return super.add(stored);
  }
}

function textMessage(id: string, from: string, text: string): IncomingMessage {
  return { channel: "whatsapp", id, from, profileName: "Sara", type: "text", text };
}

describe("createMessageProcessor", () => {
  it("logs and continues when the store throws for one message, so the next message in the batch is still processed", async () => {
    const store = new ThrowingStore("111");
    const sent: { to: string; text: string }[] = [];
    const logs: string[] = [];
    const process = createMessageProcessor({
      store,
      products: demoProducts(),
      senders: { whatsapp: async (to, text) => { sent.push({ to, text }); } },
      now: () => NOW,
      log: (m) => logs.push(String(m)),
    });

    // Same "batch" as a webhook payload would deliver: both processed with the same processor instance.
    await process(textMessage("wamid.1", "111", "ابي 12 تشيز كيك كب"));
    await process(textMessage("wamid.2", "222", "ابي 12 تشيز كيك كب"));

    expect(logs.join("\n")).toContain("database is down");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("222");
    expect((await store.all())).toHaveLength(1);
    expect((await store.all())[0].customerId).toBe("222");
  });
});
