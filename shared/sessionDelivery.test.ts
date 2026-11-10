import { describe, expect, it } from "vitest";
import { CYA_PSYCHOLOGY_TENANT_ID as CYA } from "./practicePolicies";
import { availableDeliveryModes, resolveDeliveryMode } from "./sessionDelivery";

describe("appointment delivery capability", () => {
  it("lets CY&A offer an at-practice slot online or in person", () => {
    expect(availableDeliveryModes(CYA, "in_person")).toEqual(["in_person", "online"]);
    expect(resolveDeliveryMode(CYA, "in_person", "online")).toBe("online");
    expect(resolveDeliveryMode(CYA, "in_person", "in_person")).toBe("in_person");
  });
  it("never offers an online-only slot in person", () => {
    expect(availableDeliveryModes(CYA, "online")).toEqual(["online"]);
    expect(resolveDeliveryMode(CYA, "online", "in_person")).toBeNull();
  });
  it("preserves other practices and legacy unspecified modes", () => {
    expect(availableDeliveryModes("other", "in_person")).toEqual(["in_person"]);
    expect(resolveDeliveryMode("other", "in_person", "online")).toBeNull();
    expect(resolveDeliveryMode(CYA, "in_person")).toBe("in_person");
  });
  it("rejects malformed modes rather than silently treating them as online", () => {
    for (const mode of ["either", "", null, {}, 1]) {
      expect(resolveDeliveryMode(CYA, "in_person", mode)).toBeNull();
    }
    expect(availableDeliveryModes(CYA, undefined)).toEqual([]);
  });
});
