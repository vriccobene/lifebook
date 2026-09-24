import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SETTINGS, resolveSettings, type SettingsEntry } from "@lifebook/core";
import { essentialSpending, incomeItems, settingsEntries } from "../db/schema";
import { notFound } from "../errors";
import { eurosToCents } from "../money";
import {
  essentialToApi,
  incomeToApi,
  settingsEntryToApi,
  settingsPatchFromJson,
  settingsPatchToJson,
} from "../repo";
import {
  dateSchema,
  errorSchema,
  essentialInputSchema,
  essentialSchema,
  idParams,
  incomeInputSchema,
  incomeSchema,
  okSchema,
  settingsEntryInput,
  settingsEntrySchema,
  settingsPatchSchema,
} from "../schemas";
import { today, type RouteContext } from "./context";

/** Income items, essential spending and settings. */
export async function planningRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = ctx;

  // Income items
  const incomeTags = ["income-items"];
  const incomeRow = (ownerId: string, id: string) => {
    const row = db
      .select()
      .from(incomeItems)
      .where(and(eq(incomeItems.id, id), eq(incomeItems.ownerId, ownerId)))
      .get();
    if (!row) throw notFound("Income item");
    return row;
  };
  const incomeColumns = (body: z.infer<typeof incomeInputSchema>) => ({
    name: body.name,
    amountCents: eurosToCents(body.amount),
    kind: body.kind,
    date: body.kind === "one_off" ? body.date : null,
    periodicity: body.kind === "recurring" ? body.periodicity : null,
    startDate: body.kind === "recurring" ? body.startDate : null,
    endDate: body.kind === "recurring" ? body.endDate : null,
  });

  r.get(
    "/income-items",
    { schema: { tags: incomeTags, response: { 200: z.array(incomeSchema) } } },
    async (request) =>
      db
        .select()
        .from(incomeItems)
        .where(eq(incomeItems.ownerId, request.userId))
        .all()
        .map(incomeToApi),
  );

  r.post(
    "/income-items",
    { schema: { tags: incomeTags, body: incomeInputSchema, response: { 201: incomeSchema } } },
    async (request, reply) => {
      const row = { id: randomUUID(), ownerId: request.userId, ...incomeColumns(request.body) };
      db.insert(incomeItems).values(row).run();
      return reply.status(201).send(incomeToApi(row));
    },
  );

  r.put(
    "/income-items/:id",
    {
      schema: {
        tags: incomeTags,
        summary: "Replace an income item",
        params: idParams,
        body: incomeInputSchema,
        response: { 200: incomeSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = incomeRow(request.userId, request.params.id);
      const next = { ...current, ...incomeColumns(request.body) };
      db.update(incomeItems).set(next).where(eq(incomeItems.id, current.id)).run();
      return incomeToApi(next);
    },
  );

  r.delete(
    "/income-items/:id",
    {
      schema: { tags: incomeTags, params: idParams, response: { 200: okSchema, 404: errorSchema } },
    },
    async (request) => {
      const current = incomeRow(request.userId, request.params.id);
      db.delete(incomeItems).where(eq(incomeItems.id, current.id)).run();
      return { ok: true as const };
    },
  );

  // Essential spending
  const essentialTags = ["essential-spending"];
  const essentialRow = (ownerId: string, id: string) => {
    const row = db
      .select()
      .from(essentialSpending)
      .where(and(eq(essentialSpending.id, id), eq(essentialSpending.ownerId, ownerId)))
      .get();
    if (!row) throw notFound("Essential spending entry");
    return row;
  };
  const essentialColumns = (body: z.infer<typeof essentialInputSchema>) => ({
    mode: body.mode,
    value: body.mode === "percent" ? body.value : eurosToCents(body.value),
    validFrom: body.mode === "month_amount" ? null : body.validFrom,
    month: body.mode === "month_amount" ? body.month : null,
  });

  r.get(
    "/essential-spending",
    {
      schema: {
        tags: essentialTags,
        summary: "History of the essential spending entries, in the three modes",
        response: { 200: z.array(essentialSchema) },
      },
    },
    async (request) =>
      db
        .select()
        .from(essentialSpending)
        .where(eq(essentialSpending.ownerId, request.userId))
        .all()
        .map(essentialToApi),
  );

  r.post(
    "/essential-spending",
    {
      schema: {
        tags: essentialTags,
        summary:
          "Add an entry: a percentage or fixed amount valid from a date, or the amount of one month",
        body: essentialInputSchema,
        response: { 201: essentialSchema },
      },
    },
    async (request, reply) => {
      const row = { id: randomUUID(), ownerId: request.userId, ...essentialColumns(request.body) };
      db.insert(essentialSpending).values(row).run();
      return reply.status(201).send(essentialToApi(row));
    },
  );

  r.put(
    "/essential-spending/:id",
    {
      schema: {
        tags: essentialTags,
        params: idParams,
        body: essentialInputSchema,
        response: { 200: essentialSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = essentialRow(request.userId, request.params.id);
      const next = { ...current, ...essentialColumns(request.body) };
      db.update(essentialSpending).set(next).where(eq(essentialSpending.id, current.id)).run();
      return essentialToApi(next);
    },
  );

  r.delete(
    "/essential-spending/:id",
    {
      schema: {
        tags: essentialTags,
        params: idParams,
        response: { 200: okSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = essentialRow(request.userId, request.params.id);
      db.delete(essentialSpending).where(eq(essentialSpending.id, current.id)).run();
      return { ok: true as const };
    },
  );

  // Settings
  const settingsTags = ["settings"];
  const settingsRow = (ownerId: string, id: string) => {
    const row = db
      .select()
      .from(settingsEntries)
      .where(and(eq(settingsEntries.id, id), eq(settingsEntries.ownerId, ownerId)))
      .get();
    if (!row) throw notFound("Settings entry");
    return row;
  };

  r.get(
    "/settings",
    {
      schema: {
        tags: settingsTags,
        summary:
          "The settings in force on a date (default today), plus the dated entries they come from",
        querystring: z.object({ asOf: dateSchema.optional() }),
        response: {
          200: z.object({
            asOf: dateSchema,
            effective: z.record(z.string(), z.unknown()),
            entries: z.array(settingsEntrySchema),
          }),
        },
      },
    },
    async (request) => {
      const asOf = request.query.asOf ?? today(ctx.now);
      const rows = db
        .select()
        .from(settingsEntries)
        .where(eq(settingsEntries.ownerId, request.userId))
        .all();
      const entries = rows.map(settingsEntryToApi);
      const effective = resolveSettings(
        rows.map(
          ({ validFrom, patch }) =>
            ({ validFrom, ...settingsPatchFromJson(patch) }) as SettingsEntry,
        ),
        asOf,
      );
      return { asOf, effective: effective as unknown as Record<string, unknown>, entries };
    },
  );

  r.get(
    "/settings/defaults",
    { schema: { tags: settingsTags, response: { 200: z.record(z.string(), z.unknown()) } } },
    async () => structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>,
  );

  r.post(
    "/settings",
    {
      schema: {
        tags: settingsTags,
        summary: "Add settings valid from a date (retroactive dates allowed)",
        body: settingsEntryInput,
        response: { 201: settingsEntrySchema },
      },
    },
    async (request, reply) => {
      const { validFrom, ...patch } = request.body;
      const row = {
        id: randomUUID(),
        ownerId: request.userId,
        validFrom,
        patch: settingsPatchToJson(patch),
      };
      db.insert(settingsEntries).values(row).run();
      return reply.status(201).send(settingsEntryToApi(row));
    },
  );

  r.patch(
    "/settings/:id",
    {
      schema: {
        tags: settingsTags,
        params: idParams,
        body: settingsPatchSchema.extend({ validFrom: dateSchema.optional() }),
        response: { 200: settingsEntrySchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = settingsRow(request.userId, request.params.id);
      const { validFrom, ...patch } = request.body;
      const stored = settingsPatchFromJson(current.patch);
      const merged: Record<string, unknown> = { ...stored };
      for (const [key, value] of Object.entries(patch)) {
        const existing = merged[key];
        merged[key] =
          value !== null && typeof value === "object" && existing && typeof existing === "object"
            ? { ...existing, ...value }
            : value;
      }
      const next = {
        ...current,
        validFrom: validFrom ?? current.validFrom,
        patch: settingsPatchToJson(merged),
      };
      db.update(settingsEntries).set(next).where(eq(settingsEntries.id, current.id)).run();
      return settingsEntryToApi(next);
    },
  );

  r.delete(
    "/settings/:id",
    {
      schema: {
        tags: settingsTags,
        params: idParams,
        response: { 200: okSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const current = settingsRow(request.userId, request.params.id);
      db.delete(settingsEntries).where(eq(settingsEntries.id, current.id)).run();
      return { ok: true as const };
    },
  );
}
