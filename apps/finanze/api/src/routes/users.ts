import { and, eq, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashPassword } from "../auth/crypto";
import { requireAdmin } from "../auth/plugin";
import * as t from "../db/schema";
import { conflict, notFound } from "../errors";
import { errorSchema, idParams, okSchema } from "../schemas";
import { passwordSchema } from "./auth";
import { timestamp, type RouteContext } from "./context";
import { deleteUserAndData } from "../userAdmin";

const roleSchema = z.enum(["admin", "user"]);
const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: roleSchema,
  createdAt: z.string(),
});

const toApi = ({ id, username, role, createdAt }: typeof t.users.$inferSelect) => ({
  id,
  username,
  role,
  createdAt,
});

/**
 * User management, for administrators only. Administrators manage accounts but never see the financial data
 * of the other users: every data route stays scoped to the caller.
 */
export async function userRoutes(app: FastifyInstance, ctx: RouteContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db } = ctx;
  const tags = ["users"];
  app.addHook("preHandler", async (request) => requireAdmin(request));

  const find = (id: string) => {
    const row = db.select().from(t.users).where(eq(t.users.id, id)).get();
    if (!row) throw notFound("User");
    return row;
  };
  const otherAdmins = (id: string) =>
    db
      .select({ id: t.users.id })
      .from(t.users)
      .where(and(eq(t.users.role, "admin"), ne(t.users.id, id)))
      .all().length;

  r.get(
    "/users",
    {
      schema: {
        tags,
        summary: "List the users (administrators only)",
        response: { 200: z.array(userSchema), 403: errorSchema },
      },
    },
    async () => db.select().from(t.users).orderBy(t.users.createdAt).all().map(toApi),
  );

  r.post(
    "/users",
    {
      schema: {
        tags,
        summary: "Create a user (administrators only). There is no self-registration.",
        body: z.object({
          username: z.string().trim().min(1).max(64),
          password: passwordSchema,
          role: roleSchema.default("user"),
        }),
        response: { 201: userSchema, 403: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const { username, password, role } = request.body;
      const taken = db
        .select({ id: t.users.id })
        .from(t.users)
        .where(sql`lower(${t.users.username}) = lower(${username})`)
        .get();
      if (taken) throw conflict("A user with that name already exists");
      const row = {
        id: randomUUID(),
        username,
        passwordHash: hashPassword(password),
        role,
        createdAt: timestamp(ctx.now),
      };
      db.insert(t.users).values(row).run();
      return reply.status(201).send(toApi(row));
    },
  );

  r.patch(
    "/users/:id",
    {
      schema: {
        tags,
        summary:
          "Change a user's role or reset their password (administrators only). A reset closes their sessions.",
        params: idParams,
        body: z.object({ role: roleSchema, password: passwordSchema }).partial().strict(),
        response: { 200: userSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const user = find(request.params.id);
      const { role, password } = request.body;
      if (role === "user" && user.role === "admin" && otherAdmins(user.id) === 0) {
        throw conflict("There must be at least one administrator");
      }
      db.transaction((tx) => {
        if (role) tx.update(t.users).set({ role }).where(eq(t.users.id, user.id)).run();
        if (password) {
          tx.update(t.users)
            .set({ passwordHash: hashPassword(password) })
            .where(eq(t.users.id, user.id))
            .run();
          tx.delete(t.tokens)
            .where(and(eq(t.tokens.userId, user.id), eq(t.tokens.kind, "session")))
            .run();
        }
      });
      return toApi(find(user.id));
    },
  );

  r.delete(
    "/users/:id",
    {
      schema: {
        tags,
        summary:
          "Delete a user and all their data (administrators only). You cannot delete yourself.",
        params: idParams,
        response: { 200: okSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const user = find(request.params.id);
      if (user.id === request.userId) throw conflict("You cannot delete your own user");
      deleteUserAndData(db, user.id);
      return { ok: true as const };
    },
  );
}
