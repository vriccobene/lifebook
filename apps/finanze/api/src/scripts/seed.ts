import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildApp } from "../app";
import { openDatabase } from "../db/client";
import { DEMO_CREDENTIALS, seedDemoData } from "../seed";

/**
 * Loads fictional demo data into an EMPTY database. It never touches a database that already has a user.
 * Usage: LIFEBOOK_DB=data/demo.sqlite pnpm --filter @lifebook/finanze-api seed
 */
const dbPath = resolve(process.env.LIFEBOOK_DB ?? "data/demo.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const { db, close } = openDatabase(dbPath);
const app = await buildApp({ db });
try {
  const { lastReading } = await seedDemoData(app, new Date().toISOString().slice(0, 10));
  console.log(`Dati di esempio (fittizi) caricati in ${dbPath}, fino al ${lastReading}.`);
  console.log(
    `Accedi con  utente: ${DEMO_CREDENTIALS.username}  password: ${DEMO_CREDENTIALS.password}`,
  );
  console.log(
    `Avvia l'API su questo database:  LIFEBOOK_DB=${dbPath} pnpm --filter @lifebook/finanze-api start`,
  );
} catch (error) {
  console.error((error as Error).message);
  console.error(`File: ${dbPath}`);
  console.error(
    `Se contiene già i dati di esempio, accedi con  utente: ${DEMO_CREDENTIALS.username}  password: ${DEMO_CREDENTIALS.password}.`,
  );
  console.error(
    "Per ripartire da zero elimina quel file (e gli eventuali .sqlite-wal e .sqlite-shm accanto) e rilancia il comando.",
  );
  process.exitCode = 1;
} finally {
  await app.close();
  close();
}
