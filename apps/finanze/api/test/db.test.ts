import Database from "better-sqlite3";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client";
import { users } from "../src/db/schema";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("database", () => {
  it("creates the schema on an empty database", () => {
    const { db, close } = openDatabase(":memory:");
    expect(db.select().from(users).all()).toEqual([]);
    close();
  });

  it("promotes the single user of an older database to administrator (regression)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifebook-test-"));
    dirs.push(dir);
    const path = join(dir, "old.sqlite");
    // A database as the first version left it: only the first migration applied, one user.
    const folder = join(import.meta.dirname, "../drizzle");
    const first = readFileSync(join(folder, "0000_slimy_star_brand.sql"), "utf8");
    const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
    const old = new Database(path);
    for (const statement of first.split("--> statement-breakpoint")) old.exec(statement);
    old.exec(
      `CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`,
    );
    const hash = createHash("sha256").update(first).digest("hex");
    old
      .prepare(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`)
      .run(hash, journal.entries[0].when);
    old
      .prepare(
        `INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'me', 'x:y', '2026-01-01')`,
      )
      .run();
    old.close();

    const { db, close } = openDatabase(path);
    expect(db.select().from(users).all()).toMatchObject([{ username: "me", role: "admin" }]);
    close();
  });

  it("can be reopened: migrations are idempotent and data persists (regression)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifebook-test-"));
    dirs.push(dir);
    const path = join(dir, "test.sqlite");
    const first = openDatabase(path);
    first.db
      .insert(users)
      .values({ id: "u1", username: "me", passwordHash: "x:y", createdAt: "2026-01-01" })
      .run();
    first.close();
    const second = openDatabase(path);
    expect(
      second.db
        .select()
        .from(users)
        .all()
        .map((u) => u.username),
    ).toEqual(["me"]);
    second.close();
  });

  it("enforces foreign keys: a snapshot cannot point to a missing account", () => {
    const { db, close } = openDatabase(":memory:");
    let cause = "";
    try {
      db.run(
        sql`insert into snapshots (id, account_id, date, balance_cents, source) values ('s', 'nope', '2026-01-01', 1, 'manual')`,
      );
    } catch (error) {
      cause = String((error as Error & { cause?: Error }).cause?.message);
    }
    expect(cause).toMatch(/FOREIGN KEY/);
    close();
  });
});
