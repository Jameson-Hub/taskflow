import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDatabase, loginAs, riley, runNightlyJob } from "./helpers";

beforeEach(freshDatabase);

describe("nightly reset", () => {
  it("restores the demo workspace and signs everyone out", async () => {
    const admin = await loginAs("admin");
    await api("/api/tasks", { method: "POST", cookie: admin, body: { title: "Scribble" } });
    await api("/api/tasks/1", { method: "DELETE", cookie: admin });
    await api("/api/users", {
      method: "POST",
      cookie: admin,
      body: riley,
    });

    await runNightlyJob();

    expect((await api("/api/me", { cookie: admin })).status).toBe(401);
    const fresh = await loginAs("admin");
    const titles = ((await (await api("/api/tasks", { cookie: fresh })).json()) as { title: string }[]).map((t) => t.title);
    expect(titles).toHaveLength(8);
    expect(titles).toContain("Set up CI pipeline for the API");
    expect(titles).not.toContain("Scribble");
    const emails = ((await (await api("/api/users", { cookie: fresh })).json()) as { email: string }[]).map((u) => u.email);
    expect(emails).not.toContain("riley@example.com");
    expect(await (await api("/api/activity", { cookie: fresh })).json()).toEqual([]);
  });
});
