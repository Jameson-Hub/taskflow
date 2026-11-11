import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS } from "../src/shared/domain";
import { api, freshDatabase, loginWithPassword, sessionCookie, signUp } from "./helpers";

beforeEach(async () => {
  await freshDatabase();
  expect((await signUp()).status).toBe(201);
});

afterEach(() => {
  vi.useRealTimers();
});

async function login(remember?: boolean) {
  const at = Date.now();
  const res = await loginWithPassword({ remember });
  expect(res.status).toBe(200);
  return { setCookie: res.headers.get("Set-Cookie"), session: { cookie: sessionCookie(res), at } };
}

async function signedInAfter(session: { cookie: string; at: number }, days: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(session.at + days * DAY_MS);
  return (await api("/api/me", { cookie: session.cookie })).status === 200;
}

describe("remember me", () => {
  it("keeps a remembered login for 30 days", async () => {
    const { setCookie, session } = await login(true);
    expect(setCookie).toMatch(/Expires=/i);

    expect(await signedInAfter(session, 29)).toBe(true);
    expect(await signedInAfter(session, 31)).toBe(false);
  });

  it("makes an unremembered login a browser-session cookie that lasts a day at most", async () => {
    const { setCookie, session } = await login(false);
    expect(setCookie).not.toMatch(/Expires=|Max-Age=/i);

    expect(await signedInAfter(session, 0.9)).toBe(true);
    expect(await signedInAfter(session, 1.1)).toBe(false);
  });

  it("treats a login without the field as not remembered", async () => {
    expect((await login()).setCookie).not.toMatch(/Expires=|Max-Age=/i);
  });
});
