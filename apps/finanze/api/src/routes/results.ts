import {
  computeAsOf,
  computeReturnsAsOf,
  computeSeries,
  type AsOfResult,
  type LifebookData,
  type SeriesStep,
} from "@lifebook/finanze-core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest } from "../errors";
import { loadLifebookData } from "../repo";
import { dateSchema } from "../schemas";
import { today, type RouteContext } from "./context";

const nullableNumber = z.number().nullable();
const warning = z.object({
  code: z.string(),
  accountId: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  detail: nullableNumber,
});
const distance = z.object({
  eur: nullableNumber,
  kind: z.enum(["capital", "annual_flow"]).nullable(),
  years: nullableNumber,
});
const status = z.enum(["green", "yellow", "red", "missing_data", "info"]);

const period = z.object({
  from: dateSchema,
  to: dateSchema,
  days: z.number(),
  months: z.number(),
  income: z.number(),
  spendingAccountsDelta: z.number(),
  transfers: z.number(),
  transfersByAccount: z.array(z.object({ accountId: z.string(), amount: z.number() })),
  outsideTransfers: z
    .number()
    .describe("Net transfers towards own Firefly III accounts not linked to Lifebook"),
  source: z.enum(["balances", "firefly"]),
  estimatedSpending: z.number(),
  spending: z.number(),
  monthlySpending: z.number(),
  warnings: z.array(warning),
});
const livingCost = z.object({
  asOf: dateSchema,
  periods: z.array(period),
  averages: z.object({ "3": nullableNumber, "6": nullableNumber, "12": nullableNumber }),
  referenceWindow: z.number(),
  referenceMonthly: nullableNumber,
  incomeMonthly: nullableNumber,
  regimeMonthly: nullableNumber,
  warnings: z.array(warning),
});
const essentialSplit = z.object({
  month: z.string(),
  livingCost: z.number(),
  essential: nullableNumber,
  discretionary: nullableNumber,
  exceedsLivingCost: z.boolean(),
});
const method = z.object({
  id: z.string(),
  family: z.enum(["A", "B", "D", "E"]),
  status,
  coverage: nullableNumber,
  distance,
  metric: z
    .object({ value: nullableNumber, unit: z.enum(["ratio", "years", "months"]) })
    .nullable(),
  details: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  variants: z.array(z.object({ id: z.string(), status, coverage: nullableNumber, distance })),
  missing: z.array(z.string()),
});
const verdict = z.object({
  status: z.enum(["green", "yellow", "red", "missing_data"]),
  minGreenMethods: z.number(),
  greenCount: z.number(),
  determining: z.array(z.string()),
  green: z.array(z.string()),
  notGreen: z.array(z.string()),
  excluded: z.array(z.string()),
});
const returnRecord = z.object({
  accountId: z.string(),
  from: dateSchema,
  to: dateSchema,
  days: z.number(),
  method: z.enum(["declared", "inferred", "real_estate_income", "appreciation", "property_value"]),
  opening: z.number(),
  closing: z.number(),
  contributions: z.number(),
  grossGain: z.number(),
  tax: z.number(),
  netGain: z.number(),
  base: z.number(),
  grossPct: nullableNumber,
  netPct: nullableNumber,
  grossAnnualized: nullableNumber,
  netAnnualized: nullableNumber,
  passiveGross: z.number(),
  passiveNet: z.number(),
});
const totalReturn = z.object({
  date: dateSchema,
  grossGain: z.number(),
  netGain: z.number(),
  base: z.number(),
  grossPct: nullableNumber,
  netPct: nullableNumber,
  passiveNet: z.number(),
});
const netWorth = z.object({
  asOf: dateSchema,
  netWorth: z.number(),
  netWorthByType: z.record(z.string(), z.number()),
  investableGross: z.number(),
  emergencyBuffer: nullableNumber,
  investable: nullableNumber,
  liquidity: z.number(),
  riskyCapital: nullableNumber,
  passiveNetAnnual: z.number(),
  safeFlowsNetAnnual: z.number(),
  portfolioReturn: z.number(),
  balances: z.array(
    z.object({ accountId: z.string(), name: z.string(), type: z.string(), balance: z.number() }),
  ),
});

