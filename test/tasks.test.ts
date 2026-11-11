import { beforeEach, describe, expect, it } from "vitest";
import { MAX_LABEL_LENGTH, MAX_LABELS } from "../src/shared/domain";
import { api, freshDatabase, getJson, loginAs, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

type Task = { id: number; title: string; status: string; priority: string; assignee: { id: number; name: string } | null };

async function listTasks(cookie: string, query = "") {
  const res = await api(`/api/tasks${query}`, { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Task[];
}

describe("the board", () => {
  it("shows every task with its assignee, in board order", async () => {
    const tasks = await listTasks(await loginAs("member"));
    expect(tasks).toHaveLength(8);
    expect(tasks[0]).toMatchObject({
      title: "Set up CI pipeline for the API",
      status: "done",
      assignee: { id: 1, name: "Alex Rivera" },
    });
    expect(tasks.find((t) => t.title === "Update dependency versions")?.assignee).toBeNull();
  });

  it("lets any role add a task", async () => {
    const cookie = await loginAs("member");
    const res = await api("/api/tasks", {
      method: "POST",
      cookie,
      body: { title: "Draft Q3 roadmap", priority: "high", due_date: "2026-12-01" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ title: "Draft Q3 roadmap", status: "todo", priority: "high", due_date: "2026-12-01" });
    expect((await listTasks(cookie)).map((t) => t.title)).toContain("Draft Q3 roadmap");
  });

  it("rejects a task without a title", async () => {
    const res = await api("/api/tasks", { method: "POST", cookie: await loginAs("member"), body: { title: "  " } });
    expect(res.status).toBe(400);
  });
});

async function taskId(cookie: string, title: string) {
  const task = (await listTasks(cookie)).find((t) => t.title === title);
  if (!task) throw new Error(`no task "${title}"`);
  return task.id;
}

describe("editing tasks", () => {
  it("lets a member update a task assigned to them", async () => {
    const cookie = await loginAs("member");
    const id = await taskId(cookie, "Design onboarding flow");
    const res = await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { status: "done", title: "Design onboarding v2" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "done", title: "Design onboarding v2" });
  });

  it("stops a member editing someone else's task", async () => {
    const cookie = await loginAs("member");
    const id = await taskId(cookie, "Fix timezone bug on due dates");
    const res = await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { status: "done" } });
    expect(res.status).toBe(403);
  });

  it("stops a member reassigning, even on their own task", async () => {
    const cookie = await loginAs("member");
    const id = await taskId(cookie, "Add empty states to the board");
    const res = await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { assignee_id: 4 } });
    expect(res.status).toBe(403);
  });

  it("lets a member unassign their own task", async () => {
    const cookie = await loginAs("member");
    const id = await taskId(cookie, "Add empty states to the board");
    const res = await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { assignee_id: null } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ assignee: null });
  });

  it("lets a manager edit and reassign any task", async () => {
    const cookie = await loginAs("manager");
    const id = await taskId(cookie, "Fix timezone bug on due dates");
    const res = await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { assignee_id: 3, priority: "low" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ priority: "low", assignee: { id: 3, name: "Sam Cruz" } });
  });

  it("rejects assigning to someone who isn't on the team", async () => {
    const cookie = await loginAs("manager");
    const id = await taskId(cookie, "Fix timezone bug on due dates");
    expect((await api(`/api/tasks/${id}`, { method: "PATCH", cookie, body: { assignee_id: 999 } })).status).toBe(400);
  });

  it("returns 404 for a task that doesn't exist", async () => {
    const res = await api("/api/tasks/999", { method: "PATCH", cookie: await loginAs("admin"), body: { status: "done" } });
    expect(res.status).toBe(404);
  });
});

describe("deleting tasks", () => {
  it("is for managers and admins only", async () => {
    const member = await loginAs("member");
    const id = await taskId(member, "Add empty states to the board");
    expect((await api(`/api/tasks/${id}`, { method: "DELETE", cookie: member })).status).toBe(403);

    const manager = await loginAs("manager");
    expect((await api(`/api/tasks/${id}`, { method: "DELETE", cookie: manager })).status).toBe(204);
    expect((await listTasks(manager)).map((t) => t.id)).not.toContain(id);
  });
});

