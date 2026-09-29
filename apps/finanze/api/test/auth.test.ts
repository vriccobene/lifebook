import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tokens } from "../src/db/schema";
import { CREDENTIALS, client, createTestApp, setupUser, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe("first-run setup and login", () => {
  it("reports that setup is required until the user exists", async () => {
    const api = client(t.app);
    expect((await api.get("/auth/status")).body).toEqual({ setupRequired: true });
    await setupUser(t.app);
    expect((await api.get("/auth/status")).body).toEqual({ setupRequired: false });
  });

  it("allows the setup only once (a second user cannot be created)", async () => {
    await setupUser(t.app);
    const again = await client(t.app).post("/auth/setup", {
      username: "other",
      password: "another-password",
    });
    expect(again.status).toBe(409);
  });

  it("rejects a short password", async () => {
    const res = await client(t.app).post("/auth/setup", { username: "tester", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("logs in with the right password and refuses the wrong one", async () => {
    await setupUser(t.app);
    const ok = await client(t.app).post("/auth/login", CREDENTIALS);
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^lb_/);
    const bad = await client(t.app).post("/auth/login", {
      ...CREDENTIALS,
      password: "wrong-password",
    });
    expect(bad.status).toBe(401);
    const unknown = await client(t.app).post("/auth/login", {
      username: "nobody",
      password: "whatever-pass",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(bad.body); // same answer: no user enumeration
  });
});

describe("token authentication", () => {
  it("requires a bearer token on every data route", async () => {
    await setupUser(t.app);
    const anonymous = client(t.app);
    for (const path of [
      "/accounts",
      "/snapshots",
      "/contributions",
      "/income-items",
      "/essential-spending",
      "/settings",
      "/results/methods",
      "/results/verdict",
      "/results/living-cost",
      "/results/returns",
      "/auth/me",
    ]) {
      expect((await anonymous.get(path)).status, path).toBe(401);
    }
  });

  it("rejects an unknown token", async () => {
    await setupUser(t.app);
    expect((await client(t.app, "lb_not-a-real-token").get("/accounts")).status).toBe(401);
  });

  it("expires session tokens after 30 days but not API tokens", async () => {
    const { api } = await setupUser(t.app);
    const created = await api.post("/auth/tokens", { name: "script" });
    const apiToken = created.body.token as string;
    t.clock.current = new Date("2027-02-15T00:00:00Z");
    expect((await api.get("/accounts")).status).toBe(401);
    expect((await client(t.app, apiToken).get("/accounts")).status).toBe(200);
  });

  it("creates, lists and revokes API tokens, showing the secret only once", async () => {
    const { api } = await setupUser(t.app);
    const created = await api.post("/auth/tokens", { name: "home-assistant" });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    expect((await client(t.app, token).get("/auth/me")).body.username).toBe("tester");

    const list = await api.get("/auth/tokens");
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty("token");
    expect(list.body[0].lastUsedAt).not.toBeNull();

    expect((await api.delete(`/auth/tokens/${created.body.id}`)).status).toBe(200);
    expect((await client(t.app, token).get("/accounts")).status).toBe(401);
    expect((await api.delete(`/auth/tokens/${created.body.id}`)).status).toBe(404);
  });

  it("stores tokens hashed, never in clear text (regression)", async () => {
    const { token } = await setupUser(t.app);
    const rows = t.db.select().from(tokens).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tokenHash).not.toBe(token);
      expect(JSON.stringify(row)).not.toContain(token);
    }
  });

  it("invalidates the session on logout", async () => {
    const { api } = await setupUser(t.app);
    expect((await api.post("/auth/logout")).status).toBe(200);
    expect((await api.get("/accounts")).status).toBe(401);
  });

  it("does not let a session token be listed or revoked as an API token", async () => {
    const { api } = await setupUser(t.app);
    expect((await api.get("/auth/tokens")).body).toEqual([]);
  });

  it("answers the health check without a token", async () => {
    const res = await t.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});
