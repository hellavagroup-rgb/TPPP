import { useCallback, useEffect, useState } from "react";
import { QueryKey, useQueryClient } from "@tanstack/react-query";

export const OPERATIONAL_QUERY_KEYS: QueryKey[] = [
  ["/api/clients"],
  ["/api/clinicians"],
  ["/api/clinicians/me/slot-clients"],
  ["/api/tenant"],
  ["/api/tenant/features"],
];

export function affectedOperationalQueryKeys(): QueryKey[] {
  return OPERATIONAL_QUERY_KEYS.map((key) => [...key]);
}

export function invalidateOperationalData(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return Promise.all(
    affectedOperationalQueryKeys().map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  ).then(() => undefined);
}

export function useOperationalRefresh(enabled = true) {
  const queryClient = useQueryClient();
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(async () => {
    await queryClient.refetchQueries({ type: "active" });
    forceUpdate((value) => value + 1);
  }, [queryClient]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (enabled && document.visibilityState === "visible") forceUpdate((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [enabled]);

  const timestamps = affectedOperationalQueryKeys()
    .map((key) => queryClient.getQueryState(key)?.dataUpdatedAt ?? 0)
    .filter(Boolean);
  const lastUpdated = timestamps.length ? Math.max(...timestamps) : null;
  return { refresh, lastUpdated };
}