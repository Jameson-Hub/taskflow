import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { DAY_MS, type Role } from "../shared/domain";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 7;

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_demo: number;
  workspace_id: number;
  workspace: string;
  last_seen_at: string | null;
}

const USER_COLUMNS = "u.id, u.email, u.name, u.role, u.is_demo, u.workspace_id, u.last_seen_at, w.name AS workspace";
const FROM_USERS = "FROM users u JOIN workspaces w ON w.id = u.workspace_id";

/** Every user query goes through these, so the workspace always comes along. Filter with `u.`-prefixed columns. */
export const SELECT_USER = `SELECT ${USER_COLUMNS} ${FROM_USERS}`;
export const SELECT_USER_WITH_PASSWORD = `SELECT ${USER_COLUMNS}, u.password_hash ${FROM_USERS}`;

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, demo: u.is_demo === 1, workspace: u.workspace };
}

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function startSession(c: Context, db: D1Database, userId: number) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires.toISOString())
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

export async function sessionUser(c: Context, db: D1Database): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return db
    .prepare(`${SELECT_USER} WHERE u.id = (SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?)`)
    .bind(await sha256(token), new Date().toISOString())
    .first<User>();
}

/** Recorded at most once a day per user; inactive workspaces are cleaned up from it. */
export function touchLastSeen(db: D1Database, user: User) {
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_seen_at?.startsWith(today)) return null;
  return db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(new Date().toISOString(), user.id).run();
}

export async function endSession(c: Context, db: D1Database) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}
