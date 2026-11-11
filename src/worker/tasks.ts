import { Hono } from "hono";
import { z } from "zod";
import { PRIORITIES, STATUSES, type Priority, type Status } from "../shared/domain";
import { can } from "../shared/policy";
import { JUST_INSERTED, logActivity } from "./activity";
import { fail, orNotFound, idParam, readBody, requirePolicy, type AppEnv } from "./http";

type TaskRow = {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  position: number;
  due_date: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
};

const SELECT_TASK = `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id`;

function toTask({ assignee_id, assignee_name, ...rest }: TaskRow) {
  return { ...rest, assignee: assignee_id === null ? null : { id: assignee_id, name: assignee_name } };
}

const status = z.enum(STATUSES);
const priority = z.enum(PRIORITIES);
const dueDate = z.iso.date().nullable();

const newTask = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""),
  status: status.default("todo"),
  priority: priority.default("medium"),
  due_date: dueDate.default(null),
  assignee_id: z.number().int().nullable().default(null),
});

const taskPatch = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    status,
    priority,
    due_date: dueDate,
    assignee_id: z.number().int().nullable(),
    position: z.number().finite(),
  })
  .partial();

async function requireAssignee(db: D1Database, workspaceId: number, id: number | null | undefined) {
  if (id === null || id === undefined) return;
  const onTeam = await db.prepare("SELECT 1 FROM users WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL").bind(id, workspaceId).first();
  if (!onTeam) fail(400, "Assignee isn't on the team");
}

// Lookups are always scoped to the caller's workspace, so another workspace's task reads as "not found".
const selectTask = (db: D1Database, workspaceId: number, id: number) =>
  db.prepare(`${SELECT_TASK} WHERE t.id = ? AND t.workspace_id = ?`).bind(id, workspaceId);
const findTask = (db: D1Database, workspaceId: number, id: number) => selectTask(db, workspaceId, id).first<TaskRow>();

export const tasks = new Hono<AppEnv>();

tasks.get("/", async (c) => {
  const { q, assignee, priority: wantedPriority } = c.req.query();
  const where = ["t.workspace_id = ?"];
  const params: (string | number)[] = [c.var.user.workspace_id];
  if (q?.trim()) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
    const pattern = `%${q.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    params.push(pattern, pattern);
  }
  if (assignee === "none") where.push("t.assignee_id IS NULL");
  else if (assignee && /^[0-9]+$/.test(assignee)) {
    where.push("t.assignee_id = ?");
    params.push(Number(assignee));
  }
  if (priority.safeParse(wantedPriority).success) {
    where.push("t.priority = ?");
    params.push(wantedPriority!);
  }
  const { results } = await c.env.DB.prepare(
    `${SELECT_TASK} WHERE ${where.join(" AND ")} ORDER BY t.position, t.id`,
  )
    .bind(...params)
    .all<TaskRow>();
  return c.json(results.map(toTask));
});

tasks.post("/", async (c) => {
  const t = await readBody(c, newTask, "A task needs a title");
  const user = c.var.user;
  if (!can.assign(user, t.assignee_id)) fail(403, "Members can only assign tasks to themselves");
  await requireAssignee(c.env.DB, user.workspace_id, t.assignee_id);

  // One atomic batch. The SELECT runs before the activity insert, which would move last_insert_rowid().
  const [, created] = await c.env.DB.batch<TaskRow>([
    c.env.DB.prepare(
      `INSERT INTO tasks (workspace_id, title, description, status, priority, due_date, assignee_id, created_by, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE workspace_id = ? AND status = ?))`,
    ).bind(user.workspace_id, t.title, t.description, t.status, t.priority, t.due_date, t.assignee_id, user.id, user.workspace_id, t.status),
    c.env.DB.prepare(`${SELECT_TASK} WHERE t.id = last_insert_rowid()`),
    logActivity(c.env.DB, user, JUST_INSERTED, "task.created", { title: t.title }),
  ]);
  return c.json(toTask(created!.results[0]!), 201);
});

tasks.patch("/:id{[0-9]+}", async (c) => {
  const changes = await readBody(c, taskPatch, "Some fields are invalid");
  const user = c.var.user;
  const task = orNotFound(await findTask(c.env.DB, user.workspace_id, idParam(c)), "Task");
  if (!can.editTask(user, task)) fail(403, "You can only edit your own tasks");
  if (changes.assignee_id !== undefined && changes.assignee_id !== task.assignee_id && !can.assign(user, changes.assignee_id)) {
    fail(403, "Only managers can assign tasks to others");
  }
  await requireAssignee(c.env.DB, user.workspace_id, changes.assignee_id);

  const fields = Object.keys(changes) as (keyof typeof changes)[];
  if (fields.length === 0) return c.json(toTask(task));

  const update = c.env.DB.prepare(
    `UPDATE tasks SET ${fields.map((f) => `${f} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
  ).bind(...fields.map((f) => changes[f] ?? null), task.id);

  // Reordering alone is noise in the log; only real edits are recorded.
  const changed = Object.fromEntries(
    fields.filter((f) => f !== "position" && changes[f] !== task[f]).map((f) => [f, [task[f], changes[f]]]),
  );
  const log = Object.keys(changed).length
    ? [logActivity(c.env.DB, user, task.id, "task.updated", { title: changes.title ?? task.title, changes: changed })]
    : [];
  const results = await c.env.DB.batch<TaskRow>([update, ...log, selectTask(c.env.DB, user.workspace_id, task.id)]);
  return c.json(toTask(results.at(-1)!.results[0]!));
});

tasks.delete("/:id{[0-9]+}", requirePolicy(can.deleteTask), async (c) => {
  const task = orNotFound(await findTask(c.env.DB, c.var.user.workspace_id, idParam(c)), "Task");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(task.id),
    logActivity(c.env.DB, c.var.user, task.id, "task.deleted", { title: task.title }),
  ]);
  return c.body(null, 204);
});
