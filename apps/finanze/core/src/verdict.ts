import type { Method, MethodResult, MethodStatus } from "./methods/types";
import type { Settings } from "./settings";

export type VerdictStatus = "green" | "yellow" | "red" | "missing_data";

export interface Verdict {
  status: VerdictStatus;
  minGreenMethods: number;
  greenCount: number;
  /** Methods whose result decides the verdict: the green ones when green, otherwise the ones still to turn green. */
  determining: string[];
  green: string[];
  notGreen: string[];
  /** Methods left out because their data is missing. */
  excluded: string[];
}

/**
 * Green when at least `minGreenMethods` counted methods are green, yellow when exactly one is
 * missing, red otherwise. Methods with missing data or that do not count are ignored.
 */
export function computeVerdict(
  results: readonly MethodResult[],
  methods: readonly Pick<Method, "id" | "countsForVerdict">[],
  settings: Settings,
): Verdict {
  const counted = new Set(methods.filter((m) => m.countsForVerdict).map((m) => m.id));
  const relevant = results.filter((r) => counted.has(r.id));
  const excluded = relevant.filter((r) => r.status === "missing_data").map((r) => r.id);
  const evaluated = relevant.filter((r) => r.status !== "missing_data");
  const green = evaluated.filter((r) => r.status === "green").map((r) => r.id);
  const notGreen = evaluated
    .filter((r) => r.status !== ("green" satisfies MethodStatus))
    .sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0))
    .map((r) => r.id);

  const min = settings.verdict.minGreenMethods;
  let status: VerdictStatus;
  if (evaluated.length === 0) status = "missing_data";
  else if (green.length >= min) status = "green";
  else if (green.length === min - 1) status = "yellow";
  else status = "red";

  return {
    status,
    minGreenMethods: min,
    greenCount: green.length,
    determining: status === "green" ? green : notGreen.slice(0, min - green.length),
    green,
    notGreen,
    excluded,
  };
}
