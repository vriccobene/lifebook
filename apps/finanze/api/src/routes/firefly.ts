import { endOfMonth, monthOf, addMonths, type Account } from "@lifebook/finanze-core";
import { and, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../auth/secretBox";
import * as t from "../db/schema";
import { HttpError, badRequest, conflict, notFound } from "../errors";
import {
  FireflyClient,
  normalizeBaseUrl,
  type FetchFn,
  type FireflyAccount,
} from "../firefly/client";
import { MAX_IMPORT_MONTHS, importedContributionId, monthEnds, planImport } from "../firefly/plan";
import { centsToEuros } from "../money";
import { loadLifebookData, requireAccount } from "../repo";
import { dateSchema, errorSchema, okSchema } from "../schemas";
import { timestamp, today, type RouteContext } from "./context";

export interface FireflyOptions {
  /** Key that encrypts the Firefly III tokens. Without it the integration is disabled. */
  secretKey?: Buffer | undefined;
  fetch?: FetchFn | undefined;
}

const accountTypes = [
  "checking",
  "deposit",
  "brokerage",
  "external_investment",
  "pension_fund",
  "real_estate",
  "liability",
] as const;

/** The Lifebook type a Firefly III account most likely is. The user can always choose another. */
export function suggestedType(account: FireflyAccount): (typeof accountTypes)[number] {
  if (account.type === "liabilities" || account.type === "liability") return "liability";
  if (account.accountRole === "savingAsset") return "deposit";
  return "checking";
}

const connectionSchema = z.object({
  configured: z.boolean(),
  /** False when the server has no encryption key: the integration cannot be used. */
  available: z.boolean(),
  baseUrl: z.string().nullable(),
  lastImportAt: z.string().nullable(),
});

const fireflyAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["asset", "liability"]),
  role: z.string().nullable(),
  currencyCode: z.string().nullable(),
  balance: z.number(),
  active: z.boolean(),
  iban: z.string().nullable(),
  linkedAccountId: z.string().nullable(),
  suggestedType: z.enum(accountTypes),
});

const countsSchema = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  deleted: z.number(),
  kept: z.number(),
});

const importResultSchema = z.object({
  dryRun: z.boolean(),
  from: dateSchema,
  to: dateSchema,
  dates: z.array(dateSchema),
  transfers: countsSchema.describe("Transfers between your accounts, over the whole import"),
  accounts: z.array(
    z.object({
      accountId: z.string(),
      accountName: z.string(),
      fireflyAccountId: z.string(),
      fireflyAccountName: z.string().nullable(),
      snapshots: countsSchema,
      contributions: countsSchema,
    }),
  ),
  warnings: z.array(
    z.object({
      code: z.string(),
      accountId: z.string(),
      date: z.string().nullable(),
      detail: z.string().nullable(),
    }),
  ),
});

const transferSchema = z.object({
  id: z.string(),
  date: dateSchema,
  amount: z.number().describe("Euro, always positive"),
  fromAccountId: z.string().nullable(),
  toAccountId: z.string().nullable(),
  fromName: z.string(),
  toName: z.string(),
  description: z.string(),
});

/** Last day of the last complete month. */
const lastMonthEnd = (day: string) => endOfMonth(monthOf(addMonths(`${monthOf(day)}-01`, -1)));

/**
 * Firefly III integration: each user connects their own Firefly III instance with a personal access token,
 * links its accounts to Lifebook accounts and imports month-end balances and transfers.
 */
