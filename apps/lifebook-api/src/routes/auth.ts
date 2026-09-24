import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../auth/crypto";
import { tokens, users } from "../db/schema";
import { HttpError, conflict, notFound } from "../errors";
import { errorSchema, okSchema } from "../schemas";
import { timestamp, type RouteContext } from "./context";

const SESSION_DAYS = 30;
const credentials = z.object({ username: z.string().min(1), password: z.string().min(8) });
const sessionResponse = z.object({ token: z.string(), userId: z.string(), expiresAt: z.string() });

function issueSession(ctx: RouteContext, userId: string) {
  const token = generateToken();
  const expiresAt = new Date(ctx.now().getTime() + SESSION_DAYS * 86_400_000).toISOString();
  ctx.db
    .insert(tokens)
    .values({
      id: randomUUID(),
      userId,
      kind: "session",
      name: "session",
      tokenHash: hashToken(token),
      createdAt: timestamp(ctx.now),
      expiresAt,
    })
    .run();
  return { token, userId, expiresAt };
}

/** Routes that need no token: first-run setup and login. */
export async function publicAuthRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/auth/status",
    {
      schema: {
        tags: ["auth"],
        security: [],
        summary: "Whether the first user still has to be created",
        response: { 200: z.object({ setupRequired: z.boolean() }) },
      },
    },
    async () => ({ setupRequired: ctx.db.select().from(users).limit(1).all().length === 0 }),
  );

  r.post(
    "/auth/setup",
    {
      schema: {
        tags: ["auth"],
        security: [],
        summary: "Create the only user (allowed once)",
        body: credentials,
        response: { 201: sessionResponse, 409: errorSchema },
      },
    },
    async (request, reply) => {
      if (ctx.db.select().from(users).limit(1).all().length > 0) {
        throw conflict("The user has already been created");
      }
      const id = randomUUID();
      ctx.db
        .insert(users)
        .values({
          id,
          username: request.body.username,
          passwordHash: hashPassword(request.body.password),
          createdAt: timestamp(ctx.now),
        })
        .run();
      return reply.status(201).send(issueSession(ctx, id));
    },
  );

  r.post(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        security: [],
        summary: "Log in and get a session token",
        body: credentials,
        response: { 200: sessionResponse, 401: errorSchema },
      },
    },
    async (request) => {
      const user = ctx.db
        .select()
        .from(users)
        .where(eq(users.username, request.body.username))
        .get();
      // Hash even for an unknown user so the response time does not reveal which usernames exist.
      const valid = verifyPassword(request.body.password, user?.passwordHash ?? "00:00");
      if (!user || !valid) throw new HttpError(401, "unauthorized", "Invalid username or password");
      return issueSession(ctx, user.id);
    },
  );
}

export async function protectedAuthRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tokenInfo = z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  });

  r.get(
    "/auth/me",
    {
      schema: {
        tags: ["auth"],
        response: { 200: z.object({ userId: z.string(), username: z.string() }) },
      },
    },
    async (request) => {
      const user = ctx.db.select().from(users).where(eq(users.id, request.userId)).get()!;
      return { userId: user.id, username: user.username };
    },
  );

  r.post(
    "/auth/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Invalidate the current token",
        response: { 200: okSchema },
      },
    },
    async (request) => {
      ctx.db.delete(tokens).where(eq(tokens.id, request.tokenId)).run();
      return { ok: true as const };
    },
  );

  r.get(
    "/auth/tokens",
    {
      schema: { tags: ["auth"], summary: "List API tokens", response: { 200: z.array(tokenInfo) } },
    },
    async (request) =>
      ctx.db
        .select()
        .from(tokens)
        .where(and(eq(tokens.userId, request.userId), eq(tokens.kind, "api")))
        .all()
        .map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt })),
  );

  r.post(
    "/auth/tokens",
    {
      schema: {
        tags: ["auth"],
        summary: "Create an API token. The token is shown only in this response.",
        body: z.object({ name: z.string().min(1) }),
        response: { 201: tokenInfo.extend({ token: z.string() }) },
      },
    },
    async (request, reply) => {
      const token = generateToken();
      const row = {
        id: randomUUID(),
        userId: request.userId,
        kind: "api" as const,
        name: request.body.name,
        tokenHash: hashToken(token),
        createdAt: timestamp(ctx.now),
        expiresAt: null,
        lastUsedAt: null,
      };
      ctx.db.insert(tokens).values(row).run();
      return reply
        .status(201)
        .send({ id: row.id, name: row.name, createdAt: row.createdAt, lastUsedAt: null, token });
    },
  );

  r.delete(
    "/auth/tokens/:id",
    {
      schema: {
        tags: ["auth"],
        summary: "Revoke an API token",
        params: z.object({ id: z.string() }),
        response: { 200: okSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const result = ctx.db
        .delete(tokens)
        .where(
          and(
            eq(tokens.id, request.params.id),
            eq(tokens.userId, request.userId),
            eq(tokens.kind, "api"),
          ),
        )
        .run();
      if (result.changes === 0) throw notFound("Token");
      return { ok: true as const };
    },
  );
}
