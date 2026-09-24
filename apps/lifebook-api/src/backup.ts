import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PREFIX = "lifebook-";
const SUFFIX = ".sqlite";
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `lifebook-20260924-153045.sqlite` (local time, so the files sort by date). */
export function backupName(now: Date, attempt = 0): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${PREFIX}${stamp}${attempt > 0 ? `-${attempt}` : ""}${SUFFIX}`;
}

export interface BackupOptions {
  /** The live database file. */
  source: string;
  destDir: string;
  /** How many backups to keep. Older ones are deleted; 0 keeps everything. */
  keep?: number;
  now?: Date;
}

export interface BackupResult {
  file: string;
  removed: string[];
}

/**
 * Consistent copy of a live SQLite database (SQLite's online backup, safe while the API is running),
 * followed by the removal of the oldest backups beyond `keep`. Only files made by this function are touched.
 */
export async function backupDatabase(options: BackupOptions): Promise<BackupResult> {
  const { source, destDir, keep = 30, now = new Date() } = options;
  if (!existsSync(source)) throw new Error(`Database not found: ${source}`);
  mkdirSync(destDir, { recursive: true });

  let attempt = 0;
  let file = join(destDir, backupName(now));
  while (existsSync(file)) file = join(destDir, backupName(now, ++attempt));

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(file);
  } finally {
    db.close();
  }

  const ours = readdirSync(destDir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .sort();
  const removed = keep > 0 ? ours.slice(0, Math.max(0, ours.length - keep)) : [];
  for (const name of removed) rmSync(join(destDir, name));
  return { file, removed: removed.map((name) => join(destDir, name)) };
}
