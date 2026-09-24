import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, seedLife, setupUser, type Api, type TestApp } from "./helpers";

let t: TestApp;
let api: Api;
beforeEach(async () => {
  t = await createTestApp();
  api = (await setupUser(t.app)).api;
});
afterEach(async () => {
  await t.close();
});

const method = (body: { methods: { id: string }[] }, id: string) =>
  body.methods.find((m) => m.id === id) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("results without data", () => {
  it("answers with empty results instead of failing", async () => {
    const living = await api.get("/results/living-cost");
    expect(living.status).toBe(200);
    expect(living.body.livingCost.periods).toEqual([]);
    expect(living.body.livingCost.referenceMonthly).toBeNull();
    const verdict = await api.get("/results/verdict");
    expect(verdict.body.verdict.status).toBe("missing_data");
    expect((await api.get("/results/returns")).body.records).toEqual([]);
    expect((await api.get("/results/net-worth")).body.netWorth).toBe(0);
  });
});

describe("living cost", () => {
  it("deduces the living cost from balances entered through the API", async () => {
    await seedLife(api);
    const { body } = await api.get("/results/living-cost?asOf=2026-12-31");
    expect(body.livingCost.periods).toHaveLength(12);
    expect(body.livingCost.referenceMonthly).toBeCloseTo(2000, 6);
    expect(body.livingCost.incomeMonthly).toBeCloseTo(3000, 6);
    expect(body.livingCost.averages).toEqual({
      "3": expect.closeTo(2000, 6),
      "6": expect.closeTo(2000, 6),
      "12": expect.closeTo(2000, 6),
    });
  });

  it("uses only data up to the asOf date (regression)", async () => {
    await seedLife(api);
    const { body } = await api.get("/results/living-cost?asOf=2026-06-30");
    expect(body.asOf).toBe("2026-06-30");
    expect(body.livingCost.periods).toHaveLength(6);
  });

  it("defaults asOf to today", async () => {
    await seedLife(api);
    t.clock.current = new Date("2026-03-15T00:00:00Z");
    const { body } = await api.get("/results/living-cost");
    expect(body.asOf).toBe("2026-03-15");
    expect(body.livingCost.periods).toHaveLength(2); // Jan and Feb: March is not read yet as of the 15th
  });

  it("changes retroactively when an old entry is edited", async () => {
    const ids = await seedLife(api);
    const before = (await api.get("/results/living-cost")).body.livingCost.referenceMonthly;
    await api.post("/contributions", { accountId: ids.bro, date: "2026-03-10", amount: -1200 });
    const after = (await api.get("/results/living-cost")).body.livingCost.referenceMonthly;
    expect(after).toBeCloseTo(before + 100, 6); // 1200 more spending over 12 months
  });

  it("splits essential and discretionary spending", async () => {
    await seedLife(api);
    await api.post("/essential-spending", { mode: "amount", value: 1500, validFrom: "2026-01-01" });
    await api.post("/essential-spending", { mode: "month_amount", value: 2500, month: "2026-05" });
    const { body } = await api.get("/results/living-cost");
    const split = (m: string) => body.essentialSplit.find((s: { month: string }) => s.month === m);
    expect(split("2026-04")).toMatchObject({
      essential: 1500,
      discretionary: 500,
      exceedsLivingCost: false,
    });
    expect(split("2026-05")).toMatchObject({
      essential: 2500,
      discretionary: 0,
      exceedsLivingCost: true,
    });
  });

  it("returns a series with one point per month end", async () => {
    await seedLife(api);
    const { body } = await api.get("/results/living-cost?from=2026-01-01&to=2026-06-30&step=month");
    expect(body).toMatchObject({ from: "2026-01-01", to: "2026-06-30", step: "month" });
    expect(body.points.map((p: { asOf: string }) => p.asOf)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    expect(body.points[2].livingCost.periods).toHaveLength(3);
  });

  it("supports the round step", async () => {
    await seedLife(api, { months: 3 });
    const { body } = await api.get("/results/living-cost?from=2025-12-01&to=2026-12-31&step=round");
    expect(body.points).toHaveLength(4);
  });
});

describe("query validation", () => {
  it("requires from and to together and refuses asOf with them", async () => {
    expect((await api.get("/results/methods?from=2026-01-01")).status).toBe(400);
    expect((await api.get("/results/methods?to=2026-01-01")).status).toBe(400);
    expect(
      (await api.get("/results/methods?asOf=2026-01-01&from=2026-01-01&to=2026-02-01")).status,
    ).toBe(400);
    expect((await api.get("/results/methods?from=2026-06-01&to=2026-01-01")).status).toBe(400);
    expect((await api.get("/results/methods?asOf=2026-02-30")).status).toBe(400);
    expect((await api.get("/results/methods?asOf=2026-01-01&step=weekly")).status).toBe(400);
  });
});

describe("methods and verdict", () => {
  it("evaluates every method with outcome, coverage and distance", async () => {
    await seedLife(api);
    const { body } = await api.get("/results/methods");
    expect(body.methods.map((m: { id: string }) => m.id)).toEqual([
      "swr",
      "fi_number",
      "passive_income",
      "hybrid",
      "layers",
      "coast_fire",
      "barista_fire",
      "fire_tiers",
      "bridge",
      "savings_rate",
      "years_of_autonomy",
      "runway",
    ]);
    const swr = method(body, "swr");
    expect(swr.status).toBe("green");
    expect(swr.coverage).toBeGreaterThan(1);
    expect(swr.distance).toEqual({ eur: 0, kind: "capital", years: null });
    expect(method(body, "savings_rate").metric.value).toBeCloseTo(1 / 3, 6);
  });

  it("excludes layered coverage from the verdict until the essential spending exists (regression)", async () => {
    await seedLife(api);
    const before = await api.get("/results/methods");
    expect(method(before.body, "layers")).toMatchObject({
      status: "missing_data",
      missing: ["essential_spending"],
    });
    const verdict = (await api.get("/results/verdict")).body.verdict;
    expect(verdict.excluded).toContain("layers");

    await api.post("/essential-spending", { mode: "amount", value: 1500, validFrom: "2026-01-01" });
    const after = await api.get("/results/methods");
    expect(method(after.body, "layers").status).not.toBe("missing_data");
    expect((await api.get("/results/verdict")).body.verdict.excluded).not.toContain("layers");
  });

  it("lists the methods that determine the verdict", async () => {
    await seedLife(api);
    const { verdict } = (await api.get("/results/verdict")).body;
    expect(verdict.status).toBe("green");
    expect(verdict.determining.length).toBeGreaterThanOrEqual(verdict.minGreenMethods);
    expect(verdict.green).toEqual(expect.arrayContaining(verdict.determining));
  });

  it("follows the verdict threshold from the settings", async () => {
    await seedLife(api);
    await api.post("/settings", { validFrom: "2000-01-01", verdict: { minGreenMethods: 9 } });
    expect((await api.get("/results/verdict")).body.verdict.status).not.toBe("green");
  });

  it("returns methods as a historical series with the traffic light evolution", async () => {
    await seedLife(api);
    await api.post("/settings", { validFrom: "2026-07-01", safeWithdrawalRate: 0.01 });
    const { body } = await api.get("/results/methods?from=2026-05-01&to=2026-08-31");
    const swr = body.points.map(
      (p: { methods: { id: string; status: string }[] }) =>
        p.methods.find((m) => m.id === "swr")!.status,
    );
    expect(swr).toEqual(["green", "green", "red", "red"]); // May, Jun | Jul, Aug: the swr drops from July
  });
});

describe("public pension toggle through the API", () => {
  const setup = async () => {
    await seedLife(api);
    await api.post("/essential-spending", { mode: "amount", value: 1500, validFrom: "2026-01-01" });
    await api.post("/settings", {
      validFrom: "2000-01-01",
      currentAge: 50,
      targetRetirementAge: 55,
      publicPension: { startAge: 67, netMonthlyAmount: 1500 },
    });
  };

  it("is off by default and reported as such", async () => {
    await setup();
    const { body } = await api.get("/results/methods");
    expect(body.publicPensionEnabled).toBe(false);
    expect(method(body, "layers").details.pensionAnnual).toBe(0);
    expect(method(body, "hybrid").details.pensionAnnual).toBe(0);
    expect(method(body, "bridge").details.pensionAnnual).toBe(0);
  });

  it("changes exactly the layered, hybrid and bridge methods when switched on", async () => {
    await setup();
    const off = (await api.get("/results/methods")).body;
    await api.post("/settings", { validFrom: "2026-01-01", publicPension: { enabled: true } });
    const on = (await api.get("/results/methods")).body;
    expect(on.publicPensionEnabled).toBe(true);
    const changed = off.methods
      .filter((m: unknown, i: number) => JSON.stringify(m) !== JSON.stringify(on.methods[i]))
      .map((m: { id: string }) => m.id);
    expect(changed.sort()).toEqual(["bridge", "hybrid", "layers"]);
    expect(method(on, "layers").details.pensionAnnual).toBe(18_000);
    expect(method(on, "bridge").coverage).toBeGreaterThan(method(off, "bridge").coverage);
  });

  it("applies from its own date in the history, not before", async () => {
    await setup();
    await api.post("/settings", { validFrom: "2026-09-01", publicPension: { enabled: true } });
    const { body } = await api.get("/results/verdict?from=2026-08-01&to=2026-10-31");
    expect(
      body.points.map((p: { publicPensionEnabled: boolean }) => p.publicPensionEnabled),
    ).toEqual([false, true, true]); // Aug 31 | Sep 30, Oct 31
  });
});

describe("net worth", () => {
  it("is assets minus liabilities: a 200k home with a 100k mortgage is worth 100k", async () => {
    const home = (
      await api.post("/accounts", {
        name: "Home",
        type: "real_estate",
        realEstateUse: "primary_residence",
      })
    ).body.id;
    const mortgage = (await api.post("/accounts", { name: "Mortgage", type: "liability" })).body.id;
    await api.post("/snapshots", { accountId: home, date: "2026-01-31", balance: 200_000 });
    await api.post("/snapshots", { accountId: mortgage, date: "2026-01-31", balance: -100_000 });
    const { body } = await api.get("/results/net-worth?asOf=2026-01-31");
    expect(body.netWorth).toBe(100_000);
    expect(body.netWorthByType).toMatchObject({ real_estate: 200_000, liability: -100_000 });
    expect(body.balances).toHaveLength(2);
  });

  it("provides the composition history", async () => {
    await seedLife(api);
    const { body } = await api.get("/results/net-worth?from=2026-01-01&to=2026-03-31");
    expect(body.points).toHaveLength(3);
    expect(body.points[0].netWorthByType.checking).toBe(21_000);
    expect(body.points[2].netWorthByType.checking).toBe(23_000);
  });
});

describe("returns", () => {
  it("reports gross and net returns per account", async () => {
    const bro = (
      await api.post("/accounts", {
        name: "Broker",
        type: "brokerage",
        params: [{ validFrom: "2000-01-01", taxRate: 0.26 }],
      })
    ).body.id;
    await api.post("/snapshots", { accountId: bro, date: "2026-01-31", balance: 10_000 });
    await api.post("/snapshots", { accountId: bro, date: "2026-02-28", balance: 10_500 });
    const { body } = await api.get("/results/returns");
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({
      method: "declared",
      grossGain: 500,
      tax: 130,
      netGain: 370,
    });
    expect(body.records[0].grossPct).toBeCloseTo(0.05, 9);
    expect(body.totals[0].netPct).toBeCloseTo(0.037, 9);
  });

  it("uses the contributions entered through the API (Modified Dietz)", async () => {
    const bro = (await api.post("/accounts", { name: "Broker", type: "brokerage" })).body.id;
    await api.post("/snapshots", { accountId: bro, date: "2026-01-01", balance: 10_000 });
    await api.post("/snapshots", { accountId: bro, date: "2026-01-31", balance: 16_000 });
    await api.post("/contributions", { accountId: bro, date: "2026-01-16", amount: 5_000 });
    const { body } = await api.get("/results/returns");
    expect(body.records[0].grossGain).toBe(1_000);
    expect(body.records[0].grossPct).toBeCloseTo(0.08, 9);
  });
});

describe("parameters over time through the API", () => {
  it("uses the tax rate in force in each period", async () => {
    const bro = (await api.post("/accounts", { name: "Broker", type: "brokerage" })).body.id;
    await api.post(`/accounts/${bro}/params`, { validFrom: "2000-01-01", taxRate: 0.26 });
    await api.post(`/accounts/${bro}/params`, { validFrom: "2026-03-01", taxRate: 0.1 });
    for (const [date, balance] of [
      ["2026-01-31", 1000],
      ["2026-02-28", 1100],
      ["2026-03-31", 1200],
    ] as const) {
      await api.post("/snapshots", { accountId: bro, date, balance });
    }
    const { body } = await api.get("/results/returns");
    expect(body.records.map((r: { tax: number }) => r.tax)).toEqual([26, 10]);
  });
});
