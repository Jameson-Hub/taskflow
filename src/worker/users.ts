import { Hono } from "hono";
import { z } from "zod";
import { ROLES } from "../shared/domain";
import { can } from "../shared/policy";
import { logActivity } from "./activity";
import { fail, idParam, orNotFound, readBody, requirePolicy, type AppEnv } from "./http";
import { hashPassword } from "./password";
import { DEMO_WORKSPACE } from "./seed";
import { publicUser, SELECT_USER, type User } from "./session";

export const roleBody = z.object({ role: z.enum(ROLES) });

/** What a person picks for themselves when signing up or joining. */
export const accountDetails = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(200),
});

export const newUser = accountDetails.extend({ role: z.enum(ROLES) });

/** Whether anyone besides `user` can run their workspace. */
export async function otherAdmin(db: D1Database, user: User) {
  const row = await db
    .prepare("SELECT 1 FROM users WHERE workspace_id = ? AND id <> ? AND role = 'admin' AND deleted_at IS NULL")
    .bind(user.workspace_id, user.id)
    .first();
  return row !== null;
}

export const users = new Hono<AppEnv>();

users.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT_USER} WHERE u.workspace_id = ? ORDER BY u.id`).bind(c.var.user.workspace_id).all<User>();
  return c.json(results.map(publicUser));
});

users.post("/", requirePolicy(can.manageTeam), async (c) => {
  const { email, name, role, password } = await readBody(c, newUser, "Check the email, name, role and a password of 12+ characters");
  const me = c.var.user;
  // Real workspaces use invite links, so people choose their own passwords.
  if (me.workspace_id !== DEMO_WORKSPACE) fail(403, "Send an invite link instead, so they can choose their own password");
  // The demo is public: reserved addresses only, so nobody can lock a real person out of signing up.
  if (!email.toLowerCase().endsWith("@example.com")) fail(400, "In the demo, use an @example.com address");
  const [insert, select] = await c.env.DB.batch<User>([
    c.env.DB.prepare("INSERT INTO users (email, name, role, password_hash, workspace_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(
      email,
      name,
      role,
      await hashPassword(password),
      me.workspace_id,
    ),
    c.env.DB.prepare(`${SELECT_USER} WHERE u.email = ? AND u.workspace_id = ?`).bind(email, me.workspace_id),
  ]);
  if (insert!.meta.changes === 0) fail(409, "That email is already in use");
  return c.json(publicUser(select!.results[0]!), 201);
});

users.patch("/:id{[0-9]+}", requirePolicy(can.manageTeam), async (c) => {
  const { role } = await readBody(c, roleBody, "Pick a role");
  const target = orNotFound(
    await c.env.DB.prepare(`${SELECT_USER} WHERE u.id = ? AND u.workspace_id = ?`).bind(idParam(c), c.var.user.workspace_id).first<User>(),
    "User",
  );
  if (target.is_demo) fail(403, "Demo accounts keep their roles");
  if (target.role === role) return c.json(publicUser(target));
  if (target.role === "admin" && !(await otherAdmin(c.env.DB, target))) fail(409, "A workspace needs at least one admin");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, target.id),
    // Invites are admin power; a former admin's open links stop working with it.
    ...(role === "admin" ? [] : [c.env.DB.prepare("DELETE FROM invites WHERE created_by = ?").bind(target.id)]),
    logActivity(c.env.DB, c.var.user, null, "user.role_changed", { title: target.name, changes: { role: [target.role, role] } }),
  ]);
  return c.json(publicUser({ ...target, role }));
});
