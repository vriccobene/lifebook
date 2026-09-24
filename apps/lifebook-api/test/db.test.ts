import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
