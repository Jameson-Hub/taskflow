import { Hono } from "hono";
import { z } from "zod";
import type { ChecklistItem, SharedTask } from "../shared/domain";
import { can } from "../shared/policy";
import { fail, readBody, viewLimited, requirePolicy, type AppEnv } from "./http";
import { newToken, sha256 } from "./session";
import { assigneeOf, decode } from "./tasks";

/** Admins make, check, reset and turn off the workspace's read-only link: `/api/share`. */
export const share = new Hono<AppEnv>();
share.use(requirePolicy(can.manageTeam));

share.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT created_at FROM board_shares WHERE workspace_id = ?")
    .bind(c.var.user.workspace_id)
    .first<{ created_at: string }>();
  // The token is only shown when it's made; only its hash is stored.
  return c.json(row ? { enabled: true, created_at: row.created_at } : { enabled: false });
});

// Making a link replaces any earlier one, so this is also "reset".
share.post("/", async (c) => {
  const me = c.var.user;
  const token = newToken();
  await c.env.DB.prepare(
    `INSERT INTO board_shares (id, workspace_id, created_by) VALUES (?, ?, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET id = excluded.id, created_by = excluded.created_by, created_at = datetime('now')`,
  )
    .bind(await sha256(token), me.workspace_id, me.id)
    .run();
  return c.json({ token }, 201);
});

share.delete("/", async (c) => {
  await c.env.DB.prepare("DELETE FROM board_shares WHERE workspace_id = ?").bind(c.var.user.workspace_id).run();
  return c.json({ ok: true });
});

/** Opening a link, no sign-in needed: `/api/shared`. Only what a status board needs, no descriptions, comments or emails. */
export const shared = new Hono<AppEnv>();

// Deleted when the admin who made it is demoted or leaves (users.ts, account.ts), like invites.
const LIVE_SHARE = "SELECT workspace_id FROM board_shares WHERE id = ?1";

type SharedRow = Omit<SharedTask, "assignee" | "labels" | "checklist"> & { assignee_id: number | null; assignee_name: string | null; labels: string; checklist: string };

// POST with the token in the body: a URL path would put it in request logs.
shared.post("/", viewLimited, async (c) => {
  const { token } = await readBody(c, z.object({ token: z.string() }), "Missing share token");
  const id = await sha256(token);
  // Columns listed, not t.*, so nothing new on tasks is shared by accident.
  const [workspace, tasks] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT name FROM workspaces WHERE id = (${LIVE_SHARE})`).bind(id),
    c.env.DB.prepare(
      `SELECT t.id, t.title, t.status, t.priority, t.position, t.due_date, t.assignee_id, u.name AS assignee_name, t.labels, t.checklist
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.workspace_id = (${LIVE_SHARE}) ORDER BY t.position, t.id`,
    ).bind(id),
  ]);
  const name = (workspace?.results[0] as { name: string } | undefined)?.name;
  if (name === undefined) fail(404, "This link has been turned off or replaced. Ask for a new one.");
  return c.json({
    workspace: name,
    tasks: (tasks!.results as SharedRow[]).map(({ assignee_id, assignee_name, labels, checklist, ...task }): SharedTask => ({
      ...task,
      assignee: assigneeOf(assignee_id, assignee_name),
      labels: decode("labels", labels) as string[],
      checklist: (decode("checklist", checklist) as ChecklistItem[]).map(({ done }) => ({ done })),
    })),
  });
});
