import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { activity } from "./activity";
import { comments } from "./comments";
import { account } from "./account";
import { fail, rateLimited, readBody, type AppEnv } from "./http";
import { hashPassword, verifyPassword } from "./password";
import { DEMO_WORKSPACE, deleteInactiveWorkspaces, resetDemo } from "./seed";
import { deleteExpiredSessions, endSession, publicUser, SELECT_USER, SELECT_USER_WITH_PASSWORD, sessionUser, startSession, touchLastSeen, type User } from "./session";
import { tasks } from "./tasks";
import { newUser, roleBody, users } from "./users";

const app = new Hono<AppEnv>().basePath("/api");

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

// Session cookies ride along on cross-site requests, so every change must come from our own origin.
app.use("/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("Origin") !== new URL(c.req.url).origin) {
    fail(403, "Cross-site request refused");
  }
  await next();
});

const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await sessionUser(c, c.env.DB);
  if (!user) fail(401, "Not signed in");
  c.set("user", user);
  const touch = touchLastSeen(c.env.DB, user);
  if (touch) c.executionCtx.waitUntil(touch);
  await next();
});

app.post("/auth/demo", async (c) => {
  const { role } = await readBody(c, roleBody, "Pick a role");
  const findDemo = () =>
    c.env.DB.prepare(`${SELECT_USER} WHERE u.role = ? AND u.workspace_id = ? AND u.is_demo = 1 ORDER BY u.id LIMIT 1`)
      .bind(role, DEMO_WORKSPACE)
      .first<User>();
  let user = await findDemo();
  // A fresh database (first deploy, before the nightly job) seeds itself on first use.
  if (!user) {
    await resetDemo(c.env.DB);
    user = await findDemo();
  }
  if (!user) fail(503, "Demo account missing");
  await startSession(c, c.env.DB, user.id, "standard");
  return c.json(publicUser(user));
});

const signup = newUser.pick({ name: true, email: true, password: true }).extend({
  workspace: z.string().trim().min(1).max(80),
  website: z.literal("").optional(),
});

app.post("/auth/signup", rateLimited, async (c) => {
  const { name, email, password, workspace } = await readBody(c, signup, "Check your name, email, workspace name and a password of 12+ characters");
  const hash = await hashPassword(password);
  let user: User;
  try {
    // One transaction: if the email is taken, the workspace insert rolls back too.
    const results = await c.env.DB.batch<User>([
      c.env.DB.prepare("INSERT INTO workspaces (name) VALUES (?)").bind(workspace),
      c.env.DB.prepare(
        "INSERT INTO users (email, name, role, password_hash, workspace_id, last_seen_at) VALUES (?, ?, 'admin', ?, last_insert_rowid(), ?)",
      ).bind(email, name, hash, new Date().toISOString()),
      c.env.DB.prepare(`${SELECT_USER} WHERE u.id = last_insert_rowid()`),
    ]);
    user = results.at(-1)!.results[0]!;
  } catch (err) {
    if (String(err).includes("UNIQUE")) fail(409, "That email is already registered. Sign in instead.");
    throw err;
  }
  await startSession(c, c.env.DB, user.id, "standard");
  return c.json(publicUser(user), 201);
});

app.post("/auth/login", rateLimited, async (c) => {
  const { email, password, remember } = await readBody(
    c,
    z.object({ email: z.string(), password: z.string(), remember: z.boolean().optional() }),
    "Email and password are required",
  );
  const user = await c.env.DB.prepare(`${SELECT_USER_WITH_PASSWORD} WHERE u.email = ?`)
    .bind(email)
    .first<User & { password_hash: string | null }>();
  const valid = await verifyPassword(password, user?.password_hash ?? null);
  if (!valid || !user) fail(401, "Wrong email or password");
  await startSession(c, c.env.DB, user.id, remember ? "remembered" : "browser");
  return c.json(publicUser(user));
});

app.post("/auth/logout", async (c) => {
  await endSession(c, c.env.DB);
  return c.json({ ok: true });
});

app.use("/*", requireUser);

app.route("/me", account);

app.route("/users", users);
app.route("/tasks", tasks);
app.route("/tasks/:taskId{[0-9]+}/comments", comments);
app.route("/activity", activity);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([resetDemo(env.DB), deleteInactiveWorkspaces(env.DB), deleteExpiredSessions(env.DB)]));
  },
} satisfies ExportedHandler<Env>;
