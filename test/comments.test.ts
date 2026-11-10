import { beforeEach, describe, expect, it } from "vitest";
import { api, loginAs, runNightlyReset } from "./helpers";

beforeEach(runNightlyReset);

const TASK = 1;

async function comment(cookie: string, body: string) {
  const res = await api(`/api/tasks/${TASK}/comments`, { method: "POST", cookie, body: { body } });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number };
}

describe("comments", () => {
  it("anyone on the team can comment, and comments show oldest first with the author", async () => {
    await comment(await loginAs("member"), "Pipeline is green now");
    await comment(await loginAs("manager"), "Great, thanks!");

    const res = await api(`/api/tasks/${TASK}/comments`, { cookie: await loginAs("admin") });
    expect(await res.json()).toMatchObject([
      { body: "Pipeline is green now", author: { name: "Sam Cruz" } },
      { body: "Great, thanks!", author: { name: "Morgan Lee" } },
    ]);
  });

  it("rejects an empty comment", async () => {
    const res = await api(`/api/tasks/${TASK}/comments`, { method: "POST", cookie: await loginAs("member"), body: { body: " " } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when commenting on a missing task", async () => {
    const res = await api("/api/tasks/999/comments", { method: "POST", cookie: await loginAs("member"), body: { body: "hi" } });
    expect(res.status).toBe(404);
  });

  it("lets authors delete their own comment but not other people's", async () => {
    const member = await loginAs("member");
    const mine = await comment(member, "Mine");
    const managers = await comment(await loginAs("manager"), "Not yours");

    expect((await api(`/api/tasks/${TASK}/comments/${managers.id}`, { method: "DELETE", cookie: member })).status).toBe(403);
    expect((await api(`/api/tasks/${TASK}/comments/${mine.id}`, { method: "DELETE", cookie: member })).status).toBe(204);
  });

  it("lets an admin delete any comment", async () => {
    const theirs = await comment(await loginAs("member"), "Oops");
    const res = await api(`/api/tasks/${TASK}/comments/${theirs.id}`, { method: "DELETE", cookie: await loginAs("admin") });
    expect(res.status).toBe(204);
  });
});
