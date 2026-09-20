export const PAYMENT_RETURN_POLL_INTERVAL_MS = 2_000;
export const PAYMENT_RETURN_POLL_TIMEOUT_MS = 30_000;

export function nextPaymentReturnCheck(input: {
  status: string;
  elapsedMs: number;
}): "stop" | "poll" | "timeout" {
  if (input.status !== "processing") return "stop";
  if (input.elapsedMs >= PAYMENT_RETURN_POLL_TIMEOUT_MS) return "timeout";
  return "poll";
}