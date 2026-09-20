import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "./db";
import { storage } from "./storage";
import { clients } from "../shared/schema";

describe("development schema synchronization", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "db:push", "--", "--force"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  it("makes registration payment columns queryable without losing client data", async () => {
    const before = await db.select({ id: clients.id }).from(clients);

    const rows = await db.select({
      id: clients.id,
      registrationPaymentAttemptKey: clients.registrationPaymentAttemptKey,
      registrationPaymentFailedAt: clients.registrationPaymentFailedAt,
      registrationPaymentFailureReason: clients.registrationPaymentFailureReason,
    }).from(clients);

    expect(rows).toHaveLength(before.length);
  });

  it("allows both startup maintenance checks to complete after synchronization", async () => {
    await expect(storage.repairStrandedClientAllocations()).resolves.toMatchObject({
      repaired: expect.any(Array),
      skipped: expect.any(Array),
    });
    await expect(storage.repairSlotIntegrity()).resolves.toMatchObject({
      repaired: expect.any(Array),
      skipped: expect.any(Array),
    });
  });
});
