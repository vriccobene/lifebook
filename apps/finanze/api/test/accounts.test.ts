import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountParams, accounts } from "../src/db/schema";
import { addUser, createTestApp, setupUser, type Api, type TestApp } from "./helpers";

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await createTestApp();
  api = (await setupUser(t.app)).api;
});
afterEach(async () => {
  await t.close();
});

describe("accounts", () => {
  it("creates an account with the defaults of its type", async () => {
    const deposit = await api.post("/accounts", { name: "Deposit", type: "deposit" });
    expect(deposit.status).toBe(201);
    expect(deposit.body).toMatchObject({
      contributionsMode: "inferred",
      countsAsLivingCost: true,
      archivedAt: null,
      institution: null,
      realEstateUse: null,
      params: [],
    });
    const broker = await api.post("/accounts", {
      name: "Broker",
      type: "brokerage",
      institution: "Acme",
    });
    expect(broker.body.contributionsMode).toBe("declared");
    expect(broker.body.institution).toBe("Acme");
  });

  it("requires the use of a real estate account, and only for real estate", async () => {
    expect((await api.post("/accounts", { name: "Flat", type: "real_estate" })).status).toBe(400);
    expect(
      (await api.post("/accounts", { name: "Broker", type: "brokerage", realEstateUse: "income" }))
        .status,
    ).toBe(400);
    expect(
      (await api.post("/accounts", { name: "Flat", type: "real_estate", realEstateUse: "income" }))
        .status,
    ).toBe(201);
  });

  it("rejects an unknown type and an empty name", async () => {
    expect((await api.post("/accounts", { name: "X", type: "crypto" })).status).toBe(400);
    expect((await api.post("/accounts", { name: "", type: "checking" })).status).toBe(400);
  });

  it("stores the initial dated parameters and returns them in euro", async () => {
    const res = await api.post("/accounts", {
      name: "Mortgage",
      type: "liability",
      params: [
        {
          validFrom: "2026-01-01",
          monthlyPayment: 450.55,
          interestRate: 0.03,
          paymentEndDate: "2040-01-31",
        },
      ],
    });
    expect(res.body.params[0]).toMatchObject({
      validFrom: "2026-01-01",
      monthlyPayment: 450.55,
      interestRate: 0.03,
      paymentEndDate: "2040-01-31",
    });
  });

  it("stores the value of a property in cents and counts it in the net worth (regression)", async () => {
    const res = await api.post("/accounts", {
      name: "Holywell",
      type: "real_estate",
      realEstateUse: "income",
      params: [{ validFrom: "2026-01-01", propertyValue: 370_000.5 }],
    });
    expect(res.body.params[0].propertyValue).toBe(370_000.5);
    const [row] = t.db.select().from(accountParams).all();
    expect(JSON.parse(row!.patch).propertyValue).toBe(37_000_050);
    await api.post("/snapshots", { accountId: res.body.id, date: "2026-01-31", balance: 1_000 });
    const netWorth = (await api.get("/results/net-worth?asOf=2026-01-31")).body.netWorth;
    expect(netWorth).toBe(371_000.5);
  });

  it("updates, archives and lists archived accounts", async () => {
    const { body } = await api.post("/accounts", { name: "Old", type: "brokerage" });
    const patched = await api.patch(`/accounts/${body.id}`, {
      name: "Renamed",
      archivedAt: "2026-06-30",
    });
    expect(patched.body).toMatchObject({ name: "Renamed", archivedAt: "2026-06-30" });
    const list = await api.get("/accounts");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].archivedAt).toBe("2026-06-30");
    const restored = await api.patch(`/accounts/${body.id}`, { archivedAt: null });
    expect(restored.body.archivedAt).toBeNull();
  });

  it("does not let real estate lose its use through an update", async () => {
    const { body } = await api.post("/accounts", {
      name: "Flat",
      type: "real_estate",
      realEstateUse: "income",
    });
    expect((await api.patch(`/accounts/${body.id}`, { realEstateUse: null })).status).toBe(400);
  });

  it("rejects unknown fields in an update", async () => {
    const { body } = await api.post("/accounts", { name: "A", type: "brokerage" });
    expect((await api.patch(`/accounts/${body.id}`, { owner: "x" })).status).toBe(400);
  });

  it("edits every property after creation, the type included", async () => {
    const { body } = await api.post("/accounts", { name: "A", type: "brokerage" });
    const edited = await api.patch(`/accounts/${body.id}`, {
      name: "B",
      institution: "Bank",
      type: "liability",
      contributionsMode: "inferred",
      countsAsLivingCost: false,
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      name: "B",
      institution: "Bank",
      type: "liability",
      contributionsMode: "inferred",
      countsAsLivingCost: false,
    });
  });

  it("keeps the real estate use consistent when the type changes", async () => {
    const { body } = await api.post("/accounts", { name: "A", type: "brokerage" });
    const path = `/accounts/${body.id}`;
    expect((await api.patch(path, { type: "real_estate" })).status).toBe(400);
    const flat = await api.patch(path, { type: "real_estate", realEstateUse: "income" });
    expect(flat.body).toMatchObject({ type: "real_estate", realEstateUse: "income" });
    const back = await api.patch(path, { type: "deposit" });
    expect(back.body).toMatchObject({ type: "deposit", realEstateUse: null });
  });

  it("deletes an account without data but refuses one with data (regression: no silent data loss)", async () => {
    const empty = await api.post("/accounts", { name: "Empty", type: "brokerage" });
    expect((await api.delete(`/accounts/${empty.body.id}`)).status).toBe(200);
    expect((await api.get(`/accounts/${empty.body.id}`)).status).toBe(404);

    const used = await api.post("/accounts", { name: "Used", type: "brokerage" });
    await api.post("/snapshots", { accountId: used.body.id, date: "2026-01-31", balance: 100 });
    expect((await api.delete(`/accounts/${used.body.id}`)).status).toBe(409);
    expect((await api.get(`/accounts/${used.body.id}`)).status).toBe(200);
  });

  it("returns 404 for an unknown account", async () => {
    expect((await api.get("/accounts/nope")).status).toBe(404);
  });
});

