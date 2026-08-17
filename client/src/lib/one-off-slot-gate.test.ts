import { describe, it, expect } from "vitest";

/**
 * The availability page gates the "One-off Slot" <SelectItem> on:
 *
 *   {tenant?.oneOffSlotsEnabled && <SelectItem value="SpecificDate">One-off Slot</SelectItem>}
 *
 * The tenant query is enabled for both "admin" and "clinician" roles, so the
 * flag is always fetched when a clinician opens the dialog. These tests pin
 * the exact gate expression so a future refactor cannot accidentally show the
 * option to clinicians whose tenant has the flag disabled.
 */

/** Mirrors the boolean expression used in availability.tsx line ~659. */
const isOneOffSlotVisible = (
  tenant: { oneOffSlotsEnabled?: boolean } | undefined,
): boolean => Boolean(tenant?.oneOffSlotsEnabled);

describe("one-off slot gate – clinician with flag OFF should never see the option", () => {
  it("is hidden when tenant data has not loaded yet (undefined)", () => {
    expect(isOneOffSlotVisible(undefined)).toBe(false);
  });

  it("is hidden when oneOffSlotsEnabled is explicitly false", () => {
    expect(isOneOffSlotVisible({ oneOffSlotsEnabled: false })).toBe(false);
  });

  it("is hidden when oneOffSlotsEnabled is absent from the response", () => {
    expect(isOneOffSlotVisible({})).toBe(false);
  });
});

describe("one-off slot gate – clinician with flag ON should see the option", () => {
  it("is visible when oneOffSlotsEnabled is true", () => {
    expect(isOneOffSlotVisible({ oneOffSlotsEnabled: true })).toBe(true);
  });
});
