import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { tokens } from "../db/schema";
import { HttpError } from "../errors";
import { hashToken } from "./crypto";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    tokenId: string;
  }
}

/** Requires `Authorization: Bearer <token>` (a session token or an API token) on every route of the scope. */
export function requireAuth(app: FastifyInstance, db: Db, now: () => Date): void {
  app.decorateRequest("userId", "");
  app.decorateRequest("tokenId", "");
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) throw new HttpError(401, "unauthorized", "Missing bearer token");
    const timestamp = now().toISOString();
    const row = db
      .select()
      .from(tokens)
      .where(
        and(
          eq(tokens.tokenHash, hashToken(match[1]!)),
          or(isNull(tokens.expiresAt), gt(tokens.expiresAt, timestamp)),
        ),
      )
      .get();
    if (!row) throw new HttpError(401, "unauthorized", "Invalid or expired token");
    request.userId = row.userId;
    request.tokenId = row.id;
    db.update(tokens).set({ lastUsedAt: timestamp }).where(eq(tokens.id, row.id)).run();
  });
}
