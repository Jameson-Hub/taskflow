import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { activity } from "./activity";
import { comments } from "./comments";
import { account } from "./account";
import { fail, rateLimited, readBody, requireSameOrigin, type AppEnv } from "./http";
import { inviteAuth, invites } from "./invites";
import { share, shared } from "./share";
import { hashPassword, verifyPassword } from "./password";
import { DEMO_WORKSPACE, deleteExpired, deleteInactiveWorkspaces, resetDemo } from "./seed";
import { createAccount, endSession, publicUser, SELECT_USER, SELECT_USER_WITH_PASSWORD, sessionUser, startSession, touchLastSeen, type User } from "./session";
import { live, notifyOnChange, notifyWorkspace } from "./live";
import { consumeWeekly, isMonday, queueWeeklySummaries, type WeeklyJob } from "./weekly";
import { isoDate } from "../shared/domain";
import { stats } from "./stats";
import { tasks } from "./tasks";
import { accountDetails, roleBody, users } from "./users";

const app = new Hono<AppEnv>().basePath("/api");

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

// Every change must come from our own origin (GET is safe, apart from the live WebSocket, which checks itself).
app.use("/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") requireSameOrigin(c);
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

const signup = accountDetails.extend({
  workspace: z.string().trim().min(1).max(80),
  website: z.literal("").optional(),
});

app.post("/auth/signup", rateLimited, async (c) => {
  const { name, email, password, workspace } = await readBody(c, signup, "Check your name, email, workspace name and a password of 12+ characters");
  // One transaction: if the email is taken, the workspace insert rolls back too.
  const results = await createAccount(c.env.DB, [
    c.env.DB.prepare("INSERT INTO workspaces (name) VALUES (?)").bind(workspace),
    c.env.DB.prepare(
      "INSERT INTO users (email, name, role, password_hash, workspace_id, last_seen_at) VALUES (?, ?, 'admin', ?, last_insert_rowid(), ?)",
    ).bind(email, name, await hashPassword(password), new Date().toISOString()),
    c.env.DB.prepare(`${SELECT_USER} WHERE u.id = last_insert_rowid()`),
  ]);
  const user = results.at(-1)!.results[0]!;
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

app.route("/auth", inviteAuth);
app.route("/shared", shared);

app.post("/auth/logout", async (c) => {
  await endSession(c, c.env.DB);
  return c.json({ ok: true });
});

app.use("/*", requireUser);

// Changes that show on the board are announced to the workspace's open boards: tasks and their comments, and
// people leaving (their name and assignments change). Registered before the routes they cover.
app.use("/tasks/*", notifyOnChange); // also matches /tasks itself
app.use("/me", async (c, next) => (c.req.method === "DELETE" ? notifyOnChange(c, next) : next()));
app.route("/me", account);

app.route("/live", live);
app.route("/users", users);
app.route("/invites", invites);
app.route("/share", share);
app.route("/tasks", tasks);
app.route("/tasks/:taskId{[0-9]+}/comments", comments);
app.route("/activity", activity);
app.route("/stats", stats);

export { BoardRoom } from "./live";

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        ...(isMonday(controller.scheduledTime) ? [queueWeeklySummaries(env, isoDate(controller.scheduledTime))] : []),
        // Open demo boards reload, find their session gone with the reset, and return to the sign-in screen.
        // The reset has happened by then; a failed ping doesn't make the run a failure.
        resetDemo(env.DB).then(() => notifyWorkspace(env, DEMO_WORKSPACE).catch(() => {})),
        deleteInactiveWorkspaces(env.DB),
        deleteExpired(env.DB),
      ]),
    );
  },
  queue: (batch, env, _ctx) => consumeWeekly(batch as MessageBatch<WeeklyJob>, env),
} satisfies ExportedHandler<Env>;
