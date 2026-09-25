import { MemoryStore } from "./store.ts";
import { describeOrderStoreContract } from "./order-store.contract.ts";

describeOrderStoreContract("MemoryStore", () => new MemoryStore());
