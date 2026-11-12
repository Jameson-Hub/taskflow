import { Hono, type Context } from "hono";
import { z } from "zod";
import { logActivity } from "./activity";
import { fail, rateLimited, readBody, type AppEnv } from "./http";
import { hashPassword, verifyPassword } from "./password";
import { clearSessionCookie, deleteOtherSessions, publicUser } from "./session";
import { newUser, otherAdmin } from "./users";

/** The signed-in user's own account: `/api/me`. */
export const account = new Hono<AppEnv>();

account.get("/", (c) => c.json(publicUser(c.var.user)));

/** Account changes need the current password, so a borrowed session can't take the account over. */
async function confirmPassword(c: Context<AppEnv>, password: string) {
  const { id, is_demo } = c.var.user;
  if (is_demo) fail(403, "Demo accounts can't do that. Create your own account.");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(id).first<{ password_hash: string | null }>();
  if (!(await verifyPassword(password, row?.password_hash ?? null))) fail(403, "Your current password is wrong");
}

const passwordChange = z.object({ current: z.string(), next: newUser.shape.password });

account.post("/password", rateLimited, async (c) => {
  const { current, next } = await readBody(c, passwordChange, "Enter your current password and a new one of 12+ characters");
  await confirmPassword(c, current);
  const { id } = c.var.user;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(next), id),
    await deleteOtherSessions(c, c.env.DB, id),
  ]);
  return c.json({ ok: true });
});

const deletion = z.object({ password: z.string(), deleteWorkspace: z.boolean().default(false) });

account.delete("/", rateLimited, async (c) => {
  const { password, deleteWorkspace } = await readBody(c, deletion, "Enter your password to delete your account");
  await confirmPassword(c, password);
  const me = c.var.user;
  const lastAdmin = me.role === "admin" && !(await otherAdmin(c.env.DB, me));
  // The client warns before deleting a workspace; this makes sure what it warned about is what happens.
  if (deleteWorkspace !== lastAdmin) {
    fail(409, lastAdmin ? "You're the only admin, so this deletes the workspace. Confirm that first." : "Someone else still runs this workspace, so it stays.");
  }
  if (lastAdmin) {
    // Cascades take everything in the workspace, sessions included.
    await c.env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(me.workspace_id).run();
  } else {
    await c.env.DB.batch([
      logActivity(c.env.DB, me, null, "user.left", { title: "" }),
      c.env.DB.prepare(
        "UPDATE users SET name = 'Deleted user', email = 'deleted-' || id || '@deleted.invalid', password_hash = NULL, deleted_at = ? WHERE id = ?",
      ).bind(new Date().toISOString(), me.id),
      c.env.DB.prepare("UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?").bind(me.id),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(me.id),
      c.env.DB.prepare("DELETE FROM invites WHERE created_by = ?").bind(me.id),
      c.env.DB.prepare("DELETE FROM board_shares WHERE created_by = ?").bind(me.id),
    ]);
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});