describe("dated account parameters", () => {
  it("adds, edits and deletes entries, retroactive ones included", async () => {
    const { body: account } = await api.post("/accounts", { name: "Dep", type: "deposit" });
    const base = `/accounts/${account.id}/params`;
    const later = await api.post(base, { validFrom: "2026-06-01", taxRate: 0.125 });
    const earlier = await api.post(base, {
      validFrom: "2025-01-01",
      taxRate: 0.26,
      interestRate: 0.02,
    });
    expect(later.status).toBe(201);
    expect(
      (await api.get(base)).body.map((e: { validFrom: string }) => e.validFrom).sort(),
    ).toEqual(["2025-01-01", "2026-06-01"]);

    const edited = await api.patch(`${base}/${later.body.id}`, {
      taxRate: 0.2,
      validFrom: "2026-07-01",
    });
    expect(edited.body).toMatchObject({ taxRate: 0.2, validFrom: "2026-07-01" });
    expect((await api.delete(`${base}/${earlier.body.id}`)).status).toBe(200);
    expect((await api.get(base)).body).toHaveLength(1);
    expect((await api.delete(`${base}/${earlier.body.id}`)).status).toBe(404);
  });

  it("keeps the fields an edit does not mention", async () => {
    const { body: account } = await api.post("/accounts", { name: "Dep", type: "deposit" });
    const entry = await api.post(`/accounts/${account.id}/params`, {
      validFrom: "2026-01-01",
      taxRate: 0.26,
      monthlyPayment: 100.1,
    });
    const edited = await api.patch(`/accounts/${account.id}/params/${entry.body.id}`, {
      taxRate: 0.1,
    });
    expect(edited.body).toMatchObject({ taxRate: 0.1, monthlyPayment: 100.1 });
  });

  it("replaces an entry, dropping the fields it no longer has", async () => {
    const { body: account } = await api.post("/accounts", { name: "Dep", type: "deposit" });
    const base = `/accounts/${account.id}/params`;
    const entry = await api.post(base, {
      validFrom: "2026-01-01",
      taxRate: 0.26,
      interestRate: 0.02,
    });
    const replaced = await api.put(`${base}/${entry.body.id}`, {
      validFrom: "2026-02-01",
      taxRate: 0.125,
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body).toEqual({ id: entry.body.id, validFrom: "2026-02-01", taxRate: 0.125 });
    expect((await api.get(base)).body).toEqual([replaced.body]);
  });

  it("validates rates and dates", async () => {
    const { body: account } = await api.post("/accounts", { name: "Dep", type: "deposit" });
    const base = `/accounts/${account.id}/params`;
    expect((await api.post(base, { validFrom: "2026-01-01", taxRate: 1.5 })).status).toBe(400);
    expect((await api.post(base, { validFrom: "2026-02-30" })).status).toBe(400);
    expect((await api.post(base, { taxRate: 0.1 })).status).toBe(400);
    expect((await api.post(base, { validFrom: "2026-01-01", colour: "red" })).status).toBe(400);
  });
});

describe("ownership", () => {
  it("never shows another user's data (regression)", async () => {
    const { body: mine } = await api.post("/accounts", { name: "Mine", type: "brokerage" });
    await api.post("/snapshots", { accountId: mine.id, date: "2026-01-31", balance: 5 });

    const { api: other } = await addUser(t.app, api, "other");

    expect((await other.get("/accounts")).body).toEqual([]);
    expect((await other.get(`/accounts/${mine.id}`)).status).toBe(404);
    expect((await other.patch(`/accounts/${mine.id}`, { name: "Stolen" })).status).toBe(404);
    expect((await other.delete(`/accounts/${mine.id}`)).status).toBe(404);
    expect((await other.get("/snapshots")).body).toEqual([]);
    expect((await other.get(`/snapshots?accountId=${mine.id}`)).status).toBe(404);
    expect(
      (await other.post("/snapshots", { accountId: mine.id, date: "2026-02-28", balance: 1 }))
        .status,
    ).toBe(404);
    expect((await other.get("/results/verdict")).body.verdict.status).toBe("missing_data");
    expect(t.db.select().from(accounts).all()).toHaveLength(1);
  });
});

describe("pension fund accounts", () => {
  it("can be created, with declared contributions by default", async () => {
    const res = await api.post("/accounts", { name: "Fondo pensione", type: "pension_fund" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: "pension_fund",
      contributionsMode: "declared",
      realEstateUse: null,
    });
  });

  it("takes part in the results as its own type and stays out of the investable capital (regression)", async () => {
    const fund = (await api.post("/accounts", { name: "Fondo", type: "pension_fund" })).body.id;
    const broker = (await api.post("/accounts", { name: "Titoli", type: "brokerage" })).body.id;
    await api.post("/snapshots", { accountId: fund, date: "2026-01-31", balance: 30_000 });
    await api.post("/snapshots", { accountId: broker, date: "2026-01-31", balance: 10_000 });
    const worth = (await api.get("/results/net-worth?asOf=2026-01-31")).body;
    expect(worth.netWorth).toBe(40_000);
    expect(worth.netWorthByType.pension_fund).toBe(30_000);
    expect(worth.investableGross).toBe(10_000);
  });
});
