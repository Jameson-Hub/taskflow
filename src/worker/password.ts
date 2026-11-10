// Workers caps PBKDF2 at 100k iterations.
const ITERATIONS = 100_000;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return ["pbkdf2", ITERATIONS, toB64(salt), toB64(await derive(password, salt, ITERATIONS))].join("$");
}

// Hashed when the email doesn't exist, so response time doesn't reveal which accounts are real.
const DUMMY_HASH = ["pbkdf2", ITERATIONS, toB64(new Uint8Array(16)), toB64(new Uint8Array(32))].join("$");

export async function verifyPassword(password: string, stored: string | null) {
  const [, iterations, salt, hash] = (stored ?? DUMMY_HASH).split("$");
  const actual = await derive(password, fromB64(salt!), Number(iterations));
  const expected = fromB64(hash!);
  return stored !== null && actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}
