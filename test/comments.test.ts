import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDatabase, getJson, loginAs, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

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

describe("mentions", () => {
  async function teamIds(cookie: string) {
    const team = await getJson<{ id: number; name: string }[]>("/api/users", cookie);
    return Object.fromEntries(team.map((u) => [u.name, u.id]));
  }

  it("are saved with the comment, keeping only people on the team", async () => {
    const manager = await loginAs("manager");
    const ids = await teamIds(manager);
    const outsider = (await getJson<{ id: number }>("/api/me", sessionCookie(await signUp()))).id;

    const res = await api(`/api/tasks/${TASK}/comments`, {
      method: "POST",
      cookie: manager,
      body: { body: "@Sam Cruz can you check?", mentions: [ids["Sam Cruz"], outsider, 999999, ids["Sam Cruz"]] },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ mentions: [ids["Sam Cruz"]] });
    expect(await getJson(`/api/tasks/${TASK}/comments`, manager)).toMatchObject([{ mentions: [ids["Sam Cruz"]] }]);
  });

  it("let you filter the board to tasks that mention you", async () => {
    const manager = await loginAs("manager");
    const ids = await teamIds(manager);
    await api(`/api/tasks/${TASK}/comments`, { method: "POST", cookie: manager, body: { body: "@Sam Cruz look", mentions: [ids["Sam Cruz"]] } });

    const forSam = await getJson<{ id: number }[]>("/api/tasks?mentioned=1", await loginAs("member"));
    expect(forSam.map((t) => t.id)).toEqual([TASK]);
    expect(await getJson("/api/tasks?mentioned=1", manager)).toEqual([]);
  });

  it("default to none", async () => {
    const res = await api(`/api/tasks/${TASK}/comments`, { method: "POST", cookie: await loginAs("member"), body: { body: "No one in particular" } });
    expect(await res.json()).toMatchObject({ mentions: [] });
  });
});
