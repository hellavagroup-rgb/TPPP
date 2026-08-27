export type ActivityCategory = "all" | "clients" | "tasks" | "availability";

export const DEFAULT_ACTIVITY_CATEGORY: ActivityCategory = "all";

export const ACTIVITY_TABS: ReadonlyArray<{ value: ActivityCategory; label: string }> = [
  { value: "all", label: "All Activity" },
  { value: "clients", label: "Clients & Forms" },
  { value: "tasks", label: "Tasks" },
  { value: "availability", label: "Availability" },
];