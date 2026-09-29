import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildApp } from "./app";
import { loadSecretKey } from "./auth/secretBox";
import { openDatabase } from "./db/client";

const dbPath = resolve(process.env.LIFEBOOK_DB ?? "data/lifebook.sqlite");
const port = Number(process.env.PORT ?? 3000);
// Local only by default: nothing financial should be reachable from the network.
const host = process.env.HOST ?? "127.0.0.1";

mkdirSync(dirname(dbPath), { recursive: true });
const { db, close } = openDatabase(dbPath);
// Encrypts the Firefly III tokens. Kept next to the database but not inside it, so backups hold no secret.
const secretKey = loadSecretKey(process.env.LIFEBOOK_SECRET_KEY_FILE ?? `${dbPath}.key`);
const app = await buildApp({ db, logger: true, firefly: { secretKey } });

const shutdown = async () => {
  await app.close();
  close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host });
