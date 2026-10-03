import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { fireflyMovements } from "../src/db/schema";
import { addUser, createTestApp, setupUser, type TestApp } from "./helpers";
let testApp: TestApp;
afterEach(async () => {
  await testApp?.close();
});
describe("movement annotations", () => {
  it("persists by journal ID, isolates users and validates gross income", async () => {
    testApp = await createTestApp();
    const { api, userId } = await setupUser(testApp.app);
    const other = await addUser(testApp.app, api, "other");
    const row = {
      id: "m1",
      userId,
      externalId: "firefly:42",
      date: "2026-09-10",
      type: "deposit",
      amountCents: 7400,
      fromName: "Dividendi",
      toName: "Banca",
      description: "Rendita",
      categoryName: "Investimenti",
    };
    testApp.db.insert(fireflyMovements).values(row).run();
    const annotation = {
      tags: ["passivo", "passivo"],
      included: false,
      spendingClass: "unclassified",
      isYield: true,
      grossAmount: 100,
    };
    expect((await other.api.put("/firefly/movements/m1/annotation", annotation)).status).toBe(404);
    expect(
      (await api.put("/firefly/movements/m1/annotation", { ...annotation, grossAmount: 70 }))
        .status,
    ).toBe(400);
    expect((await api.put("/firefly/movements/m1/annotation", annotation)).status).toBe(200);
    testApp.db.delete(fireflyMovements).where(eq(fireflyMovements.id, "m1")).run();
    testApp.db
      .insert(fireflyMovements)
      .values({ ...row, id: "m2", description: "Reimportato" })
      .run();
    expect((await api.get("/firefly/movements")).body[0]).toMatchObject({
      id: "m2",
      annotation: { ...annotation, tags: ["passivo"] },
    });
    expect((await other.api.get("/firefly/movements")).body).toEqual([]);
    expect(
      (await api.put("/firefly/movements/m2/annotation", { ...annotation, incomeKind: "salary" }))
        .status,
    ).toBe(200);
    expect((await api.get("/firefly/movements")).body[0].annotation).toMatchObject({
      incomeKind: "salary",
      isYield: false,
    });
    testApp.db
      .update(fireflyMovements)
      .set({ type: "withdrawal" })
      .where(eq(fireflyMovements.id, "m2"))
      .run();
    expect((await api.put("/firefly/movements/m2/annotation", annotation)).status).toBe(400);
    expect(
      (
        await api.put("/firefly/movements/m2/annotation", {
          ...annotation,
          isYield: false,
          grossAmount: null,
          incomeKind: "salary",
        })
      ).status,
    ).toBe(400);
  });
});
