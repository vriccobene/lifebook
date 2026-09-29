import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import {
  CREDENTIALS,
  addUser,
  client,
  createTestApp,
  seedLife,
  setupUser,
  type Api,
  type TestApp,
} from "./helpers";

let t: TestApp;
let admin: Api;
beforeEach(async () => {
  t = await createTestApp();
  admin = (await setupUser(t.app)).api;
});
afterEach(async () => {
  await t.close();
});

describe("roles", () => {
  it("makes the first user an administrator and the others plain users", async () => {
    expect((await admin.get("/auth/me")).body).toMatchObject({ username: "tester", role: "admin" });
    const { api } = await addUser(t.app, admin, "anna");
    expect((await api.get("/auth/me")).body).toMatchObject({ username: "anna", role: "user" });
  });

  it("keeps the setup closed once the first user exists", async () => {
    await addUser(t.app, admin, "anna");
    const res = await client(t.app).post("/auth/setup", {
      username: "intruder",
      password: "intruder-password",
    });
    expect(res.status).toBe(409);
  });

  it("forbids user management to non-administrators (regression)", async () => {
    const { api, id } = await addUser(t.app, admin, "anna");
    expect((await api.get("/users")).status).toBe(403);
    expect(
      (await api.post("/users", { username: "sneaky", password: "sneaky-password" })).status,
    ).toBe(403);
    expect((await api.patch(`/users/${id}`, { role: "admin" })).status).toBe(403);
    const me = (await admin.get("/auth/me")).body.userId as string;
    expect((await api.delete(`/users/${me}`)).status).toBe(403);
    expect((await admin.get("/users")).body).toHaveLength(2);
  });

  it("applies a role change to tokens already issued", async () => {
    const anna = await addUser(t.app, admin, "anna");
    expect((await anna.api.get("/users")).status).toBe(403);
    await admin.patch(`/users/${anna.id}`, { role: "admin" });
    expect((await anna.api.get("/users")).status).toBe(200);
  });

  it("always keeps at least one administrator", async () => {
    const me = (await admin.get("/auth/me")).body.userId as string;
    expect((await admin.patch(`/users/${me}`, { role: "user" })).status).toBe(409);
    const anna = await addUser(t.app, admin, "anna", "admin");
    expect((await admin.patch(`/users/${me}`, { role: "user" })).status).toBe(200);
    expect((await anna.api.patch(`/users/${anna.id}`, { role: "user" })).status).toBe(409);
  });
});

describe("user management", () => {
  it("creates users with unique names, ignoring case and spaces", async () => {
    const created = await admin.post("/users", { username: " anna ", password: "anna-password" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ username: "anna", role: "user" });
    expect(created.body).not.toHaveProperty("passwordHash");
    expect(
      (await admin.post("/users", { username: "ANNA", password: "other-password" })).status,
    ).toBe(409);
    expect((await admin.post("/users", { username: "bob", password: "short" })).status).toBe(400);
  });

  it("lists users without their password hashes", async () => {
    await addUser(t.app, admin, "anna");
    const list = (await admin.get("/users")).body;
    expect(list.map((u: { username: string }) => u.username)).toEqual(["tester", "anna"]);
    expect(JSON.stringify(list)).not.toContain("password");
  });

  it("resets a password, closing the sessions but not the API tokens", async () => {
    const anna = await addUser(t.app, admin, "anna");
    const apiToken = (await anna.api.post("/auth/tokens", { name: "script" })).body.token;
    expect(
      (await admin.patch(`/users/${anna.id}`, { password: "brand-new-password" })).status,
    ).toBe(200);
    expect((await anna.api.get("/accounts")).status).toBe(401);
    expect((await client(t.app, apiToken).get("/accounts")).status).toBe(200);
    const login = await client(t.app).post("/auth/login", {
      username: "anna",
      password: "brand-new-password",
    });
    expect(login.status).toBe(200);
    expect(
      (await client(t.app).post("/auth/login", { username: "anna", password: anna.password }))
        .status,
    ).toBe(401);
  });

  it("deletes a user with all their data, but not yourself", async () => {
    const anna = await addUser(t.app, admin, "anna");
    await seedLife(anna.api, { months: 2 });
    await anna.api.post("/contributions", {
      accountId: (await anna.api.get("/accounts")).body[1].id,
      date: "2026-01-15",
      amount: 100,
    });
    await anna.api.post("/essential-spending", {
      mode: "percent",
      value: 50,
      validFrom: "2026-01-01",
    });
    await anna.api.post("/settings", { validFrom: "2026-01-01", currentAge: 40 });
    await seedLife(admin, { months: 1 });

    expect((await admin.delete(`/users/${anna.id}`)).status).toBe(200);
    expect((await anna.api.get("/accounts")).status).toBe(401);
    expect((await admin.get("/users")).body).toHaveLength(1);
    const me = (await admin.get("/auth/me")).body.userId as string;
    const owners = [
      ...t.db.select().from(schema.accounts).all(),
      ...t.db.select().from(schema.incomeItems).all(),
      ...t.db.select().from(schema.essentialSpending).all(),
      ...t.db.select().from(schema.settingsEntries).all(),
    ].map((row) => row.ownerId);
    expect(new Set(owners)).toEqual(new Set([me]));
    expect(t.db.select().from(schema.contributions).all()).toHaveLength(0);
    expect(t.db.select().from(schema.snapshots).all()).toHaveLength(8); // the admin's 4 accounts × 2

    expect((await admin.delete(`/users/${me}`)).status).toBe(409);
    expect((await admin.delete(`/users/${anna.id}`)).status).toBe(404);
  });
});

