import { resolve } from "node:path";
import { backupDatabase } from "../backup";

/** Usage: pnpm --filter @lifebook/api backup [--dest DIR] [--keep N] */
function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const source = resolve(process.env.LIFEBOOK_DB ?? "data/lifebook.sqlite");
const destDir = resolve(option("dest", "backups"));
const keep = Number(option("keep", "30"));

try {
  const { file, removed } = await backupDatabase({ source, destDir, keep });
  console.log(`Backup creato: ${file}`);
  if (removed.length > 0)
    console.log(`Eliminati ${removed.length} backup più vecchi (se ne tengono ${keep}).`);
} catch (error) {
  console.error(`Backup non riuscito: ${(error as Error).message}`);
  process.exit(1);
}
