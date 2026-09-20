import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const OPERATIONAL_STALE_TIME = 2 * 60 * 1000;
export const OPERATIONAL_REFETCH_INTERVAL = 5 * 60 * 1000;

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("401: Your session has expired. Please sign in again.");
    this.name = "UnauthorizedError";
  }
}

let authLossHandler: (() => void) | null = null;

/** Registered by AuthProvider so any protected query can end a stale session safely. */
export function setAuthLossHandler(handler: (() => void) | null): void {
  authLossHandler = handler;
}

export async function throwIfResNotOk(res: Response) {
  if (res.status === 401) {
    authLossHandler?.();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchOnWindowFocus: true,
      // Operational data should never remain indefinitely fresh. Five minutes
      // bounds background staleness while focus refreshes staff workflows.
      staleTime: OPERATIONAL_STALE_TIME,
      refetchInterval: OPERATIONAL_REFETCH_INTERVAL,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
