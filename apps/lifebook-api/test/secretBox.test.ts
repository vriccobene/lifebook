import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadSecretKey } from "../src/auth/secretBox";
import { monthEnds } from "../src/firefly/plan";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("secret encryption", () => {
  it("round-trips, with a fresh IV every time", () => {
    const key = randomBytes(32);
    const a = encryptSecret(key, "token");
    expect(a).not.toBe(encryptSecret(key, "token"));
    expect(a).not.toContain("token");
    expect(decryptSecret(key, a)).toBe("token");
  });

  it("returns null with another key or a tampered value", () => {
    const stored = encryptSecret(randomBytes(32), "token");
    expect(decryptSecret(randomBytes(32), stored)).toBeNull();
    expect(decryptSecret(randomBytes(32), "garbage")).toBeNull();
  });

  it("creates the key file once, readable only by its owner, and reuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifebook-key-"));
    dirs.push(dir);
    const file = join(dir, "lifebook.sqlite.key");
    const key = loadSecretKey(file, undefined);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadSecretKey(file, undefined).equals(key)).toBe(true);
    expect(readFileSync(file, "utf8").trim()).toBe(key.toString("base64"));
  });

  it("prefers LIFEBOOK_SECRET_KEY and rejects a key of the wrong size", () => {
    const key = randomBytes(32);
    expect(loadSecretKey("/nonexistent/file", key.toString("base64")).equals(key)).toBe(true);
    expect(() => loadSecretKey("/nonexistent/file", "c2hvcnQ=")).toThrow(/32 bytes/);
  });
});

describe("import dates", () => {
  it("lists the month ends inside the range, leap years included", () => {
    expect(monthEnds("2028-01-15", "2028-03-31")).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
    ]);
    expect(monthEnds("2026-01-31", "2026-02-27")).toEqual(["2026-01-31"]);
    expect(monthEnds("2026-02-01", "2026-02-27")).toEqual([]);
  });
});
