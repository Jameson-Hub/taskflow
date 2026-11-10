import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDatabase, getJson, loginWithPassword, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

describe("sign up", () => {
  it("creates an account and a private workspace where the new user is admin", async () => {
    const res = await signUp();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Ana Reyes", email: "ana@example.com", role: "admin", demo: false, workspace: "Ana's Studio" });

    const cookie = sessionCookie(res);
    expect(await (await api("/api/me", { cookie })).json()).toMatchObject({ email: "ana@example.com", workspace: "Ana's Studio" });
  });

  it("lets the new user sign in again with their password", async () => {
    await signUp();
    expect((await loginWithPassword()).status).toBe(200);
  });

  it("starts the new workspace with an empty board and only its owner on the team", async () => {
    const cookie = sessionCookie(await signUp());
    expect(await getJson("/api/tasks", cookie)).toEqual([]);
    expect((await getJson<{ email: string }[]>("/api/users", cookie)).map((u) => u.email)).toEqual(["ana@example.com"]);
  });

  it("rejects an email that's already registered", async () => {
    await signUp();
    expect((await signUp({ name: "Someone Else" })).status).toBe(409);
  });

  it("rejects short passwords and missing fields", async () => {
    expect((await signUp({ password: "short" })).status).toBe(400);
    expect((await signUp({ name: "" })).status).toBe(400);
    expect((await signUp({ workspace: "" })).status).toBe(400);
  });

  it("rejects bots that fill in the hidden field, without creating an account", async () => {
    expect((await signUp({ website: "http://spam.example" })).status).toBe(400);
    expect((await loginWithPassword()).status).toBe(401);
  });
});
