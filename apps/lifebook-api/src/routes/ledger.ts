import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { accounts, contributions, snapshots } from "../db/schema";
import { conflict, notFound } from "../errors";
import { eurosToCents } from "../money";
import { contributionToApi, requireAccount, snapshotToApi } from "../repo";
import {
  contributionInput,
  contributionSchema,
  contributionUpdateSchema,
  dateSchema,
  errorSchema,
  idParams,
  okSchema,
  snapshotInput,
  snapshotSchema,
  snapshotUpdateSchema,
} from "../schemas";
import type { RouteContext } from "./context";

const listQuery = z.object({
  accountId: z.string().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

/** Balance snapshots and contributions: dated entries that can be inserted retroactively, edited and deleted. */
export async function ledgerRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = ctx;
  const ownedAccountIds = (userId: string) =>
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.ownerId, userId))
      .all()
      .map((a) => a.id);

  // Snapshots
  const snapshotTags = ["snapshots"];
  const findSnapshot = (userId: string, id: string) => {
    const row = db.select().from(snapshots).where(eq(snapshots.id, id)).get();
    if (!row) throw notFound("Snapshot");
    requireAccount(db, userId, row.accountId);
    return row;
  };
  const snapshotConflict = (accountId: string, date: string, exceptId?: string) => {
    const existing = db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.accountId, accountId), eq(snapshots.date, date)))
      .get();
    if (existing && existing.id !== exceptId) {
      throw conflict("The account already has a snapshot on that date");
    }
  };

  r.get(
    "/snapshots",
    {
      schema: {
        tags: snapshotTags,
        summary: "List snapshots, oldest first",
        querystring: listQuery,
        response: { 200: z.array(snapshotSchema) },
      },
    },
    async (request) => {
      const { accountId, from, to } = request.query;
      if (accountId) requireAccount(db, request.userId, accountId);
      const ids = accountId ? [accountId] : ownedAccountIds(request.userId);
      if (ids.length === 0) return [];
      return db
        .select()
        .from(snapshots)
        .where(
          and(
            inArray(snapshots.accountId, ids),
            from ? gte(snapshots.date, from) : undefined,
            to ? lte(snapshots.date, to) : undefined,
          ),
        )
        .orderBy(asc(snapshots.date))
        .all()
        .map(snapshotToApi);
    },
  );

  r.post(
    "/snapshots",
    {
      schema: {
        tags: snapshotTags,
        body: snapshotInput,
        response: { 201: snapshotSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const { accountId, date, balance, source } = request.body;
      requireAccount(db, request.userId, accountId);
      snapshotConflict(accountId, date);
      const row = {
        id: randomUUID(),
        accountId,
        date,
        balanceCents: eurosToCents(balance),
        source,
      };
      db.insert(snapshots).values(row).run();
      return reply.status(201).send(snapshotToApi(row));
    },
  );

  r.patch(
    "/snapshots/:id",
    {
      schema: {
        tags: snapshotTags,
        params: idParams,
        body: snapshotUpdateSchema,
        response: { 200: snapshotSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const current = findSnapshot(request.userId, request.params.id);
      const { date, balance, source } = request.body;
      if (date !== undefined) snapshotConflict(current.accountId, date, current.id);
      const next = {
        ...current,
        date: date ?? current.date,
        balanceCents: balance === undefined ? current.balanceCents : eurosToCents(balance),
        source: source ?? current.source,
      };
      db.update(snapshots).set(next).where(eq(snapshots.id, current.id)).run();
      return snapshotToApi(next);
    },
  );

  r.delete(
    "/snapshots/:id",
    {
      schema: {
        tags: snapshotTags,
        params: idParams,
        response: { 200: okSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = findSnapshot(request.userId, request.params.id);
      db.delete(snapshots).where(eq(snapshots.id, current.id)).run();
      return { ok: true as const };
    },
  );

  // Contributions
  const contributionTags = ["contributions"];
  const findContribution = (userId: string, id: string) => {
    const row = db.select().from(contributions).where(eq(contributions.id, id)).get();
    if (!row) throw notFound("Contribution");
    requireAccount(db, userId, row.accountId);
    return row;
  };

  r.get(
    "/contributions",
    {
      schema: {
        tags: contributionTags,
        summary: "List contributions, oldest first",
        querystring: listQuery,
        response: { 200: z.array(contributionSchema) },
      },
    },
    async (request) => {
      const { accountId, from, to } = request.query;
      if (accountId) requireAccount(db, request.userId, accountId);
      const ids = accountId ? [accountId] : ownedAccountIds(request.userId);
      if (ids.length === 0) return [];
      return db
        .select()
        .from(contributions)
        .where(
          and(
            inArray(contributions.accountId, ids),
            from ? gte(contributions.date, from) : undefined,
            to ? lte(contributions.date, to) : undefined,
          ),
        )
        .orderBy(asc(contributions.date))
        .all()
        .map(contributionToApi);
    },
  );

  r.post(
    "/contributions",
    {
      schema: {
        tags: contributionTags,
        body: contributionInput,
        response: { 201: contributionSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const { accountId, date, amount } = request.body;
      requireAccount(db, request.userId, accountId);
      const row = { id: randomUUID(), accountId, date, amountCents: eurosToCents(amount) };
      db.insert(contributions).values(row).run();
      return reply.status(201).send(contributionToApi(row));
    },
  );

  r.patch(
    "/contributions/:id",
    {
      schema: {
        tags: contributionTags,
        params: idParams,
        body: contributionUpdateSchema,
        response: { 200: contributionSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = findContribution(request.userId, request.params.id);
      const { date, amount } = request.body;
      const next = {
        ...current,
        date: date ?? current.date,
        amountCents: amount === undefined ? current.amountCents : eurosToCents(amount),
      };
      db.update(contributions).set(next).where(eq(contributions.id, current.id)).run();
      return contributionToApi(next);
    },
  );

  r.delete(
    "/contributions/:id",
    {
      schema: {
        tags: contributionTags,
        params: idParams,
        response: { 200: okSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = findContribution(request.userId, request.params.id);
      db.delete(contributions).where(eq(contributions.id, current.id)).run();
      return { ok: true as const };
    },
  );
}
