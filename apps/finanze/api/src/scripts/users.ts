import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../db/client";
import {
  UserAdminError,
  createUser,
  deleteUser,
  listUsers,
  makeAdmin,
  resetPassword,
} from "../userAdmin";

/**
 * Usage (also with the API running):
 *   pnpm --filter @lifebook/finanze-api users list
 *   pnpm --filter @lifebook/finanze-api users add <nome> [--password <pw>] [--admin]
 *   pnpm --filter @lifebook/finanze-api users remove <nome> --yes
 *   pnpm --filter @lifebook/finanze-api users reset-password <nome> [--password <nuova>]
 *   pnpm --filter @lifebook/finanze-api users make-admin <nome>
 */
const USAGE = `Uso:
  users list                                      elenca gli utenti
  users add <nome> [--password <pw>] [--admin]    crea un utente (password casuale se non indicata)
  users remove <nome> --yes                       elimina l'utente e tutti i suoi dati
  users reset-password <nome> [--password <pw>]   nuova password (casuale se non indicata)
  users make-admin <nome>                         rende l'utente amministratore`;

const dbPath = resolve(process.env.LIFEBOOK_DB ?? "data/lifebook.sqlite");
const [command, username] = process.argv
  .slice(2)
  .filter((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--password");
const flag = (name: string) => process.argv.includes(name);
const passwordIndex = process.argv.indexOf("--password");
const password = passwordIndex >= 0 ? process.argv[passwordIndex + 1] : undefined;

if (!existsSync(dbPath)) {
  console.error(`Database non trovato: ${dbPath}`);
  console.error("Indica il file con LIFEBOOK_DB=percorso/del/file.sqlite");
  process.exit(1);
}

const { db, close } = openDatabase(dbPath);
try {
  if (command === "list") {
    const all = listUsers(db);
    if (all.length === 0) console.log("Nessun utente: al primo accesso l'app chiede di crearlo.");
    for (const u of all)
      console.log(`${u.username.padEnd(24)} ${u.role === "admin" ? "amministratore" : "utente"}`);
  } else if (command === "add" && username) {
    const result = createUser(db, username, { password, admin: flag("--admin") });
    const role = result.role === "admin" ? "amministratore" : "utente";
    console.log(`Utente «${result.username}» creato (${role}).`);
    if (!password) console.log(`Password: ${result.password}`);
  } else if (command === "remove" && username) {
    if (!flag("--yes")) {
      console.error(`Elimina «${username}» e tutti i suoi dati: conferma aggiungendo --yes.`);
      process.exitCode = 1;
    } else
      console.log(`Utente «${deleteUser(db, username).username}» eliminato con tutti i suoi dati.`);
  } else if (command === "reset-password" && username) {
    const result = resetPassword(db, username, password);
    console.log(`Password di «${result.username}» reimpostata. Le sue sessioni sono state chiuse.`);
    if (!password) console.log(`Nuova password: ${result.password}`);
  } else if (command === "make-admin" && username) {
    console.log(`«${makeAdmin(db, username).username}» ora è amministratore.`);
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof UserAdminError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  close();
}
