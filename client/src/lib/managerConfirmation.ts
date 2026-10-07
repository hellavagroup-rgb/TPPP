import { useQuery } from "@tanstack/react-query";

export type ManagerConfirmationAccess = {
  configured: boolean;
  canConfigure: boolean;
  canOverride: boolean;
  managerUserIds: string[];
  updatedAt: string | null;
};

export const MANAGER_SETTINGS_KEY = ["/api/manager-confirmation/settings"];
export function useManagerConfirmationAccess(enabled: boolean) {
  return useQuery<ManagerConfirmationAccess>({ queryKey: MANAGER_SETTINGS_KEY, enabled });
}

export function managerErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The request could not be saved. Please try again.";
  try {
    const body = JSON.parse(error.message.replace(/^\d+:\s*/, ""));
    if (typeof body.error === "string") return body.error;
  } catch { /* Network errors already have a readable message. */ }
  return error.message;
}
