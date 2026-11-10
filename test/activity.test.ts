import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDatabase, loginAs, riley } from "./helpers";

beforeEach(freshDatabase);

type Entry = { action: string; actor: { name: string }; task_id: number | null; detail: Record<string, unknown> };

async function activity(cookie: string) {
  const res = await api("/api/activity", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Entry[];
}

describe("activity log", () => {
  it("is visible to managers and admins only", async () => {
    expect((await api("/api/activity", { cookie: await loginAs("member") })).status).toBe(403);
    expect((await api("/api/activity", { cookie: await loginAs("manager") })).status).toBe(200);
  });

  it("starts empty after the nightly reset", async () => {
    expect(await activity(await loginAs("admin"))).toEqual([]);
  });

  it("records who did what, newest first", async () => {
    const member = await loginAs("member");
    const created = (await (await api("/api/tasks", { method: "POST", cookie: member, body: { title: "Write tests" } })).json()) as { id: number };
    await api(`/api/tasks/${created.id}`, { method: "PATCH", cookie: member, body: { status: "in_progress" } });
    await api(`/api/tasks/${created.id}/comments`, { method: "POST", cookie: member, body: { body: "On it" } });
    const manager = await loginAs("manager");
    await api(`/api/tasks/${created.id}`, { method: "DELETE", cookie: manager });

    expect(await activity(manager)).toMatchObject([
      { action: "task.deleted", actor: { name: "Morgan Lee" }, task_id: created.id, detail: { title: "Write tests" } },
      { action: "comment.added", actor: { name: "Sam Cruz" }, detail: { title: "Write tests" } },
      { action: "task.updated", actor: { name: "Sam Cruz" }, detail: { title: "Write tests", changes: { status: ["todo", "in_progress"] } } },
      { action: "task.created", actor: { name: "Sam Cruz" }, detail: { title: "Write tests" } },
    ]);
  });

  it("doesn't log reordering within a column as a change", async () => {
    const manager = await loginAs("manager");
    await api("/api/tasks/1", { method: "PATCH", cookie: manager, body: { position: 0.5 } });
    expect(await activity(manager)).toEqual([]);
  });

  it("records role changes", async () => {
    const admin = await loginAs("admin");
    const created = (await (
      await api("/api/users", { method: "POST", cookie: admin, body: riley })
    ).json()) as { id: number };
    await api(`/api/users/${created.id}`, { method: "PATCH", cookie: admin, body: { role: "manager" } });
    expect(await activity(admin)).toMatchObject([
      { action: "user.role_changed", actor: { name: "Alex Rivera" }, task_id: null, detail: { title: "Riley Park", changes: { role: ["member", "manager"] } } },
    ]);
  });
});
