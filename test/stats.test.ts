import { beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, isoDate, type Stats } from "../src/shared/domain";
import { api, freshDatabase, getJson, loginAs, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

const day = (offset: number) => isoDate(Date.now() + offset * DAY_MS);
const stats = (cookie: string, today = day(0)) => getJson<Stats>(`/api/stats?today=${today}`, cookie);

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
  });

  it("fall back to today in UTC when the date is missing or malformed", async () => {
    const cookie = await loginAs("member");
    const fallback = await getJson<Stats>("/api/stats?today=nonsense", cookie);
    expect(fallback).toEqual(await stats(cookie, isoDate(Date.now())));
  });
});
