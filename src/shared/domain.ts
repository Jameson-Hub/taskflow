// Shared by the worker, the client and the tests. Keep in step with the CHECK constraints in migrations/.

export const ROLES = ["admin", "manager", "member"] as const;
export const STATUSES = ["todo", "in_progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
/** Everything that isn't finished yet. */
export const OPEN_STATUSES = STATUSES.filter((s) => s !== "done");
export const ACTIONS = ["task.created", "task.updated", "task.deleted", "comment.added", "user.role_changed", "user.left"] as const;

export const DAY_MS = 86_400_000;

/** A calendar day as YYYY-MM-DD, the way due dates are stored. */
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The dashboard's "due this week": today and the 6 days after it. */
export const DUE_SOON_WINDOW_DAYS = 7;

export const MAX_LABELS = 5;
export const MAX_LABEL_LENGTH = 24;
/** Labels are compared and stored like this, so "Bug " and "bug" are the same label. */
export const normalizeLabel = (label: string) => label.trim().toLowerCase();

export type Role = (typeof ROLES)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Action = (typeof ACTIONS)[number];

/** GET /api/stats */
export interface Stats {
  open: number;
  done: number;
  overdue: number;
  due_soon: number;
  by_status: Record<Status, number>;
  by_priority: Record<Priority, number>;
  workload: { id: number | null; name: string; open: number; overdue: number }[];
  labels: { name: string; count: number }[];
}
