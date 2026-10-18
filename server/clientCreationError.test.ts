import { describe, expect, it } from "vitest";
import { clientCreationConflict } from "./clientCreationError";

describe("manual client creation conflicts", () => {
  const duplicate = { code: "23505", constraint: "clients_display_id_unique" };

  it("recognises the production Drizzle-wrapped duplicate without exposing query data", () => {
    const error = new Error("Failed query: insert into clients; params: private data", { cause: duplicate });
    const message = clientCreationConflict(error)!;
    expect(message).toContain("W-number already exists");
    expect(message).toContain("confirmed and archived");
    expect(message).not.toMatch(/params|private data|insert into/i);
  });

  it("handles direct and multiply wrapped database errors", () => {
    expect(clientCreationConflict(duplicate)).toContain("W-number");
    expect(clientCreationConflict(new Error("wrapper", { cause: new Error("wrapper", { cause: duplicate }) })))
      .toBe(clientCreationConflict(duplicate));
  });

  it("does not mistake another constraint for a W-number duplicate", () => {
    expect(clientCreationConflict({ code: "23505", constraint: "other_unique" }))
      .toBe("A client with these details already exists.");
  });

  it("leaves validation, connection and other errors alone", () => {
    for (const error of [null, undefined, "duplicate", new Error("unique query failed"), { code: "08006" }]) {
      expect(clientCreationConflict(error)).toBeUndefined();
    }
  });

  it("does not loop on malformed cause chains", () => {
    const error: any = {};
    error.cause = error;
    expect(clientCreationConflict(error)).toBeUndefined();
  });
});
