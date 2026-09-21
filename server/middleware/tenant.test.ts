import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../encryption", () => ({ decryptSecret: vi.fn() }));

import { isOpenTenantPath } from "./tenant";

describe("tenant middleware public paths", () => {
  it("keeps form completion copy public for unauthenticated form recipients", () => {
    expect(isOpenTenantPath({
      path: "/public/form-completion-page/client-a",
      user: undefined,
    })).toBe(true);
  });

  it("does not make protected client records public", () => {
    expect(isOpenTenantPath({
      path: "/clients/client-a",
      user: undefined,
    })).toBe(false);
  });
});