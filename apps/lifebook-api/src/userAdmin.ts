import { and, eq, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "./auth/crypto";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { tokens, users } from "./db/schema";

/*
 * Recovery from the command line, for whoever has access to the database file (and so to all the data
 * anyway): create or delete users, reset a forgotten password or give back the administrator role, with no
 * need to log in.
 */

/** Deletes a user and everything they entered. Accounts cascade to their params, snapshots and contributions. */
export function deleteUserAndData(db: Db, userId: string): void {
  db.transaction((tx) => {
    tx.delete(t.fireflyLinks).where(eq(t.fireflyLinks.userId, userId)).run();
    tx.delete(t.accounts).where(eq(t.accounts.ownerId, userId)).run();
    tx.delete(t.incomeItems).where(eq(t.incomeItems.ownerId, userId)).run();
    tx.delete(t.essentialSpending).where(eq(t.essentialSpending.ownerId, userId)).run();
    tx.delete(t.settingsEntries).where(eq(t.settingsEntries.ownerId, userId)).run();
    // Tokens and the Firefly connection cascade from the user.
    tx.delete(t.users).where(eq(t.users.id, userId)).run();
  });
}

export const MIN_PASSWORD_LENGTH = 8;

export class UserAdminError extends Error {}

function findUser(db: Db, username: string) {
  const user = db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username.trim()})`)
    .get();
  if (!user) throw new UserAdminError(`Utente «${username}» non trovato.`);
  return user;
}

export function listUsers(db: Db) {
  return db
    .select({ username: users.username, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(users.createdAt)
    .all();
}

/** A random password that is easy to copy: 16 characters, letters, digits, `-` and `_`. */
export const generatePassword = () => randomBytes(12).toString("base64url");

/**
 * Sets a new password (a random one when none is given) and closes the user's sessions. API tokens stay
 * valid, as with a reset from the web app.
 */
export function resetPassword(
  db: Db,
  username: string,
  password: string = generatePassword(),
): { username: string; password: string } {
  checkPassword(password);
  const user = findUser(db, username);
  db.transaction((tx) => {
    tx.update(users)
      .set({ passwordHash: hashPassword(password) })
      .where(eq(users.id, user.id))
      .run();
    tx.delete(tokens)
      .where(and(eq(tokens.userId, user.id), eq(tokens.kind, "session")))
      .run();
  });
  return { username: user.username, password };
}

/** Gives the administrator role back, e.g. when nobody who can manage users remembers their password. */
export function makeAdmin(db: Db, username: string): { username: string } {
  const user = findUser(db, username);
  db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).run();
  return { username: user.username };
}

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new UserAdminError(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`);
}

/** Creates a user (a random password when none is given), as an administrator does from the web app. */
export function createUser(
  db: Db,
  username: string,
  {
    password = generatePassword(),
    admin = false,
  }: { password?: string | undefined; admin?: boolean } = {},
): { username: string; password: string; role: "admin" | "user" } {
  const name = username.trim();
  if (!name || name.length > 64)
    throw new UserAdminError("Il nome utente deve avere da 1 a 64 caratteri.");
  checkPassword(password);
  const taken = db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${name})`)
    .get();
  if (taken) throw new UserAdminError(`L'utente «${name}» esiste già.`);
  const role = admin ? "admin" : "user";
  db.insert(users)
    .values({
      id: randomUUID(),
      username: name,
      passwordHash: hashPassword(password),
      role,
      createdAt: new Date().toISOString(),
    })
    .run();
  return { username: name, password, role };
}

/** Deletes a user and all their data. The last administrator cannot be deleted. */
export function deleteUser(db: Db, username: string): { username: string } {
  const user = findUser(db, username);
  if (user.role === "admin") {
    const admins = db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).all();
    if (admins.length === 1)
      throw new UserAdminError(
        `«${user.username}» è l'unico amministratore: non può essere eliminato.`,
      );
  }
  deleteUserAndData(db, user.id);
  return { username: user.username };
}
