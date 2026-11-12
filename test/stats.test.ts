import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, isoDate, TREND_WEEKS, UPCOMING_DAYS, type Stats } from "../src/shared/domain";
import { api, freshDatabase, getJson, loginAs, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

const day = (offset: number) => isoDate(Date.now() + offset * DAY_MS);
const stats = (cookie: string, today = day(0), { mine = false } = {}) =>
  getJson<Stats>(`/api/stats?today=${today}${mine ? "&mine=1" : ""}`, cookie);

describe("dashboard stats", () => {
  it("count the board by status and open work by priority", async () => {
    const s = await stats(await loginAs("member"));
    expect(s.by_status).toEqual({ todo: 4, in_progress: 2, done: 2 });
    expect(s).toMatchObject({ open: 6, done: 2 });
    expect(s.by_priority).toEqual({ high: 3, medium: 2, low: 1 });
  });

  it("count overdue and due-this-week open tasks against the viewer's date", async () => {
    const cookie = await loginAs("manager");
    await api("/api/tasks", { method: "POST", cookie, body: { title: "Late one", due_date: day(-2) } });
    await api("/api/tasks", { method: "POST", cookie, body: { title: "Late but done", due_date: day(-2), status: "done" } });

    const s = await stats(cookie);
    expect(s.overdue).toBe(1);
    // "This week" is today plus 6 days: demo tasks due in 1, 3 and 5 days count; 7 and 10 don't.
    expect(s.due_soon).toBe(3);
    // A viewer whose calendar is 3 days on also sees the task due in 1 day as overdue; the one due that day isn't yet.
    expect((await stats(cookie, day(3))).overdue).toBe(2);
  });

  it("show each person's open work and what of it is overdue, busiest first", async () => {
    const cookie = await loginAs("manager");
    const team = await getJson<{ id: number; name: string }[]>("/api/users", cookie);
    const sam = team.find((u) => u.name === "Sam Cruz")!;
    await api("/api/tasks", { method: "POST", cookie, body: { title: "Late one", due_date: day(-1), assignee_id: sam.id } });

    const { workload } = await stats(cookie);
    expect(workload[0]).toEqual({ id: sam.id, name: "Sam Cruz", open: 3, overdue: 1 });
    expect(workload.find((w) => w.id === null)).toEqual({ id: null, name: "Unassigned", open: 1, overdue: 0 });
    expect(workload.map((w) => w.open)).toEqual([...workload.map((w) => w.open)].sort((a, b) => b - a));
  });

  it("count labels, most used first", async () => {
    const s = await stats(await loginAs("member"));
    expect(s.labels.slice(0, 3)).toEqual([
      { name: "frontend", count: 3 },
      { name: "design", count: 2 },
      { name: "devops", count: 2 },
    ]);
  });

  it("only count the caller's workspace", async () => {
    const s = await stats(sessionCookie(await signUp()));
    expect(s).toMatchObject({ open: 0, done: 0, overdue: 0, due_soon: 0, by_status: { todo: 0, in_progress: 0, done: 0 }, labels: [] });
    expect(s.workload).toEqual([]);
    expect(s.attention).toEqual({ overdue: { tasks: [], total: 0 }, stale: { tasks: [], total: 0 } });
    expect(s.completed.every((w) => w.count === 0)).toBe(true);
    expect(s.upcoming.every((d) => d.count === 0)).toBe(true);
  });

  it("fall back to today in UTC when the date is missing or malformed", async () => {
    const cookie = await loginAs("member");
    const fallback = await getJson<Stats>("/api/stats?today=nonsense", cookie);
    expect(fallback).toEqual(await stats(cookie, isoDate(Date.now())));
  });
});

describe("needs attention", () => {
  it("lists overdue open tasks, most overdue first", async () => {
    const cookie = await loginAs("manager");
    await api("/api/tasks", { method: "POST", cookie, body: { title: "A bit late", due_date: day(-1) } });
    await api("/api/tasks", { method: "POST", cookie, body: { title: "Very late", due_date: day(-5) } });
    await api("/api/tasks", { method: "POST", cookie, body: { title: "Late but done", due_date: day(-5), status: "done" } });
    const { attention } = await stats(cookie);
    expect(attention.overdue.tasks.map((t) => t.title)).toEqual(["Very late", "A bit late"]);
    expect(attention.overdue.tasks[0]).toMatchObject({ due_date: day(-5), assignee: null });
  });

  it("lists open tasks nobody has touched in 14 days", async () => {
    const cookie = await loginAs("manager");
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now', '-15 days') WHERE title IN ('Audit role permissions', 'Customer interview notes')").run();
    const { attention } = await stats(cookie);
    // The done one doesn't need attention.
    expect(attention.stale.tasks.map((t) => t.title)).toEqual(["Audit role permissions"]);
    expect(attention.stale.total).toBe(1);
  });

  it("shows the first 10 of a long list, with how many there are in all", async () => {
    const cookie = await loginAs("manager");
    for (let i = 1; i <= 12; i++) await api("/api/tasks", { method: "POST", cookie, body: { title: `Late ${i}`, due_date: day(-i) } });
    const { attention } = await stats(cookie);
    expect(attention.overdue.tasks).toHaveLength(10);
    expect(attention.overdue.tasks[0]!.title).toBe("Late 12");
    expect(attention.overdue.total).toBe(12);
  });
});

describe("how many need attention", () => {
  it("counts every untouched task, leaving out overdue ones and following 'just me'", async () => {
    const manager = await loginAs("manager");
    const team = await getJson<{ id: number; name: string }[]>("/api/users", manager);
    const sam = team.find((u) => u.name === "Sam Cruz")!;
    for (let i = 1; i <= 12; i++) await api("/api/tasks", { method: "POST", cookie: manager, body: { title: `Old ${i}`, assignee_id: sam.id } });
    await api("/api/tasks", { method: "POST", cookie: manager, body: { title: "Old and late", assignee_id: sam.id, due_date: day(-1) } });
    await env.DB.prepare("UPDATE tasks SET updated_at = datetime('now', '-15 days') WHERE title LIKE 'Old%'").run();

    const { attention } = await stats(manager);
    expect(attention.stale.tasks).toHaveLength(10);
    expect(attention.stale.total).toBe(12); // "Old and late" is in the overdue list instead
    expect(attention.overdue.tasks.map((t) => t.title)).toEqual(["Old and late"]);

    expect((await stats(await loginAs("member"), day(0), { mine: true })).attention.stale.total).toBe(12);
    expect((await stats(manager, day(0), { mine: true })).attention.stale.total).toBe(0);
  });
});

describe("what counts as touching a task", () => {
  const staleTitles = async (cookie: string) => (await stats(cookie)).attention.stale.tasks.map((t) => t.title);

  it("a comment does; dragging it within its column doesn't", async () => {
    const cookie = await loginAs("manager");
    const age = () => env.DB.prepare("UPDATE tasks SET updated_at = datetime('now', '-15 days') WHERE title = 'Audit role permissions'").run();
    const [task] = (await getJson<{ id: number; title: string }[]>("/api/tasks", cookie)).filter((t) => t.title === "Audit role permissions");

    await age();
    await api(`/api/tasks/${task!.id}`, { method: "PATCH", cookie, body: { position: 99 } });
    expect(await staleTitles(cookie)).toContain("Audit role permissions");

    await api(`/api/tasks/${task!.id}/comments`, { method: "POST", cookie, body: { body: "On it" } });
    expect(await staleTitles(cookie)).not.toContain("Audit role permissions");
  });
});

describe("the next 14 days", () => {
  it("counts open tasks due on each day, starting today", async () => {
    const { upcoming } = await stats(await loginAs("member"));
    expect(upcoming).toHaveLength(UPCOMING_DAYS);
    expect(upcoming[0]!.date).toBe(day(0));
    // Demo tasks are due in 1, 3, 5, 7 and 10 days.
    expect(upcoming.filter((d) => d.count > 0).map((d) => d.date)).toEqual([1, 3, 5, 7, 10].map(day));
  });
});

describe("just me", () => {
  it("counts only the viewer's own tasks", async () => {
    const cookie = await loginAs("member"); // Sam: 2 open (Design onboarding flow, empty states), 1 done
    const s = await stats(cookie, day(0), { mine: true });
    expect(s).toMatchObject({ open: 2, done: 1 });
    expect(s.workload.map((w) => w.name)).toEqual(["Sam Cruz"]);
    expect(s.labels.map((l) => l.name)).toEqual(expect.arrayContaining(["design", "frontend", "research"]));
    expect(s.labels.map((l) => l.name)).not.toContain("devops");
  });
});

describe("finished work", () => {
  it("counts tasks finished in each of the last 8 weeks, oldest first", async () => {
    const { completed } = await stats(await loginAs("member"));
    expect(completed).toHaveLength(TREND_WEEKS);
    expect(completed.at(-1)).toMatchObject({ week_start: day(-6) });
    // Demo: "Customer interview notes" finished 2 days ago, "Set up CI pipeline" 9 days ago.
    expect(completed.map((w) => w.count)).toEqual([...Array(TREND_WEEKS - 2).fill(0), 1, 1]);
  });

  it("averages days from created to finished", async () => {
    // Demo: 20 days → done 9 days ago (11 days), 6 days → done 2 days ago (4 days).
    expect((await stats(await loginAs("member"))).avg_days_to_done).toBe(7.5);
  });

  it("stamps a task when it's finished and clears it when it's reopened", async () => {
    const cookie = await loginAs("manager");
    const created = await (await api("/api/tasks", { method: "POST", cookie, body: { title: "Quick fix" } })).json();
    const id = (created as { id: number }).id;
    const thisWeek = async () => (await stats(cookie)).completed.at(-1)!.count;

    await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { status: "done" } });
    expect(await thisWeek()).toBe(2);
    await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { status: "in_progress" } });
    expect(await thisWeek()).toBe(1);
  });

  it("stamps a fresh date when a task reopened elsewhere is finished again", async () => {
    const cookie = await loginAs("manager");
    // Reopened the way the previous release would during a deploy: status changed, old stamp left behind.
    await env.DB.prepare("UPDATE tasks SET status = 'todo', completed_at = datetime('now', '-30 days') WHERE title = 'Customer interview notes'").run();
    const [task] = (await getJson<{ id: number; title: string }[]>("/api/tasks", cookie)).filter((t) => t.title === "Customer interview notes");

    await api(`/api/tasks/${task!.id}`, { method: "PATCH", cookie, body: { status: "done" } });
    expect((await stats(cookie)).completed.at(-1)!.count).toBe(1);
  });

  it("follows the just-me filter", async () => {
    // Sam finished the interview notes; the CI pipeline was Alex's.
    const { completed, avg_days_to_done } = await stats(await loginAs("member"), day(0), { mine: true });
    expect(completed.map((w) => w.count).slice(-2)).toEqual([0, 1]);
    expect(avg_days_to_done).toBe(4);
  });

  it("has no average when nothing is finished", async () => {
    expect((await stats(sessionCookie(await signUp()))).avg_days_to_done).toBeNull();
  });
});
