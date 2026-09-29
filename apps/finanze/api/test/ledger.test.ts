import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshots } from "../src/db/schema";
import { createTestApp, setupUser, type Api, type TestApp } from "./helpers";

let t: TestApp;
let api: Api;
let accountId: string;
beforeEach(async () => {
  t = await createTestApp();
  api = (await setupUser(t.app)).api;
  accountId = (await api.post("/accounts", { name: "Broker", type: "brokerage" })).body.id;
});
afterEach(async () => {
  await t.close();
});

describe("snapshots", () => {
  it("creates a snapshot with the date chosen by the user, not today's", async () => {
    const res = await api.post("/snapshots", { accountId, date: "2019-03-31", balance: 1234.56 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      accountId,
      date: "2019-03-31",
      balance: 1234.56,
      source: "manual",
    });
  });

  it("stores money as integer cents and reads it back exactly (regression: float drift)", async () => {
    const { body } = await api.post("/snapshots", {
      accountId,
      date: "2026-01-31",
      balance: 0.1 + 0.2,
    });
    expect(body.balance).toBe(0.3);
    const row = t.db.select().from(snapshots).all()[0]!;
    expect(row.balanceCents).toBe(30);
    expect(Number.isInteger(row.balanceCents)).toBe(true);
    const big = await api.post("/snapshots", {
      accountId,
      date: "2026-02-28",
      balance: 1_234_567.89,
    });
    expect(big.body.balance).toBe(1_234_567.89);
  });

  it("accepts negative balances (liabilities)", async () => {
    const { body: loan } = await api.post("/accounts", { name: "Loan", type: "liability" });
    const res = await api.post("/snapshots", {
      accountId: loan.id,
      date: "2026-01-31",
      balance: -100_000,
    });
    expect(res.body.balance).toBe(-100_000);
  });

  it("accepts retroactive entries and lists them oldest first", async () => {
    await api.post("/snapshots", { accountId, date: "2026-03-31", balance: 3 });
    await api.post("/snapshots", { accountId, date: "2026-01-31", balance: 1 });
    await api.post("/snapshots", { accountId, date: "2026-02-28", balance: 2 });
    const list = await api.get("/snapshots");
    expect(list.body.map((s: { date: string }) => s.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("filters by account and date range", async () => {
    const other = (await api.post("/accounts", { name: "Other", type: "brokerage" })).body.id;
    for (const date of ["2026-01-31", "2026-02-28", "2026-03-31"]) {
      await api.post("/snapshots", { accountId, date, balance: 1 });
    }
    await api.post("/snapshots", { accountId: other, date: "2026-02-28", balance: 9 });
    expect((await api.get(`/snapshots?accountId=${other}`)).body).toHaveLength(1);
    expect(
      (await api.get(`/snapshots?accountId=${accountId}&from=2026-02-01&to=2026-03-01`)).body,
    ).toHaveLength(1);
    expect((await api.get("/snapshots?from=2026-02-28")).body).toHaveLength(3);
  });

  it("refuses a second snapshot for the same account and date", async () => {
    await api.post("/snapshots", { accountId, date: "2026-01-31", balance: 1 });
    const dup = await api.post("/snapshots", { accountId, date: "2026-01-31", balance: 2 });
    expect(dup.status).toBe(409);
    expect((await api.get("/snapshots")).body).toHaveLength(1);
  });

  it("edits a snapshot, moving it to another date unless that collides", async () => {
    const a = (await api.post("/snapshots", { accountId, date: "2026-01-31", balance: 1 })).body;
    const b = (await api.post("/snapshots", { accountId, date: "2026-02-28", balance: 2 })).body;
    const edited = await api.patch(`/snapshots/${a.id}`, { balance: 10.5, date: "2026-01-30" });
    expect(edited.body).toMatchObject({ balance: 10.5, date: "2026-01-30" });
    expect((await api.patch(`/snapshots/${a.id}`, { date: "2026-02-28" })).status).toBe(409);
    expect((await api.patch(`/snapshots/${b.id}`, { balance: 3 })).body.balance).toBe(3); // same date, itself
  });

  it("deletes a snapshot", async () => {
    const a = (await api.post("/snapshots", { accountId, date: "2026-01-31", balance: 1 })).body;
    expect((await api.delete(`/snapshots/${a.id}`)).status).toBe(200);
    expect((await api.get("/snapshots")).body).toEqual([]);
    expect((await api.delete(`/snapshots/${a.id}`)).status).toBe(404);
  });

  it("validates the input", async () => {
    expect(
      (await api.post("/snapshots", { accountId, date: "2026-02-30", balance: 1 })).status,
    ).toBe(400);
    expect(
      (await api.post("/snapshots", { accountId, date: "31/01/2026", balance: 1 })).status,
    ).toBe(400);
    expect(
      (await api.post("/snapshots", { accountId, date: "2026-01-31", balance: "1000" })).status,
    ).toBe(400);
    expect((await api.post("/snapshots", { accountId, balance: 1 })).status).toBe(400);
    expect(
      (await api.post("/snapshots", { accountId: "nope", date: "2026-01-31", balance: 1 })).status,
    ).toBe(404);
  });

  it("keeps the CSV source when given", async () => {
    const res = await api.post("/snapshots", {
      accountId,
      date: "2026-01-31",
      balance: 1,
      source: "csv",
    });
    expect(res.body.source).toBe("csv");
  });
});

describe("contributions", () => {
  it("creates, edits and deletes deposits and withdrawals with their own date", async () => {
    const dep = await api.post("/contributions", { accountId, date: "2026-01-15", amount: 500.25 });
    const wd = await api.post("/contributions", { accountId, date: "2026-02-10", amount: -200 });
    expect(dep.body.amount).toBe(500.25);
    expect(wd.body.amount).toBe(-200);
    const edited = await api.patch(`/contributions/${dep.body.id}`, {
      amount: 600,
      date: "2026-01-20",
    });
    expect(edited.body).toMatchObject({ amount: 600, date: "2026-01-20" });
    expect((await api.get("/contributions")).body).toHaveLength(2);
    expect((await api.delete(`/contributions/${wd.body.id}`)).status).toBe(200);
    expect((await api.get("/contributions")).body).toHaveLength(1);
    expect((await api.get("/contributions?from=2026-02-01")).body).toEqual([]);
  });

  it("allows several contributions on the same date", async () => {
    await api.post("/contributions", { accountId, date: "2026-01-15", amount: 100 });
    expect(
      (await api.post("/contributions", { accountId, date: "2026-01-15", amount: 50 })).status,
    ).toBe(201);
  });

  it("validates the input", async () => {
    expect((await api.post("/contributions", { accountId, date: "bad", amount: 1 })).status).toBe(
      400,
    );
    expect(
      (await api.post("/contributions", { accountId: "nope", date: "2026-01-15", amount: 1 }))
        .status,
    ).toBe(404);
  });
});
