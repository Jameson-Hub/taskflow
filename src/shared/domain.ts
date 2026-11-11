// Shared by the worker, the client and the tests. Keep in step with the CHECK constraints in migrations/.

export const ROLES = ["admin", "manager", "member"] as const;
export const STATUSES = ["todo", "in_progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const ACTIONS = ["task.created", "task.updated", "task.deleted", "comment.added", "user.role_changed", "user.left"] as const;

export const DAY_MS = 86_400_000;

export type Role = (typeof ROLES)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Action = (typeof ACTIONS)[number];
