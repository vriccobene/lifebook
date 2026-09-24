import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { essentialSpending } from "../src/db/schema";
import { createTestApp, setupUser, type Api, type TestApp } from "./helpers";

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await createTestApp();
  api = (await setupUser(t.app)).api;
});
afterEach(async () => {
  await t.close();
});

describe("income items", () => {
  it("handles a recurring item with periodicity and an end date", async () => {
    const res = await api.post("/income-items", {
      name: "Salary",
      kind: "recurring",
      amount: 2100.5,
      periodicity: "monthly",
      startDate: "2026-01-31",
      endDate: "2027-12-31",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "recurring",
      amount: 2100.5,
      periodicity: "monthly",
      endDate: "2027-12-31",
    });
  });

  it("handles a one-off item and open-ended recurring items", async () => {
    const bonus = await api.post("/income-items", {
      name: "Bonus",
      kind: "one_off",
      amount: 1000,
      date: "2026-06-30",
    });
    expect(bonus.body).toMatchObject({ kind: "one_off", date: "2026-06-30" });
    const thirteenth = await api.post("/income-items", {
      name: "13th",
      kind: "recurring",
      amount: 2000,
      periodicity: "yearly",
      startDate: "2026-12-15",
    });
    expect(thirteenth.body.endDate).toBeNull();
  });

  it("replaces and deletes an item, including switching its kind", async () => {
    const { body } = await api.post("/income-items", {
      name: "X",
      kind: "one_off",
      amount: 1,
      date: "2026-01-01",
    });
    const replaced = await api.put(`/income-items/${body.id}`, {
      name: "X",
      kind: "recurring",
      amount: 5,
      periodicity: "quarterly",
      startDate: "2026-01-01",
    });
    expect(replaced.body).toMatchObject({ kind: "recurring", periodicity: "quarterly" });
    expect(replaced.body).not.toHaveProperty("date");
    expect((await api.delete(`/income-items/${body.id}`)).status).toBe(200);
    expect((await api.get("/income-items")).body).toEqual([]);
    expect(
      (
        await api.put(`/income-items/${body.id}`, {
          name: "X",
          kind: "one_off",
          amount: 1,
          date: "2026-01-01",
        })
      ).status,
    ).toBe(404);
  });

  it("validates the input", async () => {
    expect(
      (
        await api.post("/income-items", {
          name: "X",
          kind: "recurring",
          amount: 1,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (await api.post("/income-items", { name: "X", kind: "one_off", amount: 1 })).status,
    ).toBe(400);
    expect((await api.post("/income-items", { name: "X", kind: "weekly", amount: 1 })).status).toBe(
      400,
    );
  });
});

describe("essential spending", () => {
  it("accepts the three modes", async () => {
    const pct = await api.post("/essential-spending", {
      mode: "percent",
      value: 60,
      validFrom: "2026-01-01",
    });
    const amount = await api.post("/essential-spending", {
      mode: "amount",
      value: 1500.5,
      validFrom: "2026-03-01",
    });
    const month = await api.post("/essential-spending", {
      mode: "month_amount",
      value: 1800,
      month: "2026-05",
    });
    expect(pct.body).toMatchObject({ mode: "percent", value: 60, validFrom: "2026-01-01" });
    expect(amount.body).toMatchObject({ mode: "amount", value: 1500.5 });
    expect(month.body).toMatchObject({ mode: "month_amount", value: 1800, month: "2026-05" });
    expect(month.body).not.toHaveProperty("validFrom");
    expect((await api.get("/essential-spending")).body).toHaveLength(3);
  });

  it("stores amounts in cents and percentages as they are", async () => {
    await api.post("/essential-spending", {
      mode: "amount",
      value: 1500.5,
      validFrom: "2026-03-01",
    });
    await api.post("/essential-spending", {
      mode: "percent",
      value: 62.5,
      validFrom: "2026-01-01",
    });
    const rows = t.db.select().from(essentialSpending).all();
    expect(rows.find((r) => r.mode === "amount")!.value).toBe(150_050);
    expect(rows.find((r) => r.mode === "percent")!.value).toBe(62.5);
  });

  it("keeps a history: retroactive entries are accepted", async () => {
    await api.post("/essential-spending", { mode: "amount", value: 1000, validFrom: "2026-06-01" });
    const past = await api.post("/essential-spending", {
      mode: "amount",
      value: 900,
      validFrom: "2024-01-01",
    });
    expect(past.status).toBe(201);
  });

  it("rejects a percentage above 100, a negative amount and a malformed month", async () => {
    expect(
      (
        await api.post("/essential-spending", {
          mode: "percent",
          value: 101,
          validFrom: "2026-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api.post("/essential-spending", {
          mode: "amount",
          value: -5,
          validFrom: "2026-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (await api.post("/essential-spending", { mode: "month_amount", value: 5, month: "2026-13" }))
        .status,
    ).toBe(400);
    expect(
      (await api.post("/essential-spending", { mode: "amount", value: 5, month: "2026-01" }))
        .status,
    ).toBe(400);
  });

  it("replaces (also switching mode) and deletes an entry", async () => {
    const { body } = await api.post("/essential-spending", {
      mode: "amount",
      value: 1000,
      validFrom: "2026-01-01",
    });
    const replaced = await api.put(`/essential-spending/${body.id}`, {
      mode: "month_amount",
      value: 1200,
      month: "2026-02",
    });
    expect(replaced.body).toMatchObject({ mode: "month_amount", month: "2026-02", value: 1200 });
    expect((await api.delete(`/essential-spending/${body.id}`)).status).toBe(200);
    expect((await api.get("/essential-spending")).body).toEqual([]);
  });

  it("has no value until the user enters one (no default)", async () => {
    expect((await api.get("/essential-spending")).body).toEqual([]);
  });
});

describe("settings", () => {
  it("returns the defaults of the spec when nothing is set", async () => {
    const { body } = await api.get("/settings");
    expect(body.entries).toEqual([]);
    expect(body.effective).toMatchObject({
      inflationRate: 0.02,
      safeWithdrawalRate: 0.035,
      emergencyBufferMonths: 6,
      endOfPlanAge: 90,
      publicPension: { enabled: false, startAge: 67, netMonthlyAmount: 0 },
      trafficLight: { greenAt: 1, yellowAt: 0.8 },
      verdict: { minGreenMethods: 3 },
    });
    expect((await api.get("/settings/defaults")).body.publicPension.enabled).toBe(false);
  });

  it("resolves the value in force on a date", async () => {
    await api.post("/settings", { validFrom: "2026-01-01", safeWithdrawalRate: 0.04 });
    await api.post("/settings", { validFrom: "2026-06-01", safeWithdrawalRate: 0.03 });
    const rate = async (asOf: string) =>
      (await api.get(`/settings?asOf=${asOf}`)).body.effective.safeWithdrawalRate;
    expect(await rate("2025-12-31")).toBe(0.035);
    expect(await rate("2026-05-31")).toBe(0.04);
    expect(await rate("2026-06-01")).toBe(0.03);
  });

  it("merges nested patches and stores the pension amount in cents", async () => {
    await api.post("/settings", {
      validFrom: "2026-01-01",
      publicPension: { netMonthlyAmount: 1234.56 },
    });
    await api.post("/settings", { validFrom: "2026-02-01", publicPension: { enabled: true } });
    const { body } = await api.get("/settings?asOf=2026-03-01");
    expect(body.effective.publicPension).toEqual({
      enabled: true,
      startAge: 67,
      netMonthlyAmount: 1234.56,
    });
    expect(
      body.entries.find((e: { validFrom: string }) => e.validFrom === "2026-01-01").publicPension
        .netMonthlyAmount,
    ).toBe(1234.56);
  });

  it("edits an entry without dropping sibling fields, and deletes it", async () => {
    const { body } = await api.post("/settings", {
      validFrom: "2026-01-01",
      publicPension: { enabled: true, startAge: 65 },
    });
    const edited = await api.patch(`/settings/${body.id}`, {
      publicPension: { startAge: 68 },
      leanFactor: 0.7,
    });
    expect(edited.body).toMatchObject({
      publicPension: { enabled: true, startAge: 68 },
      leanFactor: 0.7,
    });
    expect((await api.delete(`/settings/${body.id}`)).status).toBe(200);
    expect((await api.get("/settings")).body.effective.publicPension.enabled).toBe(false);
  });

  it("validates the values", async () => {
    expect(
      (await api.post("/settings", { validFrom: "2026-01-01", safeWithdrawalRate: 0 })).status,
    ).toBe(400);
    expect(
      (await api.post("/settings", { validFrom: "2026-01-01", livingCostWindow: 5 })).status,
    ).toBe(400);
    expect(
      (await api.post("/settings", { validFrom: "2026-01-01", publicPension: { enabled: "yes" } }))
        .status,
    ).toBe(400);
    expect(
      (await api.post("/settings", { validFrom: "2026-01-01", unknownSetting: 1 })).status,
    ).toBe(400);
    expect((await api.post("/settings", { safeWithdrawalRate: 0.04 })).status).toBe(400);
  });
});