export async function fireflyRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = ctx;
  const { secretKey, fetch: fetchFn } = ctx.firefly ?? {};
  const tags = ["firefly"];

  const requireKey = () => {
    if (!secretKey)
      throw new HttpError(
        503,
        "firefly_unavailable",
        "The server has no encryption key configured",
      );
    return secretKey;
  };
  const connection = (userId: string) =>
    db.select().from(t.fireflyConnections).where(eq(t.fireflyConnections.userId, userId)).get();
  const clientFor = (userId: string) => {
    const key = requireKey();
    const row = connection(userId);
    if (!row) throw new HttpError(409, "firefly_not_connected", "Connect Firefly III first");
    const token = decryptSecret(key, row.tokenEncrypted);
    if (!token)
      throw new HttpError(
        409,
        "firefly_token_unreadable",
        "The stored token cannot be decrypted (the server key changed): enter it again",
      );
    return new FireflyClient(row.baseUrl, token, fetchFn);
  };
  const links = (userId: string) =>
    db.select().from(t.fireflyLinks).where(eq(t.fireflyLinks.userId, userId)).all();

  r.get(
    "/firefly/connection",
    {
      schema: { tags, summary: "Your Firefly III connection", response: { 200: connectionSchema } },
    },
    async (request) => {
      const row = connection(request.userId);
      return {
        configured: Boolean(row),
        available: Boolean(secretKey),
        baseUrl: row?.baseUrl ?? null,
        lastImportAt: row?.lastImportAt ?? null,
      };
    },
  );

  r.put(
    "/firefly/connection",
    {
      schema: {
        tags,
        summary:
          "Connect your Firefly III with a personal access token. It is checked, then stored encrypted and never returned.",
        body: z.object({ baseUrl: z.string().min(1), token: z.string().trim().min(1) }),
        response: {
          200: connectionSchema.extend({ fireflyVersion: z.string() }),
          400: errorSchema,
          502: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request) => {
      const key = requireKey();
      const baseUrl = normalizeBaseUrl(request.body.baseUrl);
      const { version } = await new FireflyClient(baseUrl, request.body.token, fetchFn).about();
      const previous = connection(request.userId);
      const row = {
        userId: request.userId,
        baseUrl,
        tokenEncrypted: encryptSecret(key, request.body.token),
        createdAt: timestamp(ctx.now),
        lastImportAt: previous?.baseUrl === baseUrl ? previous.lastImportAt : null,
      };
      db.transaction((tx) => {
        // Account ids of another Firefly III instance mean nothing here.
        if (previous && previous.baseUrl !== baseUrl)
          tx.delete(t.fireflyLinks).where(eq(t.fireflyLinks.userId, request.userId)).run();
        tx.insert(t.fireflyConnections)
          .values(row)
          .onConflictDoUpdate({ target: t.fireflyConnections.userId, set: row })
          .run();
      });
      return {
        configured: true,
        available: true,
        baseUrl,
        lastImportAt: row.lastImportAt,
        fireflyVersion: version,
      };
    },
  );

  r.delete(
    "/firefly/connection",
    {
      schema: {
        tags,
        summary: "Forget the Firefly III token. Links and imported data stay.",
        response: { 200: okSchema },
      },
    },
    async (request) => {
      db.delete(t.fireflyConnections).where(eq(t.fireflyConnections.userId, request.userId)).run();
      return { ok: true as const };
    },
  );

  r.get(
    "/firefly/accounts",
    {
      schema: {
        tags,
        summary: "Asset and liability accounts of your Firefly III, with today's balance and links",
        response: { 200: z.array(fireflyAccountSchema), 409: errorSchema, 502: errorSchema },
      },
    },
    async (request) => {
      const accounts = await clientFor(request.userId).ownAccounts();
      const linked = new Map(links(request.userId).map((l) => [l.fireflyAccountId, l.accountId]));
      return accounts.map((a) => ({
        id: a.id,
        name: a.name,
        kind: suggestedType(a) === "liability" ? ("liability" as const) : ("asset" as const),
        role: a.accountRole ?? a.liabilityType,
        currencyCode: a.currencyCode,
        balance: a.currentBalance,
        active: a.active,
        iban: a.iban,
        linkedAccountId: linked.get(a.id) ?? null,
        suggestedType: suggestedType(a),
      }));
    },
  );

  const linkParams = z.object({ fireflyAccountId: z.string().min(1) });

  r.put(
    "/firefly/links/:fireflyAccountId",
    {
      schema: {
        tags,
        summary: "Link a Firefly III account to one of your Lifebook accounts",
        params: linkParams,
        body: z.object({ accountId: z.string() }),
        response: {
          200: z.object({ fireflyAccountId: z.string(), accountId: z.string() }),
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      const { fireflyAccountId } = request.params;
      const account = requireAccount(db, request.userId, request.body.accountId);
      const taken = db
        .select()
        .from(t.fireflyLinks)
        .where(eq(t.fireflyLinks.accountId, account.id))
        .get();
      if (taken && taken.fireflyAccountId !== fireflyAccountId)
        throw conflict("That Lifebook account is already linked to another Firefly III account");
      db.transaction((tx) => {
        tx.delete(t.fireflyLinks)
          .where(
            and(
              eq(t.fireflyLinks.userId, request.userId),
              eq(t.fireflyLinks.fireflyAccountId, fireflyAccountId),
            ),
          )
          .run();
        tx.insert(t.fireflyLinks)
          .values({
            id: randomUUID(),
            userId: request.userId,
            fireflyAccountId,
            accountId: account.id,
          })
          .run();
      });
      return { fireflyAccountId, accountId: account.id };
    },
  );

  r.delete(
    "/firefly/links/:fireflyAccountId",
    {
      schema: {
        tags,
        summary: "Stop importing a Firefly III account. Data already imported stays.",
        params: linkParams,
        response: { 200: okSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const result = db
        .delete(t.fireflyLinks)
        .where(
          and(
            eq(t.fireflyLinks.userId, request.userId),
            eq(t.fireflyLinks.fireflyAccountId, request.params.fireflyAccountId),
          ),
        )
        .run();
      if (result.changes === 0) throw notFound("Link");
      return { ok: true as const };
    },
  );

  r.post(
    "/firefly/import",
    {
      schema: {
        tags,
        summary:
          "Import month-end balances and transfers of the linked accounts. With dryRun nothing is written.",
        body: z.object({
          from: dateSchema.optional().describe("Default: twelve months before `to`"),
          to: dateSchema.optional().describe("Default: the end of the last complete month"),
          dryRun: z.boolean().default(false),
        }),
        response: {
          200: importResultSchema,
          400: errorSchema,
          409: errorSchema,
          502: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request) => {
      const to = request.body.to ?? lastMonthEnd(today(ctx.now));
      const from = request.body.from ?? addMonths(to, -12);
      if (from > to) throw badRequest("`from` must not be after `to`");
      const dates = monthEnds(from, to);
      if (dates.length === 0) throw badRequest("The range contains no month end");
      if (dates.length > MAX_IMPORT_MONTHS)
        throw badRequest(`At most ${MAX_IMPORT_MONTHS} months per import`);
      const userLinks = links(request.userId);
      if (userLinks.length === 0) throw badRequest("Link at least one Firefly III account first");

      const client = clientFor(request.userId);
      const balances = new Map<string, FireflyAccount[]>();
      // A few requests at a time: enough to be quick, not enough to overload a small Firefly III server.
      for (let i = 0; i < dates.length; i += 4) {
        const batch = dates.slice(i, i + 4);
        const results = await Promise.all(batch.map((date) => client.ownAccounts(date)));
        batch.forEach((date, j) => balances.set(date, results[j]!));
      }
      const splits = new Map(
        await Promise.all(
          userLinks.map(
            async (l) =>
              [
                l.fireflyAccountId,
                await client.transactions(l.fireflyAccountId, from, to),
              ] as const,
          ),
        ),
      );

      const accountIds = userLinks.map((l) => l.accountId);
      const data = loadLifebookData(db, request.userId);
      const accounts: Account[] = data.accounts.filter((a) => accountIds.includes(a.id));
      const snapshots = db
        .select()
        .from(t.snapshots)
        .where(
          and(
            inArray(t.snapshots.accountId, accountIds),
            gte(t.snapshots.date, from),
            lte(t.snapshots.date, to),
          ),
        )
        .all();
      const earlier = db
        .selectDistinct({ accountId: t.snapshots.accountId })
        .from(t.snapshots)
        .where(and(inArray(t.snapshots.accountId, accountIds), lt(t.snapshots.date, from)))
        .all();
      // Imported entries are matched by id wherever they are, so a date moved in Firefly III is followed.
      const fetchedIds = new Set(
        [...splits.values()].flat().map((split) => importedContributionId(split.journalId)),
      );
      const contributions = db
        .select()
        .from(t.contributions)
        .where(inArray(t.contributions.accountId, accountIds))
        .all()
        .filter(
          (c) =>
            (c.date >= from && c.date <= to) ||
            (c.externalId !== null && fetchedIds.has(c.externalId)),
        );
      const transfers = db
        .select()
        .from(t.transfers)
        .where(eq(t.transfers.userId, request.userId))
        .all()
        .filter((tr) => (tr.date >= from && tr.date <= to) || fetchedIds.has(tr.externalId));

      const plan = planImport({
        from,
        to,
        accounts,
        links: userLinks,
        balances,
        splits,
        snapshots,
        contributions,
        transfers,
        accountsWithEarlierHistory: new Set(earlier.map((e) => e.accountId)),
      });

      if (!request.body.dryRun) {
        db.transaction((tx) => {
          for (const s of plan.createSnapshots)
            tx.insert(t.snapshots)
              .values({ id: randomUUID(), ...s, source: "firefly" })
              .run();
          for (const s of plan.updateSnapshots)
            tx.update(t.snapshots)
              .set({ balanceCents: s.balanceCents })
              .where(eq(t.snapshots.id, s.id))
              .run();
          for (const c of plan.createContributions)
            tx.insert(t.contributions)
              .values({ id: randomUUID(), ...c })
              .run();
          for (const { id, ...c } of plan.updateContributions)
            tx.update(t.contributions).set(c).where(eq(t.contributions.id, id)).run();
          if (plan.deleteContributions.length > 0)
            tx.delete(t.contributions)
              .where(inArray(t.contributions.id, plan.deleteContributions))
              .run();
          for (const transfer of plan.createTransfers)
            tx.insert(t.transfers)
              .values({ id: randomUUID(), userId: request.userId, ...transfer })
              .run();
          for (const { id, ...transfer } of plan.updateTransfers)
            tx.update(t.transfers).set(transfer).where(eq(t.transfers.id, id)).run();
          if (plan.deleteTransfers.length > 0)
            tx.delete(t.transfers).where(inArray(t.transfers.id, plan.deleteTransfers)).run();
          tx.update(t.fireflyConnections)
            .set({ lastImportAt: timestamp(ctx.now) })
            .where(eq(t.fireflyConnections.userId, request.userId))
            .run();
        });
      }

      return {
        dryRun: request.body.dryRun,
        from,
        to,
        dates: plan.dates,
        transfers: plan.transfers,
        accounts: plan.accounts,
        warnings: plan.warnings,
      };
    },
  );

  r.get(
    "/transfers",
    {
      schema: {
        tags: ["transfers"],
        summary:
          "Transfers between your accounts imported from Firefly III, newest first. A side is null when its Firefly III account is not linked.",
        querystring: z.object({
          accountId: z.string().optional(),
          from: dateSchema.optional(),
          to: dateSchema.optional(),
        }),
        response: { 200: z.array(transferSchema), 404: errorSchema },
      },
    },
    async (request) => {
      const { accountId, from, to } = request.query;
      if (accountId) requireAccount(db, request.userId, accountId);
      return db
        .select()
        .from(t.transfers)
        .where(
          and(
            eq(t.transfers.userId, request.userId),
            accountId
              ? or(eq(t.transfers.fromAccountId, accountId), eq(t.transfers.toAccountId, accountId))
              : undefined,
            from ? gte(t.transfers.date, from) : undefined,
            to ? lte(t.transfers.date, to) : undefined,
          ),
        )
        .orderBy(desc(t.transfers.date))
        .all()
        .map((row) => ({
          id: row.id,
          date: row.date,
          amount: centsToEuros(row.amountCents),
          fromAccountId: row.fromAccountId,
          toAccountId: row.toAccountId,
          fromName: row.fromName,
          toName: row.toName,
          description: row.description,
        }));
    },
  );
}
