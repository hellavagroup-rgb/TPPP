export class ClientCreationError extends Error {}

export async function readClientCreationError(response: Response): Promise<ClientCreationError> {
  const body = await response.json().catch(() => null);
  return new ClientCreationError(
    typeof body?.error === "string" && body.error.trim()
      ? body.error
      : "Failed to create client. Please check the details and try again.",
  );
}
