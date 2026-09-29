import type { FastifyInstance } from "fastify";
import { buildApp, API_PREFIX, type AppOptions } from "../src/app";
import { openDatabase, type Db } from "../src/db/client";

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  clock: { current: Date };
  close: () => Promise<void>;
}

/** A fresh in-memory database and app with a controllable clock. */
export async function createTestApp(
  now = "2026-12-31T12:00:00Z",
  options: Pick<AppOptions, "firefly"> = {},
): Promise<TestApp> {
  const { db, close } = openDatabase(":memory:");
  const clock = { current: new Date(now) };
  const app = await buildApp({ db, now: () => clock.current, ...options });
  return {
    app,
    db,
    clock,
    close: async () => {
      await app.close();
      close();
    },
  };
}

export interface Response {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export function client(app: FastifyInstance, token?: string) {
  const call = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
  ) => {
    const res = await app.inject({
      method,
      url: `${API_PREFIX}${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const text = res.body;
    return { status: res.statusCode, body: text ? JSON.parse(text) : null } as Response;
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, body?: unknown) => call("POST", url, body ?? {}),
    put: (url: string, body: unknown) => call("PUT", url, body),
    patch: (url: string, body: unknown) => call("PATCH", url, body),
    delete: (url: string) => call("DELETE", url),
  };
}

export const CREDENTIALS = { username: "tester", password: "correct-horse-battery" };

/** Creates the only user through the public setup endpoint and returns an authenticated client. */
export async function setupUser(app: FastifyInstance) {
  const res = await client(app).post("/auth/setup", CREDENTIALS);
  if (res.status !== 201) throw new Error(`setup failed: ${JSON.stringify(res.body)}`);
  return {
    token: res.body.token as string,
    userId: res.body.userId as string,
    api: client(app, res.body.token),
  };
}

export type Api = ReturnType<typeof client>;

/** Creates another user through the admin API, logs them in and returns their client. */
export async function addUser(
  app: FastifyInstance,
  admin: Api,
  username: string,
  role: "admin" | "user" = "user",
) {
  const password = `${username}-password`;
  const created = await admin.post("/users", { username, password, role });
  if (created.status !== 201)
    throw new Error(`user creation failed: ${JSON.stringify(created.body)}`);
  const login = await client(app).post("/auth/login", { username, password });
  return {
    id: created.body.id as string,
    password,
    token: login.body.token as string,
    api: client(app, login.body.token),
  };
}

/** Twelve monthly readings of 2026 plus the opening one on 2025-12-31. */
export const MONTH_ENDS = [
  "2026-01-31",
  "2026-02-28",
  "2026-03-31",
  "2026-04-30",
  "2026-05-31",
  "2026-06-30",
  "2026-07-31",
  "2026-08-31",
  "2026-09-30",
  "2026-10-31",
  "2026-11-30",
  "2026-12-31",
];

/**
 * Synthetic life entered through the API: a spending account (3000 salary, 2000 spent, so +1000 a month),
 * a 500k brokerage (declared), a 200k deposit at 0% interest (inferred) and a primary residence.
 */
export async function seedLife(api: Api, options: { months?: number } = {}) {
  const months = options.months ?? 12;
  const create = async (body: object) => {
    const res = await api.post("/accounts", body);
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body.id as string;
  };
  const chk = await create({
    name: "Checking",
    type: "checking",
    params: [{ validFrom: "2000-01-01", isSpendingAccount: true }],
  });
  const bro = await create({
    name: "Brokerage",
    type: "brokerage",
    params: [{ validFrom: "2000-01-01", expectedReturn: 0.04, passiveYield: 0.02, taxRate: 0.26 }],
  });
  const dep = await create({
    name: "Deposit",
    type: "deposit",
    params: [{ validFrom: "2000-01-01", interestRate: 0, expectedReturn: 0.01 }],
  });
  const home = await create({
    name: "Home",
    type: "real_estate",
    realEstateUse: "primary_residence",
  });

  await api.post("/income-items", {
    name: "Salary",
    kind: "recurring",
    amount: 3000,
    periodicity: "monthly",
    startDate: "2026-01-31",
  });

  const dates = ["2025-12-31", ...MONTH_ENDS.slice(0, months)];
  for (const [i, date] of dates.entries()) {
    for (const [accountId, balance] of [
      [chk, 20_000 + 1_000 * i],
      [bro, 500_000],
      [dep, 200_000],
      [home, 250_000],
    ] as const) {
      const res = await api.post("/snapshots", { accountId, date, balance });
      if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    }
  }
  return { chk, bro, dep, home };
}
