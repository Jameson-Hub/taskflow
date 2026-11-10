import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { activity } from "./activity";
import { comments } from "./comments";
import { fail, readBody, type AppEnv } from "./http";
import { verifyPassword } from "./password";
import { resetDemo } from "./seed";
import { endSession, publicUser, sessionUser, startSession, USER_COLUMNS, type User } from "./session";
import { tasks } from "./tasks";
import { roleBody, users } from "./users";

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
  await next();
});

app.post("/auth/demo", async (c) => {
  const { role } = await readBody(c, roleBody, "Pick a role");
  const findDemo = () =>
    c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE role = ? AND is_demo = 1 ORDER BY id LIMIT 1`).bind(role).first<User>();
  let user = await findDemo();
  // A fresh database (first deploy, before the nightly job) seeds itself on first use.
  if (!user) {
    await resetDemo(c.env.DB);
    user = await findDemo();
  }
  if (!user) fail(503, "Demo account missing");
  await startSession(c, c.env.DB, user.id);
  return c.json(publicUser(user));
});

app.post("/auth/login", async (c) => {
  const { email, password } = await readBody(
    c,
    z.object({ email: z.string(), password: z.string() }),
    "Email and password are required",
  );
  const user = await c.env.DB.prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .bind(email)
    .first<User & { password_hash: string | null }>();
  const valid = await verifyPassword(password, user?.password_hash ?? null);
  if (!valid || !user) fail(401, "Wrong email or password");
  await startSession(c, c.env.DB, user.id);
  return c.json(publicUser(user));
});

app.post("/auth/logout", async (c) => {
  await endSession(c, c.env.DB);
  return c.json({ ok: true });
});

app.use("/*", requireUser);

app.get("/me", (c) => c.json(publicUser(c.var.user)));

app.route("/users", users);
app.route("/tasks", tasks);
app.route("/tasks/:taskId{[0-9]+}/comments", comments);
app.route("/activity", activity);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(resetDemo(env.DB));
  },
} satisfies ExportedHandler<Env>;
