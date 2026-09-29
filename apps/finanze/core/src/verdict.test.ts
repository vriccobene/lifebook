import { describe, expect, it } from "vitest";
import { MethodRegistry, defaultRegistry } from "./methods/registry";
import { result } from "./methods/helpers";
import type { Method, MethodResult, MethodStatus } from "./methods/types";
import { DEFAULT_SETTINGS } from "./settings";
import { computeVerdict } from "./verdict";
import { methodContext } from "./testkit";

const r = (id: string, status: MethodStatus, coverage: number | null = null): MethodResult =>
  result({ id, family: "A" }, { status, coverage });
const counted = (...ids: string[]) => ids.map((id) => ({ id, countsForVerdict: true }));
const settings = (min: number) => ({ ...DEFAULT_SETTINGS, verdict: { minGreenMethods: min } });

describe("verdict", () => {
  it("is green with enough green methods and lists them", () => {
    const results = [r("a", "green"), r("b", "green"), r("c", "green"), r("d", "red", 0.2)];
    const verdict = computeVerdict(results, counted("a", "b", "c", "d"), settings(3));
    expect(verdict.status).toBe("green");
    expect(verdict.determining).toEqual(["a", "b", "c"]);
    expect(verdict.notGreen).toEqual(["d"]);
  });

  it("is yellow when exactly one method is missing and names the closest non-green ones", () => {
    const results = [r("a", "green"), r("b", "green"), r("c", "yellow", 0.9), r("d", "red", 0.3)];
    const verdict = computeVerdict(results, counted("a", "b", "c", "d"), settings(3));
    expect(verdict.status).toBe("yellow");
    expect(verdict.greenCount).toBe(2);
    expect(verdict.determining).toEqual(["c"]);
  });

  it("is red with two or more green methods short", () => {
    const results = [
      r("a", "green"),
      r("b", "yellow", 0.9),
      r("c", "red", 0.5),
      r("d", "red", 0.4),
    ];
    const verdict = computeVerdict(results, counted("a", "b", "c", "d"), settings(3));
    expect(verdict.status).toBe("red");
    expect(verdict.determining).toEqual(["b", "c"]);
  });

  it("follows the configured minimum", () => {
    const results = [r("a", "green"), r("b", "green")];
    expect(computeVerdict(results, counted("a", "b"), settings(2)).status).toBe("green");
    expect(computeVerdict(results, counted("a", "b"), settings(4)).status).toBe("red");
  });

  it("leaves out methods with missing data instead of counting them as red", () => {
    const results = [
      r("a", "green"),
      r("b", "green"),
      r("c", "green"),
      r("layers", "missing_data"),
    ];
    const verdict = computeVerdict(results, counted("a", "b", "c", "layers"), settings(3));
    expect(verdict.status).toBe("green");
    expect(verdict.excluded).toEqual(["layers"]);
    expect(verdict.notGreen).toEqual([]);
  });

  it("ignores methods that do not count for the verdict", () => {
    const results = [r("a", "green"), r("info", "info")];
    const verdict = computeVerdict(
      results,
      [...counted("a"), { id: "info", countsForVerdict: false }],
      settings(1),
    );
    expect(verdict.green).toEqual(["a"]);
    expect(verdict.notGreen).toEqual([]);
  });

  it("has no verdict when nothing could be evaluated", () => {
    const verdict = computeVerdict([r("a", "missing_data")], counted("a"), settings(3));
    expect(verdict.status).toBe("missing_data");
  });
});

describe("method registry", () => {
  const custom: Method = {
    id: "monte_carlo",
    family: "D",
    countsForVerdict: false,
    evaluate(ctx) {
      return result(this, { details: { asOf: ctx.asOf } });
    },
  };

  it("accepts a new method without changing the existing ones", () => {
    const extended = defaultRegistry.register(custom);
    expect(extended.list()).toHaveLength(defaultRegistry.list().length + 1);
    expect(defaultRegistry.get("monte_carlo")).toBeUndefined();
    const ctx = methodContext({ capital: { investable: 700_000 } });
    const before = defaultRegistry.evaluateAll(ctx);
    const after = extended.evaluateAll(ctx);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)!.id).toBe("monte_carlo");
  });

  it("rejects duplicate ids", () => {
    expect(() => defaultRegistry.register(defaultRegistry.list()[0]!)).toThrow(/Duplicate/);
    expect(() => MethodRegistry.of([custom, custom])).toThrow(/Duplicate/);
  });

  it("registers the twelve methods of Section 7 in order", () => {
    expect(defaultRegistry.list().filter((m) => m.countsForVerdict)).toHaveLength(9);
    expect(defaultRegistry.list().filter((m) => m.family === "E")).toHaveLength(3);
  });
});
