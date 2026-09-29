import { addMonths, endOfMonth, monthOf } from "@lifebook/finanze-core";
import { randomBytes } from "node:crypto";
import { buildApp } from "../../../api/src/app";
import { FakeFirefly } from "../../../api/test/fakeFirefly";
import { openDatabase } from "../../../api/src/db/client";

export interface Backend {
  app: Awaited<ReturnType<typeof buildApp>>;
  /** The Firefly III instance the API talks to. */
  firefly: FakeFirefly;
  /** Calls the real API in-process, as the browser would over HTTP. */
  call(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close(): Promise<void>;
}

/** A real Lifebook Finanze API on in-memory SQLite, with `fetch` routed to it. */
export async function startBackend(): Promise<Backend> {
  const { db, close } = openDatabase(":memory:");
  const firefly = new FakeFirefly();
  const app = await buildApp({ db, firefly: { secretKey: randomBytes(32), fetch: firefly.fetch } });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET",
      url,
      headers,
      ...(init?.body ? { payload: init.body as string } : {}),
    });
    return new Response(res.body || null, {
      status: res.statusCode,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return {
    app,
    firefly,
    async call(method, path, body, token) {
      const res = await app.inject({
        method: method as "GET",
        url: `/api/v1${path}`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(body === undefined ? {} : { payload: body as object }),
      });
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
    },
    async close() {
      globalThis.fetch = originalFetch;
      await app.close();
      close();
    },
  };
}

export const CREDENTIALS = { username: "tester", password: "correct-horse-battery" };

/** Creates the user, signs in the browser (localStorage) and returns the token. */
export async function signIn(backend: Backend): Promise<string> {
  const res = await backend.call("POST", "/auth/setup", CREDENTIALS);
  localStorage.setItem("lifebook.token", res.body.token);
  return res.body.token as string;
}

/** Month ends of the `months + 1` complete months before the current one, oldest first. */
export function pastMonthEnds(today: string, months = 12): string[] {
  const first = `${monthOf(today)}-01`;
  const ends: string[] = [];
  for (let back = months + 1; back >= 1; back--)
    ends.push(endOfMonth(monthOf(addMonths(first, -back))));
  return ends;
}

/**
 * Synthetic life through the API: spending account (+1000 a month: 3000 salary, 2000 spent), brokerage,
 * deposit at 0% and a primary residence. Returns the account ids.
 */
export async function seedLife(backend: Backend, token: string, today: string) {
  const post = async (path: string, body: object) => {
    const res = await backend.call("POST", path, body, token);
    if (res.status >= 300) throw new Error(`${path}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const chk = (
    await post("/accounts", {
      name: "Conto corrente",
      type: "checking",
      params: [{ validFrom: "2000-01-01", isSpendingAccount: true }],
    })
  ).id;
  const bro = (
    await post("/accounts", {
      name: "Titoli",
      type: "brokerage",
      params: [
        { validFrom: "2000-01-01", expectedReturn: 0.04, passiveYield: 0.02, taxRate: 0.26 },
      ],
    })
  ).id;
  const dep = (
    await post("/accounts", {
      name: "Deposito",
      type: "deposit",
      params: [{ validFrom: "2000-01-01", interestRate: 0, expectedReturn: 0.01 }],
    })
  ).id;
  const home = (
    await post("/accounts", {
      name: "Casa",
      type: "real_estate",
      realEstateUse: "primary_residence",
    })
  ).id;
  const dates = pastMonthEnds(today);
  await post("/income-items", {
    name: "Stipendio",
    kind: "recurring",
    amount: 3000,
    periodicity: "monthly",
    startDate: addMonths(dates[0]!, 1),
  });
  for (const [i, date] of dates.entries()) {
    for (const [accountId, balance] of [
      [chk, 20_000 + 1_000 * i],
      [bro, 500_000],
      [dep, 200_000],
      [home, 250_000],
    ] as const) {
      await post("/snapshots", { accountId, date, balance });
    }
  }
  return { chk, bro, dep, home, dates };
}
