import { Hono } from "hono";
import { z } from "zod";
import { DAY_MS, DUE_SOON_WINDOW_DAYS, isoDate, OPEN_STATUSES, PRIORITIES, STALE_DAYS, STATUSES, UPCOMING_DAYS, type Stats } from "../shared/domain";
import { assigneeOf } from "./tasks";
import type { AppEnv } from "./http";

const TOP_LABELS = 8;
const ATTENTION_LIMIT = 10;
// Statuses are inlined: they're constants, not input.
const IS_OPEN = `t.status IN (${OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`;

type KeyCount = { key: string; n: number };
type Workload = Stats["workload"][number];
type LabelCount = Stats["labels"][number];
type AttentionRow = { id: number; title: string; due_date: string | null; assignee_id: number | null; assignee_name: string | null };

/** Counts for the dashboard: `/api/stats?today=YYYY-MM-DD[&mine=1]`. */
export const stats = new Hono<AppEnv>();

/** One number per key, zero for keys with no rows. */
const countsFor = <K extends string>(keys: readonly K[], rows: KeyCount[]) =>
  Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.key === k)?.n ?? 0])) as Record<K, number>;

const toAttentionTask = ({ assignee_id, assignee_name, ...rest }: AttentionRow) => ({ ...rest, assignee: assigneeOf(assignee_id, assignee_name) });

stats.get("/", async (c) => {
  const db = c.env.DB;
  const me = c.var.user;
  // Due dates are calendar days, so "overdue" depends on the viewer's date; UTC if they don't send a valid one.
  const param = c.req.query("today");
  const today = z.iso.date().safeParse(param).success ? param! : isoDate(Date.now());
  const plusDays = (n: number) => isoDate(Date.parse(today) + n * DAY_MS);

  // Every query is scoped to the workspace, and to the viewer's own tasks for "Just me". Numbered
  // parameters: ?1-?3 are always the scope, so each query binds them first and its own values after.
  const mine = c.req.query("mine") === "1";
  const SCOPE = "t.workspace_id = ?1 AND (?2 = 0 OR t.assignee_id = ?3)";
  const scope = [me.workspace_id, mine ? 1 : 0, me.id];
  const OPEN = `${SCOPE} AND ${IS_OPEN}`;
  const ATTENTION = `SELECT t.id, t.title, t.due_date, t.assignee_id, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE ${OPEN}`;

  const [byStatus, byPriority, deadlines, workload, labels, overdue, stale, upcoming] = await db.batch([
    db.prepare(`SELECT status AS key, COUNT(*) AS n FROM tasks t WHERE ${SCOPE} GROUP BY status`).bind(...scope),
    db.prepare(`SELECT priority AS key, COUNT(*) AS n FROM tasks t WHERE ${OPEN} GROUP BY priority`).bind(...scope),
    db
      .prepare(
        `SELECT COUNT(CASE WHEN due_date < ?4 THEN 1 END) AS overdue, COUNT(CASE WHEN due_date >= ?4 AND due_date < ?5 THEN 1 END) AS due_soon
         FROM tasks t WHERE ${OPEN}`,
      )
      .bind(...scope, today, plusDays(DUE_SOON_WINDOW_DAYS)),
    db
      .prepare(
        `SELECT t.assignee_id AS id, COALESCE(u.name, 'Unassigned') AS name, COUNT(*) AS open, COUNT(CASE WHEN t.due_date < ?4 THEN 1 END) AS overdue
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE ${OPEN}
         GROUP BY t.assignee_id ORDER BY open DESC, overdue DESC, name`,
      )
      .bind(...scope, today),
    db
      .prepare(
        `SELECT j.value AS name, COUNT(*) AS count FROM tasks t, json_each(t.labels) j WHERE ${SCOPE}
         GROUP BY j.value ORDER BY count DESC, name LIMIT ?4`,
      )
      .bind(...scope, TOP_LABELS),
    db.prepare(`${ATTENTION} AND t.due_date < ?4 ORDER BY t.due_date, t.id LIMIT ?5`).bind(...scope, today, ATTENTION_LIMIT),
    // Untouched for a while but not already in the overdue list.
    db
      .prepare(
        `${ATTENTION} AND t.updated_at < datetime('now', ?4) AND (t.due_date IS NULL OR t.due_date >= ?5) ORDER BY t.updated_at, t.id LIMIT ?6`,
      )
      .bind(...scope, `-${STALE_DAYS} days`, today, ATTENTION_LIMIT),
    db
      .prepare(`SELECT due_date AS key, COUNT(*) AS n FROM tasks t WHERE ${OPEN} AND due_date >= ?4 AND due_date < ?5 GROUP BY due_date`)
      .bind(...scope, today, plusDays(UPCOMING_DAYS)),
  ]);

  const by_status = countsFor(STATUSES, byStatus!.results as KeyCount[]);
  const dueOn = new Map((upcoming!.results as KeyCount[]).map((r) => [r.key, r.n]));
  const body: Stats = {
    open: OPEN_STATUSES.reduce((sum, s) => sum + by_status[s], 0),
    done: by_status.done,
    ...(deadlines!.results[0] as Pick<Stats, "overdue" | "due_soon">),
    by_status,
    by_priority: countsFor(PRIORITIES, byPriority!.results as KeyCount[]),
    workload: workload!.results as Workload[],
    labels: labels!.results as LabelCount[],
    attention: {
      overdue: (overdue!.results as AttentionRow[]).map(toAttentionTask),
      stale: (stale!.results as AttentionRow[]).map(toAttentionTask),
    },
    upcoming: Array.from({ length: UPCOMING_DAYS }, (_, i) => plusDays(i)).map((date) => ({ date, count: dueOn.get(date) ?? 0 })),
  };
  return c.json(body);
});
