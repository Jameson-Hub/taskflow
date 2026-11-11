import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import worker from "../src/worker";
import { DEMO_WORKSPACE } from "../src/worker/seed";

import type { Role } from "../src/shared/domain";

export type { Role };

export const riley = { email: "riley@example.com", name: "Riley Park", role: "member", password: "correct horse battery" };

const ORIGIN = "http://taskflow.test";

/** A different client per call, so the per-IP rate limit only bites in tests that pick an IP on purpose. */
let ipCounter = 0;
const nextIp = () => `192.0.2.${++ipCounter % 250}`;

export async function api(
  path: string,
  {
    method = "GET",
    body,
    cookie,
    origin = ORIGIN,
    ip,
  }: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string } = {},
) {
  const headers = new Headers();
  if (ip) headers.set("CF-Connecting-IP", ip);
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(
    new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
}

export function sessionCookie(res: Response) {
  const header = res.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0] ?? "";
}

export async function loginAs(role: Role) {
  const res = await api("/api/auth/demo", { method: "POST", body: { role } });
  if (res.status !== 200) throw new Error(`demo login as ${role} failed: ${res.status}`);
  return sessionCookie(res);
}

export async function runNightlyReset() {
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);
}

export const ana = { name: "Ana Reyes", email: "ana@example.com", password: "a long enough password", workspace: "Ana's Studio" };

export async function signUp(details: Partial<typeof ana> & { website?: string } = {}, ip = nextIp()) {
  return api("/api/auth/signup", { method: "POST", body: { ...ana, ...details }, ip });
}

export async function loginWithPassword({
  email = ana.email,
  password = ana.password,
  ip = nextIp(),
  remember,
}: { email?: string; password?: string; ip?: string; remember?: boolean } = {}) {
  return api("/api/auth/login", { method: "POST", body: { email, password, remember }, ip });
}

/** Brings someone into the admin's workspace the way real workspaces do it: an invite link. */
export async function addTeammate(adminCookie: string, { role, ...person }: typeof riley = riley) {
  const invite = await api("/api/invites", { method: "POST", cookie: adminCookie, body: { role } });
  if (invite.status !== 201) throw new Error(`invite failed: ${invite.status}`);
  const { token } = (await invite.json()) as { token: string };
  const joined = await api("/api/auth/join", { method: "POST", body: { token, ...person } });
  if (joined.status !== 201) throw new Error(`join failed: ${joined.status}`);
  return { id: ((await joined.clone().json()) as { id: number }).id, cookie: sessionCookie(joined) };
}

/** For tests that check what a job left behind in storage. */
export async function count(sql: string) {
  return (await env.DB.prepare(sql).first<{ n: number }>())?.n;
}

export async function getJson<T>(path: string, cookie: string) {
  return (await api(path, { cookie })).json() as Promise<T>;
}

/** The state a just-migrated database is in: only the (empty) demo workspace row. */
export async function emptyDatabase() {
  await env.DB.batch([
    ...["activity", "comments", "tasks", "sessions", "invites", "users"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare("DELETE FROM workspaces WHERE id <> ?").bind(DEMO_WORKSPACE),
  ]);
}

/** Every test starts from an empty database with the demo seeded. */
export async function freshDatabase() {
  await emptyDatabase();
  await runNightlyReset();
}