describe("assigning new tasks", () => {
  it("lets a member assign a new task only to themselves", async () => {
    const cookie = await loginAs("member");
    const toSelf = await api("/api/tasks", { method: "POST", cookie, body: { title: "Mine", assignee_id: 3 } });
    const toOther = await api("/api/tasks", { method: "POST", cookie, body: { title: "Yours", assignee_id: 4 } });
    expect(toSelf.status).toBe(201);
    expect(toOther.status).toBe(403);
  });
});

describe("search and filters", () => {
  it("finds tasks by words in the title", async () => {
    const tasks = await listTasks(await loginAs("member"), "?q=bug");
    expect(tasks.map((t) => t.title)).toEqual(["Fix timezone bug on due dates"]);
  });

  it("filters by assignee and priority together", async () => {
    const tasks = await listTasks(await loginAs("member"), "?assignee=3&priority=high");
    expect(tasks.map((t) => t.title)).toEqual(["Design onboarding flow"]);
  });

  it("filters to unassigned tasks", async () => {
    const tasks = await listTasks(await loginAs("member"), "?assignee=none");
    expect(tasks.map((t) => t.title)).toEqual(["Update dependency versions"]);
  });

  it("treats search text literally, not as a pattern", async () => {
    expect(await listTasks(await loginAs("member"), "?q=%25")).toEqual([]);
  });
});

describe("labels", () => {
  type Labelled = Task & { labels: string[] };

  async function create(cookie: string, title: string, labels: string[]) {
    const res = await api("/api/tasks", { method: "POST", cookie, body: { title, labels } });
    expect(res.status).toBe(201);
    return (await res.json()) as Labelled;
  }

  it("tidies labels: trimmed, lowercase, no repeats", async () => {
    const task = await create(await loginAs("manager"), "Fix login", [" Bug ", "bug", "Frontend"]);
    expect(task.labels).toEqual(["bug", "frontend"]);
  });

  it("can be changed, and the change is logged", async () => {
    const cookie = await loginAs("manager");
    const task = await create(cookie, "Fix login", ["bug"]);
    const res = await api(`/api/tasks/${task.id}`, { method: "PATCH", cookie, body: { labels: ["bug", "urgent"] } });
    expect(await res.json()).toMatchObject({ labels: ["bug", "urgent"] });
    const [latest] = await getJson<{ action: string; detail: { changes: object } }[]>("/api/activity", cookie);
    expect(latest).toMatchObject({ action: "task.updated", detail: { changes: { labels: [["bug"], ["bug", "urgent"]] } } });
  });

  it("filter the board", async () => {
    const cookie = await loginAs("manager");
    await create(cookie, "Fix invoices", ["billing"]);
    await create(cookie, "Write docs", ["docs"]);
    expect((await listTasks(cookie, "?label=Billing")).map((t) => t.title)).toEqual(["Fix invoices"]);
  });

  it("are listed per workspace, for the filter", async () => {
    const cookie = await loginAs("manager");
    await create(cookie, "Fix login", ["bug", "auth"]);
    const ana = sessionCookie(await signUp());
    await create(ana, "Ana's task", ["secret"]);
    const labels = await getJson<string[]>("/api/tasks/labels", cookie);
    expect(labels).toEqual(expect.arrayContaining(["auth", "bug"]));
    expect(labels).not.toContain("secret");
    expect(labels).toEqual([...labels].sort());
  });

  it("are limited in number and length", async () => {
    const cookie = await loginAs("manager");
    const tooMany = Array.from({ length: MAX_LABELS + 1 }, (_, i) => `l${i}`);
    expect((await api("/api/tasks", { method: "POST", cookie, body: { title: "x", labels: tooMany } })).status).toBe(400);
    expect((await api("/api/tasks", { method: "POST", cookie, body: { title: "x", labels: ["a".repeat(MAX_LABEL_LENGTH + 1)] } })).status).toBe(400);
  });
});

describe("the change log", () => {
  it("records a reassignment from the old assignee to the new one", async () => {
    const cookie = await loginAs("manager");
    const [task] = await listTasks(cookie);
    const team = await getJson<{ id: number }[]>("/api/users", cookie);
    const next = team.find((u) => u.id !== task!.assignee?.id)!.id;
    await api(`/api/tasks/${task!.id}`, { method: "PATCH", cookie, body: { assignee_id: next } });
    const [latest] = await getJson<{ detail: { changes: object } }[]>("/api/activity", cookie);
    expect(latest!.detail.changes).toEqual({ assignee_id: [task!.assignee?.id ?? null, next] });
  });
});
