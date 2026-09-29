import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { accountParams, accounts, contributions, snapshots } from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { accountPatchToJson, accountToApi, paramsEntry, requireAccount } from "../repo";
import {
  accountCreateSchema,
  accountParamsEntryInput,
  accountParamsEntrySchema,
  accountParamsPatchSchema,
  accountSchema,
  accountUpdateSchema,
  errorSchema,
  idParams,
  okSchema,
} from "../schemas";
import type { RouteContext } from "./context";

function checkRealEstateUse(type: string, use: string | null | undefined): void {
  if (type === "real_estate" && !use)
    throw badRequest("realEstateUse is required for real estate accounts");
  if (type !== "real_estate" && use)
    throw badRequest("realEstateUse only applies to real estate accounts");
}

export async function accountRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = ctx;
  const load = (userId: string, id: string) => {
    const row = requireAccount(db, userId, id);
    const params = db.select().from(accountParams).where(eq(accountParams.accountId, id)).all();
    return accountToApi(row, params);
  };
  const tags = ["accounts"];

  r.get(
    "/accounts",
    {
      schema: {
        tags,
        summary: "List accounts, archived ones included",
        response: { 200: z.array(accountSchema) },
      },
    },
    async (request) => {
      const rows = db.select().from(accounts).where(eq(accounts.ownerId, request.userId)).all();
      const ids = rows.map((row) => row.id);
      const params = ids.length
        ? db.select().from(accountParams).where(inArray(accountParams.accountId, ids)).all()
        : [];
      return rows.map((row) =>
        accountToApi(
          row,
          params.filter((p) => p.accountId === row.id),
        ),
      );
    },
  );

  r.post(
    "/accounts",
    {
      schema: {
        tags,
        summary: "Create an account, optionally with its dated parameters",
        body: accountCreateSchema,
        response: { 201: accountSchema, 400: errorSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      checkRealEstateUse(body.type, body.realEstateUse);
      const id = randomUUID();
      db.transaction((tx) => {
        tx.insert(accounts)
          .values({
            id,
            ownerId: request.userId,
            name: body.name,
            institution: body.institution ?? null,
            type: body.type,
            realEstateUse: body.realEstateUse ?? null,
            contributionsMode:
              body.contributionsMode ?? (body.type === "deposit" ? "inferred" : "declared"),
            countsAsLivingCost: body.countsAsLivingCost ?? true,
            archivedAt: null,
          })
          .run();
        for (const { validFrom, ...patch } of body.params ?? []) {
          tx.insert(accountParams)
            .values({
              id: randomUUID(),
              accountId: id,
              validFrom,
              patch: accountPatchToJson(patch),
            })
            .run();
        }
      });
      return reply.status(201).send(load(request.userId, id));
    },
  );

  r.get(
    "/accounts/:id",
    { schema: { tags, params: idParams, response: { 200: accountSchema, 404: errorSchema } } },
    async (request) => load(request.userId, request.params.id),
  );

  r.patch(
    "/accounts/:id",
    {
      schema: {
        tags,
        summary: "Update an account. Set archivedAt to archive it (soft delete).",
        params: idParams,
        body: accountUpdateSchema,
        response: { 200: accountSchema, 400: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = requireAccount(db, request.userId, request.params.id);
      const body = request.body;
      checkRealEstateUse(
        current.type,
        body.realEstateUse === undefined ? current.realEstateUse : body.realEstateUse,
      );
      if (Object.keys(body).length > 0) {
        db.update(accounts)
          .set(body as Partial<typeof accounts.$inferInsert>)
          .where(eq(accounts.id, current.id))
          .run();
      }
      return load(request.userId, current.id);
    },
  );

  r.delete(
    "/accounts/:id",
    {
      schema: {
        tags,
        summary: "Delete an account that has no data. Otherwise archive it.",
        params: idParams,
        response: { 200: okSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const account = requireAccount(db, request.userId, request.params.id);
      const hasData =
        db.select().from(snapshots).where(eq(snapshots.accountId, account.id)).limit(1).all()
          .length > 0 ||
        db
          .select()
          .from(contributions)
          .where(eq(contributions.accountId, account.id))
          .limit(1)
          .all().length > 0;
      if (hasData) throw conflict("The account has snapshots or contributions: archive it instead");
      db.delete(accounts).where(eq(accounts.id, account.id)).run();
      return { ok: true as const };
    },
  );

  // Dated parameters
  const paramsParams = z.object({ id: z.string(), paramId: z.string() });
  const findParam = (userId: string, id: string, paramId: string) => {
    requireAccount(db, userId, id);
    const row = db
      .select()
      .from(accountParams)
      .where(and(eq(accountParams.id, paramId), eq(accountParams.accountId, id)))
      .get();
    if (!row) throw notFound("Parameter entry");
    return row;
  };

  r.get(
    "/accounts/:id/params",
    { schema: { tags, params: idParams, response: { 200: z.array(accountParamsEntrySchema) } } },
    async (request) => {
      requireAccount(db, request.userId, request.params.id);
      return db
        .select()
        .from(accountParams)
        .where(eq(accountParams.accountId, request.params.id))
        .all()
        .map(paramsEntry);
    },
  );

  r.post(
    "/accounts/:id/params",
    {
      schema: {
        tags,
        summary: "Add a parameter entry valid from a date (retroactive dates allowed)",
        params: idParams,
        body: accountParamsEntryInput,
        response: { 201: accountParamsEntrySchema },
      },
    },
    async (request, reply) => {
      requireAccount(db, request.userId, request.params.id);
      const { validFrom, ...patch } = request.body;
      const row = {
        id: randomUUID(),
        accountId: request.params.id,
        validFrom,
        patch: accountPatchToJson(patch),
      };
      db.insert(accountParams).values(row).run();
      return reply.status(201).send(paramsEntry(row));
    },
  );

  r.patch(
    "/accounts/:id/params/:paramId",
    {
      schema: {
        tags,
        params: paramsParams,
        body: accountParamsPatchSchema.extend({
          validFrom: accountParamsEntryInput.shape.validFrom.optional(),
        }),
        response: { 200: accountParamsEntrySchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = findParam(request.userId, request.params.id, request.params.paramId);
      const { validFrom, ...patch } = request.body;
      const merged = { ...JSON.parse(current.patch), ...JSON.parse(accountPatchToJson(patch)) };
      const next = {
        ...current,
        validFrom: validFrom ?? current.validFrom,
        patch: JSON.stringify(merged),
      };
      db.update(accountParams).set(next).where(eq(accountParams.id, current.id)).run();
      return paramsEntry(next);
    },
  );

  r.delete(
    "/accounts/:id/params/:paramId",
    { schema: { tags, params: paramsParams, response: { 200: okSchema, 404: errorSchema } } },
    async (request) => {
      const current = findParam(request.userId, request.params.id, request.params.paramId);
      db.delete(accountParams).where(eq(accountParams.id, current.id)).run();
      return { ok: true as const };
    },
  );
}
