import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://session-test.invalid/test";
});

describe("persistent session configuration", () => {
  it("keeps the intended secure 24-hour cookie contract", async () => {
    const { buildSessionOptions, SESSION_MAX_AGE_MS } = await import("./auth");
    const store = {} as any;
    const options = buildSessionOptions(store);
    expect(options.store).toBe(store);
    expect(options.cookie).toMatchObject({
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(SESSION_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("creates a shared-store instance without requiring a live database connection", async () => {
    const { createPersistentSessionStore } = await import("./auth");
    const fakePool = { query: () => Promise.resolve({ rows: [] }) } as any;
    const first = createPersistentSessionStore(fakePool);
    const afterRestart = createPersistentSessionStore(fakePool);
    expect(first).toBeTruthy();
    expect(afterRestart).toBeTruthy();
    expect(first).not.toBe(afterRestart);
    // Both instances target the same configured PostgreSQL table, so a
    // signed session cookie can be read by a replacement process.
  });

  it("revokes matching PostgreSQL sessions with a parameterized delete", async () => {
    const { destroySessionsForUser } = await import("./auth");
    const query = vi.fn().mockResolvedValue({ rowCount: 2 });
    await expect(destroySessionsForUser("user-123", { query } as any)).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(`sess -> 'passport' ->> 'user' = $1`),
      ["user-123"],
    );
  });
});

describe("role authentication middleware", () => {
  function responseRecorder() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { status, json };
  }

  it.each(["requireAdmin", "requireClinician"] as const)(
    "%s returns 401 for an expired session",
    async (middlewareName) => {
      const auth = await import("./auth");
      const res = responseRecorder();
      auth[middlewareName]({ isAuthenticated: () => false }, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    },
  );

  it("reserves 403 for an authenticated user with the wrong role", async () => {
    const { requireAdmin } = await import("./auth");
    const res = responseRecorder();
    requireAdmin(
      { isAuthenticated: () => true, user: { role: "clinician" } },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});