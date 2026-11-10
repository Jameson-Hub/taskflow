import { beforeEach, describe, expect, it } from "vitest";
import { api, loginAs, riley, runNightlyReset } from "./helpers";

beforeEach(runNightlyReset);

describe("managing users", () => {
  it.each(["manager", "member"] as const)("is admin-only (%s gets 403)", async (role) => {
    const res = await api("/api/users", { method: "POST", cookie: await loginAs(role), body: riley });
    expect(res.status).toBe(403);
  });

  it("requires signing in", async () => {
    expect((await api("/api/users", { method: "POST", body: riley })).status).toBe(401);
  });

  it("lists the team for everyone, without password data", async () => {
    const res = await api("/api/users", { cookie: await loginAs("member") });
    expect(res.status).toBe(200);
    const users = (await res.json()) as Record<string, unknown>[];
    expect(users.map((u) => u.email)).toEqual([
      "admin@taskflow.demo",
      "manager@taskflow.demo",
      "member@taskflow.demo",
      "jordan@taskflow.demo",
    ]);
    expect(users.every((u) => !("password_hash" in u))).toBe(true);
    expect(users.every((u) => u.demo === true)).toBe(true);
  });

  it("lets an admin change someone's role", async () => {
    const admin = await loginAs("admin");
    const created = (await (await api("/api/users", { method: "POST", cookie: admin, body: riley })).json()) as { id: number };
    const res = await api(`/api/users/${created.id}`, { method: "PATCH", cookie: admin, body: { role: "manager" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "manager" });
  });

  it.each(["manager", "member"] as const)("only admins change roles (%s gets 403)", async (role) => {
    const admin = await loginAs("admin");
    const created = (await (await api("/api/users", { method: "POST", cookie: admin, body: riley })).json()) as { id: number };
    const res = await api(`/api/users/${created.id}`, { method: "PATCH", cookie: await loginAs(role), body: { role: "admin" } });
    expect(res.status).toBe(403);
  });

  it("keeps demo accounts' roles fixed so the demo can't be broken", async () => {
    const res = await api("/api/users/2", { method: "PATCH", cookie: await loginAs("admin"), body: { role: "member" } });
    expect(res.status).toBe(403);
  });
});
