import { Hono } from "hono";
import type { Action } from "../shared/domain";
import { can } from "../shared/policy";
import { requirePolicy, type AppEnv } from "./http";

/** Returns a statement so callers can batch it with the change it records. */
export function logActivity(db: D1Database, userId: number, taskId: number | null, action: Action, detail: object) {
  return db
    .prepare("INSERT INTO activity (user_id, task_id, action, detail) VALUES (?, ?, ?, ?)")
    .bind(userId, taskId, action, JSON.stringify(detail));
}

type ActivityRow = { id: number; user_id: number; actor_name: string; task_id: number | null; action: Action; detail: string; created_at: string };

export const activity = new Hono<AppEnv>();

activity.get("/", requirePolicy(can.viewActivity), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.name AS actor_name FROM activity a JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100`,
  ).all<ActivityRow>();
  return c.json(
    results.map(({ user_id, actor_name, detail, ...rest }) => ({
      ...rest,
      actor: { id: user_id, name: actor_name },
      detail: JSON.parse(detail),
    })),
  );
});
