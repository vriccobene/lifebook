import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("public API", () => {
  it("exposes the engine entry points", () => {
    expect(core.computeAsOf).toBeTypeOf("function");
    expect(core.computeSeries).toBeTypeOf("function");
    expect(core.defaultRegistry.list().map((m) => m.id)).toEqual([
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
  });
});
