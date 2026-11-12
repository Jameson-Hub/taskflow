import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, isoDate } from "../src/shared/domain";
import worker from "../src/worker";
import type { WeeklyJob } from "../src/worker/weekly";
import { ana, api, freshDatabase, getJson, loginAs, runNightlyJob, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

/** The coming Monday, 00:00 UTC: the end of the week that includes today. */
function nextMonday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  return d.getTime();
}

/** Hands jobs to the queue consumer the way Cloudflare would, and reports what it acknowledged. */
async function consume(jobs: WeeklyJob[]) {
  const batch = createMessageBatch<WeeklyJob>(
    "taskflow-weekly",
    jobs.map((body, i) => ({ id: String(i), timestamp: new Date(), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue!(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

async function anaWithAWeek() {
  const cookie = sessionCookie(await signUp());
  const a = (await (await api("/api/tasks", { method: "POST", cookie, body: { title: "Plan" } })).json()) as { id: number };
  await api("/api/tasks", { method: "POST", cookie, body: { title: "Build" } });
  await api(`/api/tasks/${a.id}`, { method: "PATCH", cookie, body: { status: "done" } });
  await api(`/api/tasks/${a.id}/comments`, { method: "POST", cookie, body: { body: "Done and dusted" } });
  const { workspace_id } = (await env.DB.prepare("SELECT workspace_id FROM users WHERE email = ?").bind(ana.email).first<{ workspace_id: number }>())!;
  return { cookie, workspaceId: workspace_id };
}

describe("weekly summaries", () => {
  it("are queued at 00:00 UTC on Mondays for each workspace that did something that week, but not the demo", async () => {
    const { workspaceId } = await anaWithAWeek();
    await signUp({ email: "quiet@example.com", workspace: "Quiet" }); // nothing done
    await api("/api/tasks", { method: "POST", cookie: await loginAs("manager"), body: { title: "Demo work" } });
    const sent = vi.spyOn(env.WEEKLY, "sendBatch");

    const monday = nextMonday();
    await runNightlyJob(monday);
    expect(sent).toHaveBeenCalledWith([{ body: { workspace_id: workspaceId, week_end: isoDate(monday) } }]);
  });

  it("aren't queued on other days", async () => {
    await anaWithAWeek();
    const sent = vi.spyOn(env.WEEKLY, "sendBatch");
    await runNightlyJob(nextMonday() + DAY_MS);
    expect(sent).not.toHaveBeenCalled();
  });

  it("count the week's new tasks, finished tasks and comments, and who did the most", async () => {
    const { cookie, workspaceId } = await anaWithAWeek();
    const weekEnd = isoDate(nextMonday());
    const result = await consume([{ workspace_id: workspaceId, week_end: weekEnd }]);
    expect(result.explicitAcks).toEqual(["0"]);

    expect(await getJson("/api/activity/weekly", cookie)).toEqual([
      {
        week_start: isoDate(nextMonday() - 7 * DAY_MS),
        week_end: weekEnd,
        created: 2,
        finished: 1,
        comments: 1,
        busiest: { name: "Ana Reyes", changes: 4 },
      },
    ]);
  });

  it("are written once, even if the message is delivered twice", async () => {
    const { cookie, workspaceId } = await anaWithAWeek();
    const job = { workspace_id: workspaceId, week_end: isoDate(nextMonday()) };
    await consume([job]);
    // Taken as done, not retried.
    expect((await consume([job])).explicitAcks).toEqual(["0"]);
    expect(await getJson<unknown[]>("/api/activity/weekly", cookie)).toHaveLength(1);
  });

  it("are skipped, not retried, for a workspace deleted since it was queued", async () => {
    const result = await consume([{ workspace_id: 999, week_end: isoDate(nextMonday()) }]);
    expect(result.explicitAcks).toEqual(["0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("are in the demo too, seeded by the nightly reset so visitors can see one", async () => {
    await runNightlyJob(nextMonday() + DAY_MS);
    const weeks = await getJson<{ week_end: string; busiest: unknown }[]>("/api/activity/weekly", await loginAs("manager"));
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.busiest).not.toBeNull();
  });

  it("are for leads, like the rest of the activity log", async () => {
    expect((await api("/api/activity/weekly", { cookie: await loginAs("member") })).status).toBe(403);
  });
});
