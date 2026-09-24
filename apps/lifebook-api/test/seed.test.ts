import { afterEach, describe, expect, it } from "vitest";
import { seedDemoData } from "../src/seed";
import { client, createTestApp, type TestApp } from "./helpers";

const TODAY = "2026-09-24";
let t: TestApp;
afterEach(async () => {
  await t.close();
});

describe("demo data", () => {
  it("loads a complete fictional household through the API", async () => {
    t = await createTestApp();
    const { token, lastReading } = await seedDemoData(t.app, TODAY);
    const api = client(t.app, token);
    expect(lastReading).toBe("2026-08-31");
    expect((await api.get("/accounts")).body).toHaveLength(7);
    expect((await api.get("/snapshots")).body).toHaveLength(7 * 25);
    expect((await api.get("/contributions")).body).toHaveLength(2 * 24);
    expect((await api.get("/income-items")).body).toHaveLength(3);
  });

  it("produces a coherent living cost and a verdict, without negative months", async () => {
    t = await createTestApp();
    const { token } = await seedDemoData(t.app, TODAY);
    const api = client(t.app, token);
    const { livingCost } = (await api.get("/results/living-cost?asOf=2026-08-31")).body;
    expect(livingCost.periods).toHaveLength(24);
    expect(livingCost.referenceMonthly).toBeGreaterThan(1950);
    expect(livingCost.referenceMonthly).toBeLessThan(2450);
    expect(livingCost.warnings.map((w: { code: string }) => w.code)).not.toContain(
      "negative_spending",
    );

    const methods = (await api.get("/results/methods?asOf=2026-08-31")).body;
    expect(methods.publicPensionEnabled).toBe(false);
    for (const id of ["layers", "coast_fire", "bridge"]) {
      expect(methods.methods.find((m: { id: string }) => m.id === id).status, id).not.toBe(
        "missing_data",
      );
    }
    expect((await api.get("/results/verdict?asOf=2026-08-31")).body.verdict.status).not.toBe(
      "missing_data",
    );
  });

  it("is deterministic: the same data every time", async () => {
    const load = async () => {
      const app = await createTestApp();
      try {
        const { token } = await seedDemoData(app.app, TODAY);
        const rows = (await client(app.app, token).get("/snapshots")).body as {
          date: string;
          balance: number;
        }[];
        // ids are random and same-date order follows them, so compare the sorted values only
        return rows.map(({ date, balance }) => `${date}|${balance}`).sort();
      } finally {
        await app.close();
      }
    };
    expect(await load()).toEqual(await load());
    t = await createTestApp();
  });

  it("refuses to run on a database that already has a user (never mixes demo and real data)", async () => {
    t = await createTestApp();
    await seedDemoData(t.app, TODAY);
    await expect(seedDemoData(t.app, TODAY)).rejects.toThrow(/già un utente/);
    expect((await client(t.app).get("/auth/status")).body.setupRequired).toBe(false);
  });
});
