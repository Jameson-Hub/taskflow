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
}

export const USER_COLUMNS = "id, email, name, role, is_demo";

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, demo: u.is_demo === 1 };
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
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = (SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?)`)
    .bind(await sha256(token), new Date().toISOString())
    .first<User>();
}

export async function endSession(c: Context, db: D1Database) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}
