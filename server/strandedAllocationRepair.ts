export const UNALLOCATED_CLIENT_STATUSES = [
  "New",
  "Forms Sent",
  "Forms Completed",
  "Waitlist",
  "OptionsSent",
] as const;

export function isUnallocatedClientStatus(status: string): boolean {
  return (UNALLOCATED_CLIENT_STATUSES as readonly string[]).includes(status);
}
