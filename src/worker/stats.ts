import { Hono } from "hono";
import { z } from "zod";
import { DAY_MS, DUE_SOON_WINDOW_DAYS, isoDate, OPEN_STATUSES, PRIORITIES, STATUSES, type Stats } from "../shared/domain";
import type { AppEnv } from "./http";

const TOP_LABELS = 8;
// Bind the workspace id wherever this appears. Statuses are inlined: they're constants, not input.
const OPEN = `t.workspace_id = ? AND t.status IN (${OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`;

type KeyCount = { key: string; n: number };
type Workload = Stats["workload"][number];
type LabelCount = Stats["labels"][number];

/** Counts for the dashboard: `/api/stats?today=YYYY-MM-DD`. */
export const stats = new Hono<AppEnv>();

/** One number per key, zero for keys with no rows. */
const countsFor = <K extends string>(keys: readonly K[], rows: KeyCount[]) =>
  Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.key === k)?.n ?? 0])) as Record<K, number>;

stats.get("/", async (c) => {
  const db = c.env.DB;
  const ws = c.var.user.workspace_id;
  // Due dates are calendar days, so "overdue" depends on the viewer's date; UTC if they don't send a valid one.
  const param = c.req.query("today");
  const today = z.iso.date().safeParse(param).success ? param! : isoDate(Date.now());
  const soonEnd = isoDate(Date.parse(today) + DUE_SOON_WINDOW_DAYS * DAY_MS); // exclusive

  const [byStatus, byPriority, deadlines, workload, labels] = await db.batch([
    db.prepare("SELECT status AS key, COUNT(*) AS n FROM tasks t WHERE t.workspace_id = ? GROUP BY status").bind(ws),
    db.prepare(`SELECT priority AS key, COUNT(*) AS n FROM tasks t WHERE ${OPEN} GROUP BY priority`).bind(ws),
    db
      .prepare(
        `SELECT COUNT(CASE WHEN due_date < ? THEN 1 END) AS overdue, COUNT(CASE WHEN due_date >= ? AND due_date < ? THEN 1 END) AS due_soon
         FROM tasks t WHERE ${OPEN}`,
      )
      .bind(today, today, soonEnd, ws),
    db
      .prepare(
        `SELECT t.assignee_id AS id, COALESCE(u.name, 'Unassigned') AS name, COUNT(*) AS open, COUNT(CASE WHEN t.due_date < ? THEN 1 END) AS overdue
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE ${OPEN}
         GROUP BY t.assignee_id ORDER BY open DESC, overdue DESC, name`,
      )
      .bind(today, ws),
    db
      .prepare(
        `SELECT j.value AS name, COUNT(*) AS count FROM tasks t, json_each(t.labels) j WHERE t.workspace_id = ?
         GROUP BY j.value ORDER BY count DESC, name LIMIT ?`,
      )
      .bind(ws, TOP_LABELS),
  ]);

  const by_status = countsFor(STATUSES, byStatus!.results as KeyCount[]);
  const body: Stats = {
    open: OPEN_STATUSES.reduce((sum, s) => sum + by_status[s], 0),
    done: by_status.done,
    ...(deadlines!.results[0] as Pick<Stats, "overdue" | "due_soon">),
    by_status,
    by_priority: countsFor(PRIORITIES, byPriority!.results as KeyCount[]),
    workload: workload!.results as Workload[],
    labels: labels!.results as LabelCount[],
  };
  return c.json(body);
});
