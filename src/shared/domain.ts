// Shared by the worker, the client and the tests. Keep in step with the CHECK constraints in migrations/.

export const ROLES = ["admin", "manager", "member"] as const;
export const STATUSES = ["todo", "in_progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
/** Everything that isn't finished yet. */
export const OPEN_STATUSES = STATUSES.filter((s) => s !== "done");
export const ACTIONS = ["task.created", "task.updated", "task.deleted", "comment.added", "user.role_changed", "user.left"] as const;

export const DAY_MS = 86_400_000;

/** The live board's WebSocket words. "changed" carries no data: the board fetches again. */
export const LIVE = { changed: "changed", ping: "ping", pong: "pong" } as const;

/** A calendar day as YYYY-MM-DD, the way due dates are stored. */
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** How many weeks of finished work the dashboard's trend shows, this week last. */
export const TREND_WEEKS = 8;
/** How many days the dashboard's "Due in the next N days" strip shows, starting today. */
export const UPCOMING_DAYS = 14;
/** Open tasks untouched this long show under "Needs attention". */
export const STALE_DAYS = 14;
/** The dashboard's "due this week": today and the 6 days after it. */
export const DUE_SOON_WINDOW_DAYS = 7;

export const MAX_LABELS = 5;
export const MAX_LABEL_LENGTH = 24;
export const MAX_CHECKLIST = 20;
export const MAX_COMMENT = 2000;
export const MAX_MENTIONS = 20;
export const MAX_CHECKLIST_TEXT = 200;
export type ChecklistItem = { text: string; done: boolean };
/** "2/5": ticked items out of all of them. */
export const checklistProgress = (items: Pick<ChecklistItem, "done">[]) => `${items.filter((i) => i.done).length}/${items.length}`;
/** Labels are compared and stored like this, so "Bug " and "bug" are the same label. */
export const normalizeLabel = (label: string) => label.trim().toLowerCase();

export type Role = (typeof ROLES)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Action = (typeof ACTIONS)[number];

export const STATUS_LABEL: Record<Status, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", manager: "Manager", member: "Member" };

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
  /** Open tasks to look at: past their due date, or untouched for STALE_DAYS (and not overdue). */
  attention: { overdue: AttentionList; stale: AttentionList };
  /** Open tasks due on each of the next UPCOMING_DAYS days, starting today. */
  upcoming: { date: string; count: number }[];
  /** Tasks finished in each of the last TREND_WEEKS 7-day weeks, oldest first; the last one ends today. */
  completed: { week_start: string; count: number }[];
  /** Average days from created to finished, for tasks finished in those weeks; null if none. */
  avg_days_to_done: number | null;
}

/** The first few tasks of a list, most urgent first, and how many there are in all. */
export type AttentionList = { tasks: AttentionTask[]; total: number };

export interface AttentionTask {
  id: number;
  title: string;
  due_date: string | null;
  assignee: { id: number; name: string } | null;
}

/** A task as the API returns it (GET /api/tasks). */
export interface Task {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  position: number;
  due_date: string | null;
  assignee: { id: number; name: string } | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  labels: string[];
  checklist: ChecklistItem[];
}

/** A task as a read-only share link shows it (POST /api/shared): no description, comments, emails or checklist text. */
export type SharedTask = Pick<Task, "id" | "title" | "status" | "priority" | "position" | "due_date" | "assignee" | "labels"> & {
  checklist: Pick<ChecklistItem, "done">[];
};

/** A workspace's week in numbers (GET /api/activity/weekly). The week runs from week_start up to, not including, week_end. */
export type WeeklySummary = {
  week_start: string;
  week_end: string;
  created: number;
  finished: number;
  comments: number;
  busiest: { name: string; changes: number } | null;
};