describe("password change", () => {
  it("needs the current password, then closes the other sessions only", async () => {
    const other = client(t.app, (await client(t.app).post("/auth/login", CREDENTIALS)).body.token);
    const wrong = await admin.post("/auth/password", {
      currentPassword: "not-my-password",
      newPassword: "next-password-123",
    });
    expect(wrong.status).toBe(400);
    expect(
      (
        await admin.post("/auth/password", {
          currentPassword: CREDENTIALS.password,
          newPassword: "short",
        })
      ).status,
    ).toBe(400);
    const ok = await admin.post("/auth/password", {
      currentPassword: CREDENTIALS.password,
      newPassword: "next-password-123",
    });
    expect(ok.status).toBe(200);
    expect((await admin.get("/accounts")).status).toBe(200);
    expect((await other.get("/accounts")).status).toBe(401);
    expect((await client(t.app).post("/auth/login", CREDENTIALS)).status).toBe(401);
  });
});

describe("isolation between users (regression)", () => {
  it("scopes every data route to the caller, administrators included", async () => {
    const anna = await addUser(t.app, admin, "anna");
    const { bro } = await seedLife(anna.api, { months: 2 });
    const contribution = (
      await anna.api.post("/contributions", { accountId: bro, date: "2026-01-15", amount: 100 })
    ).body;
    const income = (await anna.api.get("/income-items")).body[0];
    const essential = (
      await anna.api.post("/essential-spending", {
        mode: "percent",
        value: 50,
        validFrom: "2026-01-01",
      })
    ).body;
    const setting = (await anna.api.post("/settings", { validFrom: "2026-01-01", currentAge: 40 }))
      .body;
    const token = (await anna.api.post("/auth/tokens", { name: "script" })).body;

    // The administrator sees none of it.
    expect((await admin.get("/accounts")).body).toEqual([]);
    expect((await admin.get("/snapshots")).body).toEqual([]);
    expect((await admin.get("/contributions")).body).toEqual([]);
    expect((await admin.get("/income-items")).body).toEqual([]);
    expect((await admin.get("/essential-spending")).body).toEqual([]);
    expect((await admin.get("/settings")).body.entries).toEqual([]);
    expect((await admin.get("/auth/tokens")).body).toEqual([]);
    expect((await admin.get("/results/net-worth")).body.netWorth).toBe(0);

    // And cannot touch it.
    expect((await admin.get(`/accounts/${bro}`)).status).toBe(404);
    expect((await admin.patch(`/contributions/${contribution.id}`, { amount: 1 })).status).toBe(
      404,
    );
    expect((await admin.delete(`/income-items/${income.id}`)).status).toBe(404);
    expect((await admin.delete(`/essential-spending/${essential.id}`)).status).toBe(404);
    expect((await admin.delete(`/settings/${setting.id}`)).status).toBe(404);
    expect((await admin.delete(`/auth/tokens/${token.id}`)).status).toBe(404);

    // Anna's data is intact.
    expect((await anna.api.get("/accounts")).body).toHaveLength(4);
    expect((await anna.api.get("/contributions")).body).toHaveLength(1);
    expect((await anna.api.get("/income-items")).body).toHaveLength(1);
  });
});
