import { beforeEach, describe, expect, it } from "vitest";
import { ana, api, freshDatabase, getJson, loginAs, loginWithPassword, riley, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

const NEW_PASSWORD = "an even longer password";

function changePassword(cookie: string, current: string, next: string) {
  return api("/api/me/password", { method: "POST", cookie, body: { current, next } });
}

function deleteAccount(cookie: string, password: string, { deleteWorkspace = false } = {}) {
  return api("/api/me", { method: "DELETE", cookie, body: { password, deleteWorkspace } });
}

describe("change password", () => {
  it("swaps the password and signs out every other session", async () => {
    const here = sessionCookie(await signUp());
    const elsewhere = sessionCookie(await loginWithPassword());

    expect((await changePassword(here, ana.password, NEW_PASSWORD)).status).toBe(200);

    expect((await loginWithPassword()).status).toBe(401);
    expect((await loginWithPassword({ password: NEW_PASSWORD })).status).toBe(200);
    expect((await api("/api/me", { cookie: here })).status).toBe(200);
    expect((await api("/api/me", { cookie: elsewhere })).status).toBe(401);
  });

  it("refuses a wrong current password and leaves the old one working", async () => {
    const cookie = sessionCookie(await signUp());
    expect((await changePassword(cookie, "not my password", NEW_PASSWORD)).status).toBe(403);
    expect((await loginWithPassword()).status).toBe(200);
  });

  it("is off for demo accounts", async () => {
    expect((await changePassword(await loginAs("admin"), "", NEW_PASSWORD)).status).toBe(403);
  });
});

describe("delete account", () => {
  async function anaWithRiley(role = "member") {
    const anaCookie = sessionCookie(await signUp());
    const res = await api("/api/users", { method: "POST", cookie: anaCookie, body: { ...riley, role } });
    expect(res.status).toBe(201);
    const rileyId = ((await res.json()) as { id: number }).id;
    const rileyCookie = sessionCookie(await loginWithPassword({ email: riley.email, password: riley.password }));
    return { anaCookie, rileyCookie, rileyId };
  }

  it("signs a member out for good but keeps their work and history, under 'Deleted user'", async () => {
    const { anaCookie, rileyCookie, rileyId } = await anaWithRiley();
    const created = await api("/api/tasks", { method: "POST", cookie: rileyCookie, body: { title: "Riley's task", assignee_id: rileyId } });
    const taskId = ((await created.json()) as { id: number }).id;
    await api(`/api/tasks/${taskId}/comments`, { method: "POST", cookie: rileyCookie, body: { body: "Riley's note" } });

    expect((await deleteAccount(rileyCookie, riley.password)).status).toBe(200);

    expect((await api("/api/me", { cookie: rileyCookie })).status).toBe(401);
    expect((await loginWithPassword({ email: riley.email, password: riley.password })).status).toBe(401);
    expect(await getJson<unknown[]>("/api/users", anaCookie)).toHaveLength(1);
    expect(await getJson("/api/tasks", anaCookie)).toMatchObject([{ title: "Riley's task", created_by: rileyId, assignee: null }]);
    expect(await getJson(`/api/tasks/${taskId}/comments`, anaCookie)).toMatchObject([{ body: "Riley's note", author: { name: "Deleted user" } }]);
    const log = await getJson<{ action: string; actor: { name: string } }[]>("/api/activity", anaCookie);
    expect(log.map((e) => [e.action, e.actor.name])).toEqual(
      expect.arrayContaining([
        ["user.left", "Deleted user"],
        ["task.created", "Deleted user"],
      ]),
    );
    // Their email is free again.
    expect((await signUp({ email: riley.email, workspace: "Riley's own" })).status).toBe(201);
  });

  it("keeps the workspace when another admin stays", async () => {
    const { anaCookie, rileyCookie } = await anaWithRiley("admin");
    expect((await deleteAccount(anaCookie, ana.password)).status).toBe(200);
    expect((await api("/api/me", { cookie: rileyCookie })).status).toBe(200);
  });

  it("deletes the whole workspace when the only admin leaves, but only once they've confirmed it", async () => {
    const { anaCookie, rileyCookie } = await anaWithRiley();

    expect((await deleteAccount(anaCookie, ana.password)).status).toBe(409);
    expect((await api("/api/me", { cookie: rileyCookie })).status).toBe(200);

    expect((await deleteAccount(anaCookie, ana.password, { deleteWorkspace: true })).status).toBe(200);
    expect((await api("/api/me", { cookie: rileyCookie })).status).toBe(401);
    expect((await loginWithPassword({ email: riley.email, password: riley.password })).status).toBe(401);
  });

  it("refuses to delete the workspace when someone else would keep it", async () => {
    const { anaCookie } = await anaWithRiley("admin");
    expect((await deleteAccount(anaCookie, ana.password, { deleteWorkspace: true })).status).toBe(409);
    expect((await api("/api/me", { cookie: anaCookie })).status).toBe(200);
  });

  it("refuses a wrong password and keeps the account", async () => {
    const cookie = sessionCookie(await signUp());
    expect((await deleteAccount(cookie, "not my password", { deleteWorkspace: true })).status).toBe(403);
    expect((await api("/api/me", { cookie })).status).toBe(200);
  });

  it("is off for demo accounts", async () => {
    expect((await deleteAccount(await loginAs("member"), "")).status).toBe(403);
  });
});

describe("password guessing", () => {
  it("is limited per account, whichever IP the guesses come from", async () => {
    const cookie = sessionCookie(await signUp());
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = await api("/api/me/password", { method: "POST", cookie, ip: `198.51.100.${i}`, body: { current: "guess", next: NEW_PASSWORD } });
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("keeping an admin", () => {
  it("won't demote a workspace's last admin", async () => {
    const cookie = sessionCookie(await signUp());
    const me = await getJson<{ id: number }>("/api/me", cookie);
    expect((await api(`/api/users/${me.id}`, { method: "PATCH", cookie, body: { role: "manager" } })).status).toBe(409);
    expect(await getJson("/api/me", cookie)).toMatchObject({ role: "admin" });
  });
});
