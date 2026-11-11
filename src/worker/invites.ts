import { Hono } from "hono";
import { z } from "zod";
import { DAY_MS, type Role } from "../shared/domain";
import { can } from "../shared/policy";
import { fail, rateLimited, readBody, requirePolicy, type AppEnv } from "./http";
import { hashPassword } from "./password";
import { DEMO_WORKSPACE } from "./seed";
import { createAccount, newToken, publicUser, SELECT_USER, sha256, startSession } from "./session";
import { accountDetails, roleBody } from "./users";

const INVITE_DAYS = 7;

/** Admins create invite links: `/api/invites`. */
export const invites = new Hono<AppEnv>();

invites.post("/", requirePolicy(can.manageTeam), async (c) => {
  const { role } = await readBody(c, roleBody, "Pick a role");
  const me = c.var.user;
  // Demo accounts are public, so a demo invite would let anyone hand out logins.
  if (me.workspace_id === DEMO_WORKSPACE) fail(403, "Invite links are off in the demo. Create your own workspace to try them.");
  const token = newToken();
  const expires = new Date(Date.now() + INVITE_DAYS * DAY_MS).toISOString();
  await c.env.DB.prepare("INSERT INTO invites (id, workspace_id, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), me.workspace_id, role, me.id, expires)
    .run();
  return c.json({ token, expires_at: expires }, 201);
});

/** Opening and accepting a link, before signing in: `/api/auth/...`. */
export const inviteAuth = new Hono<AppEnv>();

const LIVE_INVITE = "FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.id = ? AND i.expires_at > ?";
const DEAD_INVITE = "This invite link has expired or was already used. Ask for a new one.";

// POST with the token in the body: a URL path would put it in request logs.
inviteAuth.post("/invite", rateLimited, async (c) => {
  const { token } = await readBody(c, z.object({ token: z.string() }), "Missing invite token");
  const invite = await c.env.DB.prepare(`SELECT w.name AS workspace, i.role ${LIVE_INVITE}`)
    .bind(await sha256(token), new Date().toISOString())
    .first<{ workspace: string; role: Role }>();
  if (!invite) fail(404, DEAD_INVITE);
  return c.json(invite);
});

const joinBody = accountDetails.extend({ token: z.string() });

inviteAuth.post("/join", rateLimited, async (c) => {
  const { token, name, email, password } = await readBody(c, joinBody, "Check your name, email and a password of 12+ characters");
  const id = await sha256(token);
  const now = new Date().toISOString();
  // One transaction: the invite is only used up if the account is created.
  const [inserted, , selected] = await createAccount(c.env.DB, [
    c.env.DB.prepare(
      `INSERT INTO users (email, name, role, password_hash, workspace_id, last_seen_at) SELECT ?, ?, i.role, ?, i.workspace_id, ? ${LIVE_INVITE}`,
    ).bind(email, name, await hashPassword(password), now, id, now),
    c.env.DB.prepare("DELETE FROM invites WHERE id = ?").bind(id),
    c.env.DB.prepare(`${SELECT_USER} WHERE u.id = last_insert_rowid()`),
  ]);
  // No insert means no live invite; the select would then find a stale row, so check first.
  const user = inserted?.meta.changes ? selected?.results[0] : undefined;
  if (!user) fail(404, DEAD_INVITE);
  await startSession(c, c.env.DB, user.id, "standard");
  return c.json(publicUser(user), 201);
});
