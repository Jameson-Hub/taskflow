import { Hono } from "hono";
import { z } from "zod";
import { ROLES } from "../shared/domain";
import { can } from "../shared/policy";
import { logActivity } from "./activity";
import { fail, idParam, orNotFound, readBody, requirePolicy, type AppEnv } from "./http";
import { hashPassword } from "./password";
import { publicUser, USER_COLUMNS, type User } from "./session";

export const roleBody = z.object({ role: z.enum(ROLES) });

const newUser = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  password: z.string().min(12).max(200),
});

export const users = new Hono<AppEnv>();

users.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY id`).all<User>();
  return c.json(results.map(publicUser));
});

users.post("/", requirePolicy(can.manageTeam), async (c) => {
  const { email, name, role, password } = await readBody(c, newUser, "Check the email, name, role and a password of 12+ characters");
  const created = await c.env.DB.prepare(
    `INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING ${USER_COLUMNS}`,
  )
    .bind(email, name, role, await hashPassword(password))
    .first<User>();
  if (!created) fail(409, "That email is already in use");
  return c.json(publicUser(created), 201);
});

users.patch("/:id{[0-9]+}", requirePolicy(can.manageTeam), async (c) => {
  const { role } = await readBody(c, roleBody, "Pick a role");
  const target = orNotFound(await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(idParam(c)).first<User>(), "User");
  if (target.is_demo) fail(403, "Demo accounts keep their roles");
  if (target.role === role) return c.json(publicUser(target));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, target.id),
    logActivity(c.env.DB, c.var.user.id, null, "user.role_changed", { title: target.name, changes: { role: [target.role, role] } }),
  ]);
  return c.json(publicUser({ ...target, role }));
});
