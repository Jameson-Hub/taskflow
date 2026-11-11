import { HTTPException } from "hono/http-exception";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { User } from "./session";

export type AppEnv = { Bindings: Env; Variables: { user: User } };

/** Ends the request with `{ error }`; `app.onError` turns it into the response. */
export function fail(status: ContentfulStatusCode, error: string): never {
  throw new HTTPException(status, { res: Response.json({ error }, { status }) });
}

// Slows down password guessing and sign-up spam: per account once signed in, so a stolen
// session can't spread guesses across IPs; per route and client IP before that.
export const rateLimited = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.var.user as User | undefined;
  const key = user ? `user:${user.id}` : `${c.req.path}:${c.req.header("CF-Connecting-IP") ?? "local"}`;
  const { success } = await c.env.AUTH_LIMITER.limit({ key });
  if (!success) fail(429, "Too many attempts. Wait a minute and try again.");
  await next();
});

export const requirePolicy = (allowed: (user: User) => boolean) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!allowed(c.var.user)) fail(403, "Your role can't do that");
    await next();
  });

export async function readBody<T extends z.ZodType>(
  c: { req: { json(): Promise<unknown> } },
  schema: T,
  error: string,
): Promise<z.infer<T>> {
  const result = schema.safeParse(await c.req.json().catch(() => null));
  if (!result.success) fail(400, error);
  return result.data;
}

export function orNotFound<T>(row: T | null, what: string): T {
  if (row === null) fail(404, `${what} not found`);
  return row;
}

export const idParam = (c: { req: { param(name: string): string } }, name = "id") => Number(c.req.param(name));
