import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, loginAs, riley, runNightlyReset, sessionCookie } from "./helpers";

beforeEach(runNightlyReset);

describe("demo login", () => {
  it("signs in as the chosen role and keeps the session", async () => {
    const login = await api("/api/auth/demo", { method: "POST", body: { role: "manager" } });
    expect(login.status).toBe(200);

    const me = await api("/api/me", { cookie: sessionCookie(login) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: "manager", email: "manager@taskflow.demo" });
  });
});

describe("logout", () => {
  it("ends the session so the cookie stops working", async () => {
    const cookie = await loginAs("member");
    expect((await api("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await api("/api/me", { cookie })).status).toBe(401);
  });
});

describe("password login", () => {
  async function inviteUser() {
    const admin = await loginAs("admin");
    const res = await api("/api/users", {
      method: "POST",
      cookie: admin,
      body: riley,
    });
    expect(res.status).toBe(201);
  }

  it("lets a user an admin created sign in with their password", async () => {
    await inviteUser();
    const login = await api("/api/auth/login", {
      method: "POST",
      body: { email: "Riley@Example.com", password: "correct horse battery" },
    });
    expect(login.status).toBe(200);
    const me = await api("/api/me", { cookie: sessionCookie(login) });
    expect(await me.json()).toMatchObject({ name: "Riley Park", role: "member" });
  });

  it("rejects a wrong password without saying which part was wrong", async () => {
    await inviteUser();
    const wrongPassword = await api("/api/auth/login", {
      method: "POST",
      body: { email: "riley@example.com", password: "nope nope nope" },
    });
    const unknownEmail = await api("/api/auth/login", {
      method: "POST",
      body: { email: "ghost@example.com", password: "nope nope nope" },
    });
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });
});

describe("cross-site requests", () => {
  it("refuses changes sent from another website", async () => {
    const cookie = await loginAs("admin");
    const res = await api("/api/auth/logout", { method: "POST", cookie, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await api("/api/me", { cookie })).status).toBe(200);
  });

  it("refuses changes with no Origin header", async () => {
    const res = await api("/api/auth/demo", { method: "POST", body: { role: "admin" }, origin: null });
    expect(res.status).toBe(403);
  });
});

describe("first visit after deploy", () => {
  it("seeds the demo workspace on demand if the nightly job hasn't run yet", async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM tasks"), env.DB.prepare("DELETE FROM users")]);
    const res = await api("/api/auth/demo", { method: "POST", body: { role: "member" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "member" });
  });
});
