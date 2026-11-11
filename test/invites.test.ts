import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS } from "../src/shared/domain";
import { addTeammate, ana, api, freshDatabase, getJson, loginAs, riley, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const sam = { name: "Sam Cruz", email: "sam@example.com", password: "sam's long password" };

async function anaInvites(role = "manager") {
  const cookie = sessionCookie(await signUp());
  const res = await api("/api/invites", { method: "POST", cookie, body: { role } });
  expect(res.status).toBe(201);
  const { token } = (await res.json()) as { token: string };
  return { cookie, token };
}

// The token travels in request bodies, never the URL, so it stays out of request logs.
function lookUp(token: string) {
  return api("/api/auth/invite", { method: "POST", body: { token } });
}

function join(token: string, person = sam) {
  return api("/api/auth/join", { method: "POST", body: { token, ...person } });
}

describe("invite links", () => {
  it("let someone join the workspace with the invited role, choosing their own password", async () => {
    const { cookie, token } = await anaInvites("manager");

    expect(await (await lookUp(token)).json()).toEqual({ workspace: ana.workspace, role: "manager" });
    const joined = await join(token);
    expect(joined.status).toBe(201);
    expect(await getJson("/api/me", sessionCookie(joined))).toMatchObject({ email: sam.email, role: "manager", workspace: ana.workspace });
    expect((await getJson<{ email: string }[]>("/api/users", cookie)).map((u) => u.email)).toContain(sam.email);
  });

  it("work only once", async () => {
    const { token } = await anaInvites();
    expect((await join(token)).status).toBe(201);
    expect((await join(token, { ...sam, email: "someone@example.com" })).status).toBe(404);
    expect((await lookUp(token)).status).toBe(404);
  });

  it("expire after 7 days", async () => {
    const { token } = await anaInvites();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 7.1 * DAY_MS);
    expect((await join(token)).status).toBe(404);
  });

  it("aren't used up when the email is already taken", async () => {
    const { token } = await anaInvites();
    expect((await join(token, { ...sam, email: ana.email })).status).toBe(409);
    expect((await join(token)).status).toBe(201);
  });

  it("reject made-up tokens", async () => {
    expect((await join("not-a-real-token")).status).toBe(404);
  });

  it("can only be created by an admin", async () => {
    const { token } = await anaInvites("member");
    const member = sessionCookie(await join(token));
    expect((await api("/api/invites", { method: "POST", cookie: member, body: { role: "member" } })).status).toBe(403);
  });

  it("replace adding people with a password outside the demo, so everyone picks their own", async () => {
    const cookie = sessionCookie(await signUp());
    expect((await api("/api/users", { method: "POST", cookie, body: { ...sam, role: "member" } })).status).toBe(403);
  });

  it("are off in the public demo", async () => {
    expect((await api("/api/invites", { method: "POST", cookie: await loginAs("admin"), body: { role: "member" } })).status).toBe(403);
  });

  it("stop working when the admin who made them leaves or stops being an admin", async () => {
    const { cookie, token } = await anaInvites();
    const { cookie: other } = await addTeammate(cookie, { ...riley, role: "admin" });
    const second = (await (await api("/api/invites", { method: "POST", cookie: other, body: { role: "member" } })).json()) as { token: string };
    const me = await getJson<{ id: number }>("/api/me", other);

    expect((await api("/api/me", { method: "DELETE", cookie, body: { password: ana.password } })).status).toBe(200);
    expect((await lookUp(token)).status).toBe(404);

    await addTeammate(other, { ...sam, email: "third@example.com", role: "admin" } as typeof riley);
    expect((await api(`/api/users/${me.id}`, { method: "PATCH", cookie: other, body: { role: "member" } })).status).toBe(200);
    expect((await lookUp(second.token)).status).toBe(404);
  });
});
