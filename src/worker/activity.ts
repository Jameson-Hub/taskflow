import { Hono } from "hono";
import type { Action } from "../shared/domain";
import { can } from "../shared/policy";
import { requirePolicy, type AppEnv } from "./http";
import type { User } from "./session";

/** Pass as `taskId` to log against the row inserted just before, earlier in the same batch. */
export const JUST_INSERTED = Symbol("last_insert_rowid()");

/** Returns a statement so callers can batch it with the change it records. */
export function logActivity(db: D1Database, actor: User, taskId: number | null | typeof JUST_INSERTED, action: Action, detail: object) {
  const task = taskId === JUST_INSERTED ? "last_insert_rowid()" : "?";
  const binds = taskId === JUST_INSERTED ? [] : [taskId];
  return db
    .prepare(`INSERT INTO activity (workspace_id, user_id, task_id, action, detail) VALUES (?, ?, ${task}, ?, ?)`)
    .bind(actor.workspace_id, actor.id, ...binds, action, JSON.stringify(detail));
}

type ActivityRow = { id: number; user_id: number; actor_name: string; task_id: number | null; action: Action; detail: string; created_at: string };

export const activity = new Hono<AppEnv>();

activity.get("/", requirePolicy(can.viewActivity), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.user_id, a.task_id, a.action, a.detail, a.created_at, u.name AS actor_name
     FROM activity a JOIN users u ON u.id = a.user_id
     WHERE a.workspace_id = ? ORDER BY a.id DESC LIMIT 100`,
  )
    .bind(c.var.user.workspace_id)
    .all<ActivityRow>();
  return c.json(
    results.map(({ user_id, actor_name, detail, ...rest }) => ({
      ...rest,
      actor: { id: user_id, name: actor_name },
      detail: JSON.parse(detail),
    })),
  );
});