const query = z.object({
  asOf: dateSchema.optional().describe("Single date (default: today)"),
  from: dateSchema.optional().describe("Start of a historical series"),
  to: dateSchema.optional().describe("End of a historical series"),
  step: z
    .enum(["month", "round"])
    .optional()
    .describe("Series step: month ends (default) or every date with a reading"),
});

const seriesOf = <T extends z.ZodType>(payload: T) =>
  z.object({
    from: dateSchema,
    to: dateSchema,
    step: z.enum(["month", "round"]),
    points: z.array(payload),
  });

const asOfPayloads = {
  livingCost: (r: AsOfResult) => ({
    asOf: r.asOf,
    livingCost: r.livingCost,
    essentialSplit: r.essentialSplit,
  }),
  methods: (r: AsOfResult) => ({
    asOf: r.asOf,
    publicPensionEnabled: r.publicPensionEnabled,
    methods: r.methods,
    warnings: r.warnings,
  }),
  verdict: (r: AsOfResult) => ({
    asOf: r.asOf,
    publicPensionEnabled: r.publicPensionEnabled,
    verdict: r.verdict,
  }),
  netWorth: (r: AsOfResult) => ({
    asOf: r.asOf,
    ...r.capital,
    balances: r.capital.balances.map((b) => ({
      accountId: b.account.id,
      name: b.account.name,
      type: b.account.type,
      balance: b.balance,
    })),
  }),
};

/**
 * `results/*`: thin wrappers over finanze-core. With `asOf` (default today) they return one result;
 * with `from` and `to` they return the historical series, each point calculated as of its own date.
 */
export async function resultRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ["results"];

  function register<T extends z.ZodType>(
    path: string,
    summary: string,
    payload: T,
    compute: (data: LifebookData, asOf: string) => z.input<T>,
  ) {
    r.get(
      path,
      {
        schema: {
          tags,
          summary,
          querystring: query,
          response: { 200: z.union([payload, seriesOf(payload)]) as z.ZodType },
        },
      },
      async (request) => {
        const { asOf, from, to, step } = request.query;
        const data = loadLifebookData(ctx.db, request.userId);
        if (from !== undefined || to !== undefined) {
          if (from === undefined || to === undefined)
            throw badRequest("from and to must be given together");
          if (asOf !== undefined) throw badRequest("asOf cannot be combined with from and to");
          if (from > to) throw badRequest("from must not be after to");
          const seriesStep: SeriesStep = step ?? "month";
          const points = computeSeries(data, { from, to, step: seriesStep }, compute).map(
            (p) => p.value,
          );
          return { from, to, step: seriesStep, points };
        }
        return compute(data, asOf ?? today(ctx.now));
      },
    );
  }

  register(
    "/results/living-cost",
    "Deduced living cost, moving averages and essential vs discretionary split",
    z.object({ asOf: dateSchema, livingCost, essentialSplit: z.array(essentialSplit) }),
    (data, asOf) => asOfPayloads.livingCost(computeAsOf(data, asOf)),
  );
  register(
    "/results/returns",
    "Gross and net returns per account and in total",
    z.object({ asOf: dateSchema, records: z.array(returnRecord), totals: z.array(totalReturn) }),
    (data, asOf) => computeReturnsAsOf(data, asOf),
  );
  register(
    "/results/methods",
    "Every 'can I stop working?' method with outcome, coverage and distance",
    z.object({
      asOf: dateSchema,
      publicPensionEnabled: z.boolean(),
      methods: z.array(method),
      warnings: z.array(warning),
    }),
    (data, asOf) => asOfPayloads.methods(computeAsOf(data, asOf)),
  );
  register(
    "/results/verdict",
    "Synthetic verdict and the methods that determine it",
    z.object({ asOf: dateSchema, publicPensionEnabled: z.boolean(), verdict }),
    (data, asOf) => asOfPayloads.verdict(computeAsOf(data, asOf)),
  );
  register(
    "/results/net-worth",
    "Net worth, its composition by account type and the investable capital",
    netWorth,
    (data, asOf) => asOfPayloads.netWorth(computeAsOf(data, asOf)),
  );
}
