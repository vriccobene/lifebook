import { isIsoDate } from "@lifebook/core";
import { z } from "zod";

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine(isIsoDate, "not a valid calendar date")
  .describe("Calendar date, YYYY-MM-DD");
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM")
  .describe("Calendar month, YYYY-MM");
export const idParams = z.object({ id: z.string() });

const rate = z.number().min(0).max(1).describe("Fraction: 0.26 = 26%");

export const accountTypeSchema = z.enum([
  "checking",
  "deposit",
  "brokerage",
  "external_investment",
  "real_estate",
  "liability",
]);

/** Account parameters that change over time. Money is in euro. */
export const accountParamsPatchSchema = z
  .object({
    isSpendingAccount: z.boolean(),
    inInvestableCapital: z.boolean(),
    expectedReturn: z.number().min(-1).max(1).nullable(),
    passiveYield: z.number().min(0).max(1).nullable(),
    taxRate: rate,
    interestRate: z.number().min(0).max(1).nullable(),
    monthlyPayment: z.number().min(0).nullable(),
    paymentEndDate: dateSchema.nullable(),
  })
  .partial()
  .strict();

export const accountParamsEntryInput = accountParamsPatchSchema.extend({ validFrom: dateSchema });
export const accountParamsEntrySchema = accountParamsEntryInput.extend({ id: z.string() });

export const accountBaseFields = {
  name: z.string().min(1),
  institution: z.string().nullable(),
  type: accountTypeSchema,
  realEstateUse: z.enum(["primary_residence", "income"]).nullable(),
  contributionsMode: z.enum(["declared", "inferred"]),
  countsAsLivingCost: z.boolean(),
  archivedAt: dateSchema.nullable(),
};

export const accountSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  ...accountBaseFields,
  params: z.array(accountParamsEntrySchema),
});

export const accountCreateSchema = z.object({
  name: accountBaseFields.name,
  institution: accountBaseFields.institution.optional(),
  type: accountTypeSchema,
  realEstateUse: accountBaseFields.realEstateUse.optional(),
  contributionsMode: accountBaseFields.contributionsMode.optional(),
  countsAsLivingCost: accountBaseFields.countsAsLivingCost.optional(),
  params: z.array(accountParamsEntryInput).optional(),
});

export const accountUpdateSchema = z
  .object({
    name: accountBaseFields.name,
    institution: accountBaseFields.institution,
    realEstateUse: accountBaseFields.realEstateUse,
    contributionsMode: accountBaseFields.contributionsMode,
    countsAsLivingCost: accountBaseFields.countsAsLivingCost,
    archivedAt: accountBaseFields.archivedAt,
  })
  .partial()
  .strict();

export const snapshotInput = z.object({
  accountId: z.string(),
  date: dateSchema,
  balance: z.number().describe("Euro. Liabilities are negative."),
  source: z.enum(["csv", "manual"]).default("manual"),
});
export const snapshotSchema = snapshotInput.extend({
  id: z.string(),
  source: z.enum(["csv", "manual"]),
});
export const snapshotUpdateSchema = z
  .object({ date: dateSchema, balance: z.number(), source: z.enum(["csv", "manual"]) })
  .partial()
  .strict();

export const contributionInput = z.object({
  accountId: z.string(),
  date: dateSchema,
  amount: z.number().describe("Euro. Positive = deposit, negative = withdrawal."),
});
export const contributionSchema = contributionInput.extend({ id: z.string() });
export const contributionUpdateSchema = z
  .object({ date: dateSchema, amount: z.number() })
  .partial()
  .strict();

const incomeBase = {
  name: z.string().min(1),
  amount: z.number().describe("Net euro per occurrence"),
};
export const incomeInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...incomeBase, kind: z.literal("one_off"), date: dateSchema }),
  z.object({
    ...incomeBase,
    kind: z.literal("recurring"),
    periodicity: z.enum(["monthly", "quarterly", "yearly"]),
    startDate: dateSchema,
    endDate: dateSchema.nullable().default(null),
  }),
]);
export const incomeSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), ...incomeBase, kind: z.literal("one_off"), date: dateSchema }),
  z.object({
    id: z.string(),
    ...incomeBase,
    kind: z.literal("recurring"),
    periodicity: z.enum(["monthly", "quarterly", "yearly"]),
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
  }),
]);

export const essentialInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("percent"),
    value: z.number().min(0).max(100),
    validFrom: dateSchema,
  }),
  z.object({ mode: z.literal("amount"), value: z.number().min(0), validFrom: dateSchema }),
  z.object({ mode: z.literal("month_amount"), value: z.number().min(0), month: monthSchema }),
]);
export const essentialSchema = z.discriminatedUnion("mode", [
  z.object({
    id: z.string(),
    mode: z.literal("percent"),
    value: z.number(),
    validFrom: dateSchema,
  }),
  z.object({ id: z.string(), mode: z.literal("amount"), value: z.number(), validFrom: dateSchema }),
  z.object({
    id: z.string(),
    mode: z.literal("month_amount"),
    value: z.number(),
    month: monthSchema,
  }),
]);

export const settingsPatchSchema = z
  .object({
    inflationRate: z.number().min(-0.5).max(1),
    safeWithdrawalRate: z.number().gt(0).max(1),
    emergencyBufferMonths: z.number().min(0),
    leanFactor: z.number().gt(0),
    fatFactor: z.number().gt(0),
    currentAge: z.number().min(0).nullable(),
    targetRetirementAge: z.number().min(0).nullable(),
    endOfPlanAge: z.number().min(0),
    publicPension: z
      .object({
        enabled: z.boolean(),
        startAge: z.number().min(0),
        netMonthlyAmount: z.number().min(0).describe("Euro"),
      })
      .partial()
      .strict(),
    trafficLight: z
      .object({ greenAt: z.number().min(0), yellowAt: z.number().min(0) })
      .partial()
      .strict(),
    verdict: z
      .object({ minGreenMethods: z.number().int().min(1) })
      .partial()
      .strict(),
    livingCostWindow: z.union([z.literal(3), z.literal(6), z.literal(12)]),
    spendingDeviationThreshold: z.number().min(0),
    declaredBalanceChangeThreshold: z.number().min(0),
    staleAccountDays: z.number().int().min(1),
  })
  .partial()
  .strict();
export const settingsEntryInput = settingsPatchSchema.extend({ validFrom: dateSchema });
export const settingsEntrySchema = settingsEntryInput.extend({ id: z.string() });

export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export const okSchema = z.object({ ok: z.literal(true) });
