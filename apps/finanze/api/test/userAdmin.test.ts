import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  UserAdminError,
  createUser,
  deleteUser,
  listUsers,
  makeAdmin,
  resetPassword,
} from "../src/userAdmin";
import { CREDENTIALS, addUser, client, createTestApp, setupUser, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const login = (username: string, password: string) =>
  client(t.app).post("/auth/login", { username, password });

describe("password recovery from the command line", () => {
  it("resets a forgotten password, even the only administrator's (regression)", async () => {
    const { api } = await setupUser(t.app);
    const result = resetPassword(t.db, "TESTER", "recovered-password");
    expect(result).toEqual({ username: "tester", password: "recovered-password" });
    expect((await login("tester", "recovered-password")).status).toBe(200);
    expect((await login("tester", CREDENTIALS.password)).status).toBe(401);
    expect((await api.get("/accounts")).status).toBe(401); // old sessions are closed
  });

  it("generates a random password when none is given", async () => {
    await setupUser(t.app);
    const a = resetPassword(t.db, "tester");
    expect(a.password).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect((await login("tester", a.password)).status).toBe(200);
    expect(resetPassword(t.db, "tester").password).not.toBe(a.password);
  });

  it("refuses an unknown user and a short password", async () => {
    await setupUser(t.app);
    expect(() => resetPassword(t.db, "nobody", "whatever-pass")).toThrow(UserAdminError);
    expect(() => resetPassword(t.db, "tester", "short")).toThrow(/almeno 8/);
  });

  it("lists the users and gives back the administrator role", async () => {
    const { api } = await setupUser(t.app);
    const anna = await addUser(t.app, api, "anna");
    expect(listUsers(t.db).map((u) => [u.username, u.role])).toEqual([
      ["tester", "admin"],
      ["anna", "user"],
    ]);
    makeAdmin(t.db, "anna");
    expect((await anna.api.get("/users")).status).toBe(200);
  });
});

describe("user management from the command line", () => {
  it("creates a user who can log in, with a random password when none is given", async () => {
    await setupUser(t.app);
    expect(createUser(t.db, " anna ", { password: "anna-password" })).toEqual({
      username: "anna",
      password: "anna-password",
      role: "user",
    });
    expect((await login("anna", "anna-password")).status).toBe(200);
    const bob = createUser(t.db, "bob", { admin: true });
    expect(bob.password).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const session = await login("bob", bob.password);
    expect((await client(t.app, session.body.token).get("/users")).status).toBe(200);
  });

  it("refuses a duplicate name (any case), an empty name and a short password", async () => {
    await setupUser(t.app);
    expect(() => createUser(t.db, "TESTER", { password: "whatever-pass" })).toThrow(/esiste già/);
    expect(() => createUser(t.db, "  ", { password: "whatever-pass" })).toThrow(UserAdminError);
    expect(() => createUser(t.db, "anna", { password: "short" })).toThrow(/almeno 8/);
  });

  it("deletes a user with their data, but never the last administrator", async () => {
    const { api } = await setupUser(t.app);
    const anna = await addUser(t.app, api, "anna");
    expect(deleteUser(t.db, "ANNA")).toEqual({ username: "anna" });
    expect((await anna.api.get("/accounts")).status).toBe(401);
    expect(listUsers(t.db).map((u) => u.username)).toEqual(["tester"]);
    expect(() => deleteUser(t.db, "tester")).toThrow(/unico amministratore/);
    expect(() => deleteUser(t.db, "nobody")).toThrow(UserAdminError);
  });
});
