import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { tokens, users } from "../db/schema";
import { HttpError } from "../errors";
import { hashToken } from "./crypto";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    userRole: "admin" | "user";
    tokenId: string;
  }
}

/** Throws 403 unless the authenticated user is an administrator. */
export function requireAdmin(request: FastifyRequest): void {
  if (request.userRole !== "admin") throw new HttpError(403, "forbidden", "Administrators only");
}

/** Requires `Authorization: Bearer <token>` (a session token or an API token) on every route of the scope. */
export function requireAuth(app: FastifyInstance, db: Db, now: () => Date): void {
  app.decorateRequest("userId", "");
  app.decorateRequest("userRole", "user");
  app.decorateRequest("tokenId", "");
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) throw new HttpError(401, "unauthorized", "Missing bearer token");
    const timestamp = now().toISOString();
    const row = db
      .select({ id: tokens.id, userId: tokens.userId, role: users.role })
      .from(tokens)
      .innerJoin(users, eq(users.id, tokens.userId))
      .where(
        and(
          eq(tokens.tokenHash, hashToken(match[1]!)),
          or(isNull(tokens.expiresAt), gt(tokens.expiresAt, timestamp)),
        ),
      )
      .get();
    if (!row) throw new HttpError(401, "unauthorized", "Invalid or expired token");
    request.userId = row.userId;
    request.userRole = row.role;
    request.tokenId = row.id;
    db.update(tokens).set({ lastUsedAt: timestamp }).where(eq(tokens.id, row.id)).run();
  });
}
