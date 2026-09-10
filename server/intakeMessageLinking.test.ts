import { describe, expect, it } from "vitest";
import { findUniqueOrphanedIntakeMessageId } from "./intakeMessageLinking";

describe("findUniqueOrphanedIntakeMessageId", () => {
  it("returns one exact case-insensitive email match", () => {
    expect(findUniqueOrphanedIntakeMessageId("Client@Example.com", [
      { id: "one", email: "client@example.com" },
      { id: "two", email: "other@example.com" },
    ])).toBe("one");
  });

  it("does not guess when more than one message has the same email", () => {
    expect(findUniqueOrphanedIntakeMessageId("client@example.com", [
      { id: "one", email: "client@example.com" },
      { id: "two", email: "CLIENT@example.com" },
    ])).toBeNull();
  });

  it("does not use generated placeholder addresses", () => {
    expect(findUniqueOrphanedIntakeMessageId(
      "intake-pending-123@noemail.placeholder",
      [{ id: "one", email: "intake-pending-123@noemail.placeholder" }],
    )).toBeNull();
  });
});