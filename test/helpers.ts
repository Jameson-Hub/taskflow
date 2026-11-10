import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import worker from "../src/worker";

import type { Role } from "../src/shared/domain";

export type { Role };

export const riley = { email: "riley@example.com", name: "Riley Park", role: "member", password: "correct horse battery" };

const ORIGIN = "http://taskflow.test";

export async function api(
  path: string,
  { method = "GET", body, cookie, origin = ORIGIN }: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {},
) {
  const headers = new Headers();
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
