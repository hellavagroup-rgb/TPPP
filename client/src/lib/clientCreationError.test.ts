import { expect, it } from "vitest";
import { ClientCreationError, readClientCreationError } from "./clientCreationError";

it("preserves the duplicate W-number explanation for the creation toast", async () => {
  const message = "A client with this W-number already exists. Check confirmed and archived clients.";
  const error = await readClientCreationError(new Response(JSON.stringify({ error: message }), { status: 409 }));
  expect(error).toBeInstanceOf(ClientCreationError);
  expect(error.message).toBe(message);
});

it("preserves other actionable server errors", async () => {
  expect((await readClientCreationError(new Response(JSON.stringify({ error: "Tenant context is required" }), { status: 403 }))).message)
    .toBe("Tenant context is required");
});

it("handles non-JSON errors and validation arrays without showing raw response data", async () => {
  for (const body of ["upstream unavailable", JSON.stringify({ error: [{ path: ["email"] }] }), JSON.stringify({ error: "" })]) {
    const error = await readClientCreationError(new Response(body, { status: 500 }));
    expect(error.message).toBe("Failed to create client. Please check the details and try again.");
  }
});
