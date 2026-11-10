import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, emptyDatabase, freshDatabase, getJson, loginWithPassword, loginAs, runNightlyReset, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

const DEMO_TASK = 1;

async function anaWithTask() {
  const anaCookie = sessionCookie(await signUp());
  const task = (await (await api("/api/tasks", { method: "POST", cookie: anaCookie, body: { title: "Ana's private task" } })).json()) as { id: number };
  return { anaCookie, taskId: task.id };
}

describe("workspace isolation", () => {
  it("never shows one workspace's tasks, people or activity to another", async () => {
    const { anaCookie } = await anaWithTask();
    const demo = await loginAs("admin");

    const titles = async (cookie: string) => (await getJson<{ title: string }[]>("/api/tasks", cookie)).map((t) => t.title);
    expect(await titles(demo)).not.toContain("Ana's private task");
    expect(await titles(anaCookie)).toEqual(["Ana's private task"]);
    expect((await getJson<{ email: string }[]>("/api/users", demo)).map((u) => u.email)).not.toContain("ana@example.com");
    expect(await getJson("/api/activity", demo)).toEqual([]);
  });

  it("treats another workspace's task as not found, for every action", async () => {
    const { anaCookie } = await anaWithTask();
    await api(`/api/tasks/${DEMO_TASK}/comments`, { method: "POST", cookie: await loginAs("member"), body: { body: "demo-only note" } });
    expect((await api(`/api/tasks/${DEMO_TASK}`, { method: "PATCH", cookie: anaCookie, body: { title: "hijacked" } })).status).toBe(404);
    expect((await api(`/api/tasks/${DEMO_TASK}`, { method: "DELETE", cookie: anaCookie })).status).toBe(404);
    expect((await api(`/api/tasks/${DEMO_TASK}/comments`, { method: "POST", cookie: anaCookie, body: { body: "hi" } })).status).toBe(404);
    expect((await api(`/api/tasks/${DEMO_TASK}/comments`, { cookie: anaCookie })).status).toBe(404);
  });

  it("can't assign a task to someone in another workspace", async () => {
    const { anaCookie } = await anaWithTask();
    const res = await api("/api/tasks", { method: "POST", cookie: anaCookie, body: { title: "x", assignee_id: 1 } });
    expect(res.status).toBe(400);
    const demo = await loginAs("manager");
    const anaId = (await getJson<{ id: number }>("/api/me", anaCookie)).id;
    expect((await api(`/api/tasks/${DEMO_TASK}`, { method: "PATCH", cookie: demo, body: { assignee_id: anaId } })).status).toBe(400);
  });

  it("can't change the role of someone in another workspace", async () => {
    const anaCookie = sessionCookie(await signUp());
    expect((await api("/api/users/3", { method: "PATCH", cookie: anaCookie, body: { role: "admin" } })).status).toBe(404);
  });

  it("puts people an admin adds into the admin's own workspace", async () => {
    const anaCookie = sessionCookie(await signUp());
    await api("/api/users", {
      method: "POST",
      cookie: anaCookie,
      body: { email: "ben@example.com", name: "Ben Ong", role: "member", password: "another long password" },
    });
    expect((await getJson<{ email: string }[]>("/api/users", anaCookie)).map((u) => u.email)).toEqual(["ana@example.com", "ben@example.com"]);
  });
});

describe("nightly job", () => {
  it("resets the demo but keeps real workspaces and their sessions", async () => {
    const { anaCookie } = await anaWithTask();
    await runNightlyReset();
    expect((await api("/api/me", { cookie: anaCookie })).status).toBe(200);
    expect(await getJson("/api/tasks", anaCookie)).toMatchObject([{ title: "Ana's private task" }]);
  });

  it("deletes workspaces nobody has used for 30 days, and only those", async () => {
    const { anaCookie, taskId } = await anaWithTask();
    await api(`/api/tasks/${taskId}/comments`, { method: "POST", cookie: anaCookie, body: { body: "note" } });
    const active = sessionCookie(await signUp({ email: "active@example.com", name: "Still Here", workspace: "Busy team" }));
    await api("/api/tasks", { method: "POST", cookie: active, body: { title: "Busy task" } });
    await env.DB.prepare("UPDATE users SET last_seen_at = '2020-01-01T00:00:00.000Z', created_at = '2020-01-01 00:00:00' WHERE email = ?")
      .bind("ana@example.com")
      .run();

    await runNightlyReset();

    expect((await loginWithPassword()).status).toBe(401);
    expect((await loginWithPassword("active@example.com")).status).toBe(200);
    const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;
    // Ana's workspace is gone without a trace.
    expect(await count("SELECT COUNT(*) AS n FROM tasks WHERE title = 'Ana''s private task'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM comments")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM workspaces WHERE name = 'Ana''s Studio'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'ana@example.com'")).toBe(0);
    // The active workspace and the demo are untouched.
    expect(await getJson("/api/tasks", active)).toMatchObject([{ title: "Busy task" }]);
    expect(await count("SELECT COUNT(*) AS n FROM activity WHERE detail LIKE '%Busy task%'")).toBe(1);
    expect((await getJson<unknown[]>("/api/tasks", await loginAs("member"))).length).toBe(8);
  });
});

describe("fresh database", () => {
  it("still restores the demo when someone signs up before anyone opens it", async () => {
    await emptyDatabase();
    expect((await signUp()).status).toBe(201);
    await runNightlyReset();
    expect((await api("/api/auth/demo", { method: "POST", body: { role: "admin" } })).status).toBe(200);
    expect((await loginWithPassword()).status).toBe(200);
  });

  it("puts rows written without a workspace (by the previous release, mid-deploy) into the demo", async () => {
    await env.DB.prepare("INSERT INTO tasks (title, created_by, workspace_id) VALUES ('Orphan from old code', 1, NULL)").run();
    const orphans = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE workspace_id IS NULL").first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });
});

describe("rate limiting", () => {
  // Ten attempts a minute get their normal answer; the eleventh is refused.
  it.each([
    ["sign-ups", (i: number) => signUp({ email: `bot${i}@example.com` }, "203.0.113.10"), 201],
    ["logins", () => loginWithPassword("x@example.com", "nope", "203.0.113.9"), 401],
  ] as const)("blocks rapid repeated %s from one address", async (_, attempt, normal) => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt(i)).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(normal));
    expect(statuses[10]).toBe(429);
  });
});
