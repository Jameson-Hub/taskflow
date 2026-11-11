import type { Role } from "./domain";

// The single source of the permission rules. The worker enforces them; the client uses them to hide what would fail.

type Actor = { id: number; role: Role };
type OwnedTask = { created_by: number; assignee_id: number | null };

export const LEAD_ROLES: Role[] = ["admin", "manager"];

const isLead = (u: Actor) => LEAD_ROLES.includes(u.role);

export const can = {
  /** Members work on their own tasks; leads run the whole board. */
  editTask: (u: Actor, t: OwnedTask) => isLead(u) || t.created_by === u.id || t.assignee_id === u.id,
  /** Members may only leave a task unassigned or assign it to themselves. */
  assign: (u: Actor, assigneeId: number | null) => isLead(u) || assigneeId === null || assigneeId === u.id,
  reassign: isLead,
  deleteTask: isLead,
  deleteComment: (u: Actor, authorId: number) => u.role === "admin" || authorId === u.id,
  viewActivity: isLead,
  manageTeam: (u: Actor) => u.role === "admin",
};

