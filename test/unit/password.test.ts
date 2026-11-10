import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/worker/password";

describe("password hashing", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("never stores the password itself, and salts every hash", async () => {
    const first = await hashPassword("correct horse battery");
    const second = await hashPassword("correct horse battery");
    expect(first).not.toContain("correct horse battery");
    expect(first).not.toEqual(second);
    expect(first.split("$")[0]).toBe("pbkdf2");
  });

  it("rejects everything for an account with no password, such as a demo account", async () => {
    expect(await verifyPassword("", null)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });
});
