import type { IntakeMessage } from "@shared/schema";
import { throwIfResNotOk } from "./queryClient";

export const MISSING_ORIGINAL_ENQUIRY =
  "No original enquiry is linked to this client. Check the Intake Inbox or original correspondence. Clients added manually may not have a linked enquiry.";

/** A missing source is not a network failure. Keep other errors/auth handling intact. */
export async function fetchOriginalEnquiry(clientId: string): Promise<IntakeMessage | null> {
  const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/intake-message`, {
    credentials: "include",
  });
  if (response.status === 404) return null;
  await throwIfResNotOk(response);
  return response.json();
}
