import swagger from "@fastify/swagger";
import fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { requireAuth } from "./auth/plugin";
import type { Db } from "./db/client";
import { HttpError } from "./errors";
import { accountRoutes } from "./routes/accounts";
import { protectedAuthRoutes, publicAuthRoutes } from "./routes/auth";
import type { RouteContext } from "./routes/context";
import { fireflyRoutes, type FireflyOptions } from "./routes/firefly";
import { ledgerRoutes } from "./routes/ledger";
import { planningRoutes } from "./routes/planning";
import { resultRoutes } from "./routes/results";
import { userRoutes } from "./routes/users";

export const API_PREFIX = "/api/v1";

export interface AppOptions {
  db: Db;
  /** Injectable clock, for tests. */
  now?: () => Date;
  logger?: boolean;
  /** Firefly III integration: the key that encrypts the tokens, and an injectable fetch for tests. */
  firefly?: FireflyOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const ctx: RouteContext = {
    db: options.db,
    now: options.now ?? (() => new Date()),
    firefly: options.firefly ?? {},
  };
  const app = fastify({
    logger: options.logger ? { redact: ["req.headers.authorization"], level: "info" } : false,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Lifebook Finanze API",
        version: "0.1.0",
        description: "REST API of Lifebook Finanze.",
      },
      servers: [{ url: API_PREFIX }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler((error: FastifyError | HttpError, _request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .status(error.status)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const message = error.validation
        .map((issue) => `${issue.instancePath || "/"} ${issue.message}`.trim())
        .join("; ");
      return reply.status(400).send({ error: { code: "validation_error", message } });
    }
    const status = (error as FastifyError).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.status(status).send({
      error: {
        code: status >= 500 ? "internal_error" : "bad_request",
        message: status >= 500 ? "Internal server error" : error.message,
      },
    });
  });

  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));

  await app.register(
    async (api) => {
      await api.register(publicAuthRoutes, ctx);
      api.get("/openapi.json", { schema: { hide: true } }, async () => api.swagger());
      await api.register(async (secured) => {
        requireAuth(secured, ctx.db, ctx.now);
        await secured.register(protectedAuthRoutes, ctx);
        await secured.register(accountRoutes, ctx);
        await secured.register(ledgerRoutes, ctx);
        await secured.register(planningRoutes, ctx);
        await secured.register(resultRoutes, ctx);
        await secured.register(userRoutes, ctx);
        await secured.register(fireflyRoutes, ctx);
      });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
