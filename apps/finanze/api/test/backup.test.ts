import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase, backupName } from "../src/backup";
import { openDatabase } from "../src/db/client";
import { users } from "../src/db/schema";

let dir: string;
let source: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lifebook-backup-"));
  source = join(dir, "live.sqlite");
  const { db, close } = openDatabase(source);
  db.insert(users)
    .values({ id: "u1", username: "me", passwordHash: "x:y", createdAt: "2026-01-01" })
    .run();
  close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const at = (s: string) => new Date(s);

describe("database backup", () => {
  it("creates a copy that opens with the same data", async () => {
    const { file } = await backupDatabase({
      source,
      destDir: join(dir, "backups"),
      now: at("2026-09-24T15:30:45"),
    });
    expect(file.endsWith("lifebook-20260924-153045.sqlite")).toBe(true);
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("select username from users").all()).toEqual([{ username: "me" }]);
    copy.close();
  });

  it("works while the database is open by another connection (the API keeps running)", async () => {
    const live = new Database(source);
    live.pragma("journal_mode = WAL");
    live
      .prepare(
        "insert into users (id, username, password_hash, created_at) values ('u2', 'two', 'x:y', '2026-01-02')",
      )
      .run();
    const { file } = await backupDatabase({ source, destDir: join(dir, "backups") });
    live.close();
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("select count(*) as n from users").get()).toEqual({ n: 2 });
    copy.close();
  });

  it("never overwrites an earlier backup made in the same second", async () => {
    const destDir = join(dir, "backups");
    const now = at("2026-09-24T15:30:45");
    const a = await backupDatabase({ source, destDir, now });
    const b = await backupDatabase({ source, destDir, now });
    expect(a.file).not.toBe(b.file);
    expect(readdirSync(destDir)).toHaveLength(2);
  });

  it("keeps only the newest backups and leaves other files alone", async () => {
    const destDir = join(dir, "backups");
    await backupDatabase({ source, destDir, now: at("2026-01-01T10:00:00"), keep: 2 });
    await backupDatabase({ source, destDir, now: at("2026-01-02T10:00:00"), keep: 2 });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(destDir, "notes.txt"), "keep me");
    const last = await backupDatabase({ source, destDir, now: at("2026-01-03T10:00:00"), keep: 2 });
    expect(last.removed).toHaveLength(1);
    expect(last.removed[0]!.endsWith(backupName(at("2026-01-01T10:00:00")))).toBe(true);
    expect(readdirSync(destDir).sort()).toEqual([
      backupName(at("2026-01-02T10:00:00")),
      backupName(at("2026-01-03T10:00:00")),
      "notes.txt",
    ]);
  });

  it("keeps everything when keep is 0", async () => {
    const destDir = join(dir, "backups");
    for (const day of ["01", "02", "03"])
      await backupDatabase({ source, destDir, now: at(`2026-01-${day}T10:00:00`), keep: 0 });
    expect(readdirSync(destDir)).toHaveLength(3);
  });

  it("fails clearly when the database does not exist, without creating a file", async () => {
    const destDir = join(dir, "backups");
    await expect(backupDatabase({ source: join(dir, "missing.sqlite"), destDir })).rejects.toThrow(
      /not found/i,
    );
    expect(existsSync(destDir)).toBe(false);
  });
});
