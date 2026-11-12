import { Hono } from "hono";
import { z } from "zod";
import {
  MAX_CHECKLIST,
  MAX_CHECKLIST_TEXT,
  MAX_LABEL_LENGTH,
  MAX_LABELS,
  normalizeLabel,
  PRIORITIES,
  STATUSES,
  type ChecklistItem,
  type Priority,
  type Status,
} from "../shared/domain";
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
  /** JSON arrays; parsed by toTask. */
  labels: string;
  checklist: string;
};

const SELECT_TASK = `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id`;

// Lists are stored as JSON text; every other field is stored as is. The task routes read and write through these.
const JSON_FIELDS = new Set(["labels", "checklist"]);
const encode = (field: string, value: unknown) => (JSON_FIELDS.has(field) ? JSON.stringify(value) : (value ?? null));
export const decode = (field: string, value: unknown) => (JSON_FIELDS.has(field) ? (JSON.parse(value as string) as unknown) : value);

/** How a task's assignee appears in responses. */
export const assigneeOf = (id: number | null, name: string | null) => (id === null ? null : { id, name: name ?? "" });

function toTask({ assignee_id, assignee_name, labels, checklist, ...rest }: TaskRow) {
  return {
    ...rest,
    labels: decode("labels", labels) as string[],
    checklist: decode("checklist", checklist) as ChecklistItem[],
    assignee: assigneeOf(assignee_id, assignee_name),
  };
}

const status = z.enum(STATUSES);
const priority = z.enum(PRIORITIES);
const dueDate = z.iso.date().nullable();
const labels = z
  .array(z.string().transform(normalizeLabel).pipe(z.string().min(1).max(MAX_LABEL_LENGTH)))
  .max(MAX_LABELS)
  .transform((all) => [...new Set(all)]);

const checklist = z
  .array(z.object({ text: z.string().trim().min(1).max(MAX_CHECKLIST_TEXT), done: z.boolean() }))
  .max(MAX_CHECKLIST);

const newTask = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""),
  status: status.default("todo"),
  priority: priority.default("medium"),
  due_date: dueDate.default(null),
  assignee_id: z.number().int().nullable().default(null),
  labels: labels.default([]),
  checklist: checklist.default([]),
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
    labels,
    checklist,
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
  const { q, assignee, label, mentioned, priority: wantedPriority } = c.req.query();
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
  if (mentioned === "1") {
    where.push("EXISTS (SELECT 1 FROM comments c, json_each(c.mentions) m WHERE c.task_id = t.id AND m.value = ?)");
    params.push(c.var.user.id);
  }
  const wantedLabel = label && normalizeLabel(label);
  if (wantedLabel) {
    where.push("EXISTS (SELECT 1 FROM json_each(t.labels) WHERE value = ?)");
    params.push(wantedLabel);
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

/** Every label in use in the workspace, for the board's filter. */
tasks.get("/labels", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT DISTINCT j.value AS name FROM tasks t, json_each(t.labels) j WHERE t.workspace_id = ? ORDER BY name",
  )
    .bind(c.var.user.workspace_id)
    .all<{ name: string }>();
  return c.json(results.map((r) => r.name));
});

// One task, for a drawer following a task the board's filters no longer include.
tasks.get("/:id{[0-9]+}", async (c) => {
  const row = orNotFound(await findTask(c.env.DB, c.var.user.workspace_id, idParam(c)), "Task");
  return c.json(toTask(row));
});

tasks.post("/", async (c) => {
  const t = await readBody(c, newTask, "A task needs a title");
  const user = c.var.user;
  if (!can.assign(user, t.assignee_id)) fail(403, "Members can only assign tasks to themselves");
  await requireAssignee(c.env.DB, user.workspace_id, t.assignee_id);

  // One atomic batch. The SELECT runs before the activity insert, which would move last_insert_rowid().
  const [, created] = await c.env.DB.batch<TaskRow>([
    c.env.DB.prepare(
      `INSERT INTO tasks (workspace_id, title, description, status, priority, due_date, assignee_id, labels, checklist, created_by, position, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE workspace_id = ?1 AND status = ?4),
               CASE WHEN ?4 = 'done' THEN datetime('now') END)`,
    ).bind(user.workspace_id, t.title, t.description, t.status, t.priority, t.due_date, t.assignee_id, encode("labels", t.labels), encode("checklist", t.checklist), user.id),
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

  // Reordering isn't work on the task, so a position-only change leaves updated_at alone.
  const touched = fields.some((f) => f !== "position") ? ", updated_at = datetime('now')" : "";
  // Finishing stamps completed_at, keeping the stamp only if it was already done and stamped (in SET, `status` is the
  // value before this update); reopening clears it.
  const completion = !changes.status
    ? ""
    : changes.status === "done"
      ? ", completed_at = CASE WHEN status = 'done' AND completed_at IS NOT NULL THEN completed_at ELSE datetime('now') END"
      : ", completed_at = NULL";
  const update = c.env.DB.prepare(`UPDATE tasks SET ${fields.map((f) => `${f} = ?`).join(", ")}${touched}${completion} WHERE id = ?`).bind(
    ...fields.map((f) => encode(f, changes[f])),
    task.id,
  );

  // Compared in stored form; reordering alone is noise in the log, so only real edits are recorded.
  const changed = Object.fromEntries(
    fields.filter((f) => f !== "position" && encode(f, changes[f]) !== task[f]).map((f) => [f, [decode(f, task[f]), changes[f]]]),
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
