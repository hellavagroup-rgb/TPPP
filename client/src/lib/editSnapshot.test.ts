import { describe, expect, it } from "vitest";
import { createEditSnapshot, reconcileServerSnapshot, shouldApplyServerSnapshot } from "./editSnapshot";

describe("edit snapshots", () => {
  it("allows a pristine form to adopt a background server update", () => {
    const opened = createEditSnapshot({ email: "old@example.com", notes: "" });
    expect(shouldApplyServerSnapshot(opened, { email: "old@example.com", notes: "" }, true)).toBe(true);
  });

  it("keeps unsaved form values when the server refreshes", () => {
    const opened = createEditSnapshot({ email: "old@example.com", notes: "" });
    expect(shouldApplyServerSnapshot(opened, { email: "draft@example.com", notes: "" }, true)).toBe(false);
    const reconciled = reconcileServerSnapshot(
      opened,
      { email: "draft@example.com", notes: "" },
      { email: "server@example.com", notes: "" },
      true,
    );
    expect(reconciled.applied).toBe(false);
    expect(reconciled.formValue.email).toBe("draft@example.com");
  });

  it("updates both a pristine form and its baseline after a server refresh", () => {
    const opened = createEditSnapshot({ email: "old@example.com", notes: "" });
    const reconciled = reconcileServerSnapshot(
      opened,
      { email: "old@example.com", notes: "" },
      { email: "server@example.com", notes: "updated" },
      true,
    );
    expect(reconciled.applied).toBe(true);
    expect(reconciled.formValue).toEqual({ email: "server@example.com", notes: "updated" });
    expect(reconciled.openedSnapshot).toEqual(reconciled.formValue);
  });
});