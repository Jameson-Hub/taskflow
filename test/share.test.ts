import { beforeEach, describe, expect, it } from "vitest";
import { addTeammate, ana, api, freshDatabase, getJson, loginAs, riley, runNightlyReset, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

type SharedBoard = { workspace: string; tasks: Record<string, unknown>[] };

async function createLink(cookie: string) {
  const res = await api("/api/share", { method: "POST", cookie });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

// Like invites, the token travels in the body so it stays out of request logs. No cookie: anyone with the link.
const openLink = (token: string) => api("/api/shared", { method: "POST", body: { token } });

describe("read-only share link", () => {
  it("shows anyone with the link the board, without signing in", async () => {
    const token = await createLink(await loginAs("admin"));
    const res = await openLink(token);
    expect(res.status).toBe(200);
    const board = (await res.json()) as SharedBoard;
    expect(board.workspace).toBe("Demo workspace");
    expect(board.tasks).toHaveLength(8);
    expect(board.tasks).toContainEqual(
      expect.objectContaining({ title: "Design onboarding flow", status: "in_progress", priority: "high", assignee: expect.objectContaining({ name: "Sam Cruz" }), labels: ["design", "frontend"] }),
    );
  });

  it("leaves out descriptions, comments, emails and checklist text; only what's ticked shows", async () => {
    const token = await createLink(await loginAs("admin"));
    const { tasks } = (await (await openLink(token)).json()) as SharedBoard;
    const keys = new Set(tasks.flatMap((t) => Object.keys(t)));
    expect([...keys].sort()).toEqual(["assignee", "checklist", "due_date", "id", "labels", "position", "priority", "status", "title"]);
    expect(tasks.find((t) => t.title === "Design onboarding flow")!.checklist).toEqual([{ done: true }, { done: false }, { done: false }]);
    expect(JSON.stringify(tasks)).not.toMatch(/@/);
  });

  it("only shows the workspace it was made for", async () => {
    const token = await createLink(sessionCookie(await signUp()));
    expect(await (await openLink(token)).json()).toEqual({ workspace: "Ana's Studio", tasks: [] });
  });

  it("can only be made, reset or turned off by an admin", async () => {
    const manager = await loginAs("manager");
    expect((await api("/api/share", { method: "POST", cookie: manager })).status).toBe(403);
    expect((await api("/api/share", { method: "DELETE", cookie: manager })).status).toBe(403);
    expect((await api("/api/share", { cookie: manager })).status).toBe(403);
  });

  it("stops working when it's reset or turned off", async () => {
    const admin = await loginAs("admin");
    const first = await createLink(admin);
    const second = await createLink(admin);
    expect((await openLink(first)).status).toBe(404);
    expect((await openLink(second)).status).toBe(200);

    expect((await api("/api/share", { method: "DELETE", cookie: admin })).status).toBe(200);
    expect((await openLink(second)).status).toBe(404);
  });

  it("tells the admin whether a link is on, without revealing it again", async () => {
    const admin = await loginAs("admin");
    expect(await getJson("/api/share", admin)).toEqual({ enabled: false });
    await createLink(admin);
    const status = await getJson<Record<string, unknown>>("/api/share", admin);
    expect(status).toMatchObject({ enabled: true, created_at: expect.any(String) });
    expect(status).not.toHaveProperty("token");
  });

  it("stops working when the admin who made it leaves or stops being an admin", async () => {
    const cookie = sessionCookie(await signUp());
    const { id: rileyId, cookie: rileyCookie } = await addTeammate(cookie, { ...riley, role: "admin" });
    const rileys = await createLink(rileyCookie);
    expect((await api(`/api/users/${rileyId}`, { method: "PATCH", cookie, body: { role: "member" } })).status).toBe(200);
    expect((await openLink(rileys)).status).toBe(404);

    // Made an admin again, their old link stays dead.
    await api(`/api/users/${rileyId}`, { method: "PATCH", cookie, body: { role: "admin" } });
    expect((await openLink(rileys)).status).toBe(404);
    expect(await getJson("/api/share", cookie)).toEqual({ enabled: false });
    const anas = await createLink(cookie);
    expect((await api("/api/me", { method: "DELETE", cookie, body: { password: ana.password } })).status).toBe(200);
    expect((await openLink(anas)).status).toBe(404);
  });

  it("lets a whole office on one network open it, refreshing as they go", async () => {
    const token = await createLink(await loginAs("admin"));
    const statuses = [];
    for (let i = 0; i < 15; i++) statuses.push((await api("/api/shared", { method: "POST", body: { token }, ip: "203.0.113.7" })).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("rejects made-up tokens", async () => {
    expect((await openLink("not-a-real-token")).status).toBe(404);
  });

  it("is cleared by the nightly demo reset", async () => {
    const token = await createLink(await loginAs("admin"));
    await runNightlyReset();
    expect((await openLink(token)).status).toBe(404);
  });
});
