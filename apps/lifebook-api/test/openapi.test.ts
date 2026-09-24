import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

async function spec() {
  const res = await t.app.inject({ method: "GET", url: "/api/v1/openapi.json" });
  return { status: res.statusCode, body: res.json() };
}

describe("OpenAPI document", () => {
  it("is generated from the zod schemas and served without a token", async () => {
    const { status, body } = await spec();
    expect(status).toBe(200);
    expect(body.openapi).toMatch(/^3\./);
    expect(body.info.title).toBe("Lifebook API");
  });

  it("documents every resource of the spec (Section 10)", async () => {
    const { body } = await spec();
    const paths = Object.keys(body.paths);
    for (const resource of [
      "/accounts",
      "/snapshots",
      "/contributions",
      "/income-items",
      "/settings",
      "/essential-spending",
      "/results/living-cost",
      "/results/returns",
      "/results/methods",
      "/results/verdict",
    ]) {
      expect(paths, resource).toContain(resource);
    }
  });

  it("describes the request schemas and the bearer authentication", async () => {
    const { body } = await spec();
    expect(body.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(body.security).toEqual([{ bearerAuth: [] }]);
    expect(body.paths["/auth/login"].post.security).toEqual([]);
    const snapshot = body.paths["/snapshots"].post.requestBody.content["application/json"].schema;
    expect(snapshot.properties).toHaveProperty("date");
    expect(snapshot.required).toEqual(expect.arrayContaining(["accountId", "date", "balance"]));
    expect(
      body.paths["/results/methods"].get.parameters.map((p: { name: string }) => p.name),
    ).toEqual(expect.arrayContaining(["asOf", "from", "to", "step"]));
  });
});
