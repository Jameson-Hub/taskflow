// Weekly summaries: the nightly run at 00:00 UTC on Mondays queues one message per active workspace, and the queue
// consumer writes that workspace's week in numbers. Queued so the nightly job stays quick however many there are.
import { DAY_MS, isoDate, type WeeklySummary } from "../shared/domain";
import { DEMO_WORKSPACE } from "./seed";

export type WeeklyJob = { workspace_id: number; week_end: string };

const SEND_BATCH_MAX = 100; // Queues' limit per sendBatch

const weekStartOf = (weekEnd: string) => isoDate(Date.parse(weekEnd) - 7 * DAY_MS);

/** Weekly summaries go out on the run that starts a Monday (UTC). */
export const isMonday = (ms: number) => new Date(ms).getUTCDay() === 1;

/** Queues a summary for every workspace with activity in the week ending `week_end`. The demo resets nightly, so it's left out. */
export async function queueWeeklySummaries(env: Env, week_end: string) {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT workspace_id FROM activity WHERE created_at >= ? AND created_at < ? AND workspace_id != ? ORDER BY workspace_id",
  )
    .bind(weekStartOf(week_end), week_end, DEMO_WORKSPACE)
    .all<{ workspace_id: number }>();
  for (let i = 0; i < results.length; i += SEND_BATCH_MAX) {
    await env.WEEKLY.sendBatch(results.slice(i, i + SEND_BATCH_MAX).map(({ workspace_id }) => ({ body: { workspace_id, week_end } })));
  }
}

/** Counts one workspace's week and stores it, once, in one statement. Timestamps are UTC text, so they compare with dates as strings. */
function writeWeeklySummary(db: D1Database, { workspace_id, week_end }: WeeklyJob) {
  return db
    .prepare(
      `WITH week AS (SELECT action, user_id FROM activity WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3),
            top AS (SELECT u.name, COUNT(*) AS changes FROM week w JOIN users u ON u.id = w.user_id
                    GROUP BY w.user_id ORDER BY changes DESC, u.name LIMIT 1)
       INSERT OR IGNORE INTO weekly_summaries (workspace_id, week_end, created, finished, comments, busiest_name, busiest_changes)
       SELECT ?1, ?3,
              (SELECT COUNT(CASE WHEN action = 'task.created' THEN 1 END) FROM week),
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = ?1 AND status = 'done' AND completed_at >= ?2 AND completed_at < ?3),
              (SELECT COUNT(CASE WHEN action = 'comment.added' THEN 1 END) FROM week),
              (SELECT name FROM top),
              (SELECT changes FROM top)
       FROM workspaces WHERE id = ?1`, // a workspace deleted since it was queued writes nothing, so it isn't retried
    )
    .bind(workspace_id, weekStartOf(week_end), week_end)
    .run();
}

/** The queue consumer. A message that fails is retried (up to max_retries in wrangler.jsonc); the rest are acknowledged. */
export async function consumeWeekly(batch: MessageBatch<WeeklyJob>, env: Env) {
  await Promise.all(
    batch.messages.map((message) =>
      writeWeeklySummary(env.DB, message.body).then(
        () => message.ack(),
        () => message.retry(),
      ),
    ),
  );
}

type SummaryRow = Omit<WeeklySummary, "week_start" | "busiest"> & { busiest_name: string | null; busiest_changes: number | null };

/** The last few weeks, newest first. */
export async function recentSummaries(db: D1Database, workspaceId: number): Promise<WeeklySummary[]> {
  const { results } = await db
    .prepare(
      "SELECT week_end, created, finished, comments, busiest_name, busiest_changes FROM weekly_summaries WHERE workspace_id = ? ORDER BY week_end DESC LIMIT 4",
    )
    .bind(workspaceId)
    .all<SummaryRow>();
  return results.map(({ busiest_name, busiest_changes, ...week }) => ({
    week_start: weekStartOf(week.week_end),
    ...week,
    busiest: busiest_name === null ? null : { name: busiest_name, changes: busiest_changes ?? 0 },
  }));
}
