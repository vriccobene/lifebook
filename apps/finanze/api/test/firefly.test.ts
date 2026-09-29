import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { normalizeBaseUrl } from "../src/firefly/client";
import { monthEnds } from "../src/firefly/plan";
import { FAKE_TOKEN, FAKE_URL, FakeFirefly } from "./fakeFirefly";
import { addUser, createTestApp, setupUser, type Api, type TestApp } from "./helpers";

let t: TestApp;
let api: Api;
let ff: FakeFirefly;
const secretKey = randomBytes(32);

/**
 * The same life in Firefly III: a checking account, a savings deposit, a broker opened in March, a mortgage,
 * plus expense and revenue accounts and a dollar account Lifebook cannot import.
 */
function seedFirefly(fake: FakeFirefly) {
  fake.accounts = [
    {
      id: "1",
      name: "BBVA",
      type: "asset",
      role: "defaultAsset",
      openingBalance: 10_000,
      openingDate: "2026-01-01",
    },
    {
      id: "2",
      name: "Risparmi",
      type: "asset",
      role: "savingAsset",
      openingBalance: 50_000,
      openingDate: "2026-01-01",
    },
    { id: "3", name: "Broker", type: "asset", role: "sharedAsset" },
    {
      id: "4",
      name: "Mutuo casa",
      type: "liabilities",
      liabilityType: "mortgage",
      openingBalance: -100_000,
      openingDate: "2026-01-01",
    },
    {
      id: "5",
      name: "Conto USD",
      type: "asset",
      role: "defaultAsset",
      currency: "USD",
      openingBalance: 100,
      openingDate: "2026-01-01",
    },
    { id: "90", name: "Datore di lavoro", type: "revenue" },
    { id: "91", name: "Supermercato", type: "expense" },
    { id: "92", name: "Dividendi", type: "revenue" },
  ];
  fake.transactions = [
    {
      id: "101",
      date: "2026-01-27",
      amount: 3000,
      source: "90",
      destination: "1",
      description: "Stipendio",
    },
    {
      id: "102",
      date: "2026-01-28",
      amount: 1200,
      source: "1",
      destination: "91",
      description: "Spesa",
    },
    {
      id: "103",
      date: "2026-02-10",
      amount: 2000,
      source: "1",
      destination: "2",
      description: "Risparmio",
    },
    {
      id: "104",
      date: "2026-03-10",
      amount: 5000,
      source: "1",
      destination: "3",
      description: "Investimento",
    },
    {
      id: "105",
      date: "2026-04-05",
      amount: 800,
      source: "1",
      destination: "4",
      description: "Rata",
    },
    {
      id: "106",
      date: "2026-05-12",
      amount: 1000,
      source: "3",
      destination: "1",
      description: "Disinvestimento",
    },
    {
      id: "107",
      date: "2026-06-01",
      amount: 50,
      source: "92",
      destination: "3",
      description: "Cedola",
    },
  ];
}

async function createAccounts(client: Api) {
  const create = async (body: object) => (await client.post("/accounts", body)).body.id as string;
  return {
    chk: await create({
      name: "Conto",
      type: "checking",
      params: [{ validFrom: "2000-01-01", isSpendingAccount: true }],
    }),
    dep: await create({ name: "Deposito", type: "deposit" }),
    bro: await create({ name: "Titoli", type: "brokerage" }),
    mortgage: await create({ name: "Mutuo", type: "liability" }),
  };
}

async function connectAndLink(client: Api) {
  expect(
    (await client.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN })).status,
  ).toBe(200);
  const ids = await createAccounts(client);
  for (const [ffId, accountId] of [
    ["1", ids.chk],
    ["2", ids.dep],
    ["3", ids.bro],
    ["4", ids.mortgage],
  ] as const) {
    expect((await client.put(`/firefly/links/${ffId}`, { accountId })).status).toBe(200);
  }
  return ids;
}

const RANGE = { from: "2026-01-01", to: "2026-06-30" };

beforeEach(async () => {
  ff = new FakeFirefly();
  seedFirefly(ff);
  t = await createTestApp("2026-12-31T12:00:00Z", { firefly: { secretKey, fetch: ff.fetch } });
  api = (await setupUser(t.app)).api;
});
afterEach(async () => {
  await t.close();
});

describe("Firefly III connection", () => {
  it("checks the token, stores it encrypted and never returns it", async () => {
    expect((await api.get("/firefly/connection")).body).toEqual({
      configured: false,
      available: true,
      baseUrl: null,
      lastImportAt: null,
    });
    const res = await api.put("/firefly/connection", {
      baseUrl: `${FAKE_URL}/api/v1/`,
      token: FAKE_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      baseUrl: FAKE_URL,
      fireflyVersion: "6.4.4",
    });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify((await api.get("/firefly/connection")).body)).not.toContain(FAKE_TOKEN);

    const [row] = t.db.select().from(schema.fireflyConnections).all();
    expect(row!.tokenEncrypted).not.toContain(FAKE_TOKEN);
    expect(ff.requests.at(-1)!.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("refuses a wrong token, an unreachable server and a page that is not Firefly III", async () => {
    const wrong = await api.put("/firefly/connection", { baseUrl: FAKE_URL, token: "nope" });
    expect(wrong.status).toBe(502);
    expect(wrong.body.error.code).toBe("firefly_unauthorized");
    const unreachable = await api.put("/firefly/connection", {
      baseUrl: "https://elsewhere.example.com",
      token: FAKE_TOKEN,
    });
    expect(unreachable.body.error.code).toBe("firefly_unreachable");
    ff.override = () => new Response("<html>login</html>", { status: 200 });
    const html = await api.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
    expect(html.body.error.code).toBe("firefly_bad_response");
    expect(html.body.error.message).not.toContain("login"); // the remote body is never echoed
    expect(t.db.select().from(schema.fireflyConnections).all()).toEqual([]);
  });

  it("validates the URL", async () => {
    for (const baseUrl of [
      "not a url",
      "ftp://firefly.example.com",
      "https://me:pw@firefly.example.com",
    ]) {
      expect(
        (await api.put("/firefly/connection", { baseUrl, token: FAKE_TOKEN })).status,
        baseUrl,
      ).toBe(400);
    }
    expect(normalizeBaseUrl("http://192.168.1.10:8080/firefly/api/")).toBe(
      "http://192.168.1.10:8080/firefly",
    );
  });

  it("is disabled, not broken, when the server has no encryption key", async () => {
    const bare = await createTestApp();
    try {
      const { api: other } = await setupUser(bare.app);
      expect((await other.get("/firefly/connection")).body.available).toBe(false);
      const res = await other.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
      expect(res.status).toBe(503);
    } finally {
      await bare.close();
    }
  });

  it("asks for the token again when the server key changed (regression)", async () => {
    await api.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
    const [row] = t.db.select().from(schema.fireflyConnections).all();
    t.db
      .update(schema.fireflyConnections)
      .set({ tokenEncrypted: row!.tokenEncrypted.replace(/.$/, (c) => (c === "A" ? "B" : "A")) })
      .run();
    const res = await api.get("/firefly/accounts");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("firefly_token_unreadable");
  });

  it("drops the links when switching to another Firefly III, and keeps them on a new token", async () => {
    await connectAndLink(api);
    await api.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
    expect(t.db.select().from(schema.fireflyLinks).all()).toHaveLength(4);
    // As if the links had been made on another instance: the stored URL differs from the new one.
    t.db.update(schema.fireflyConnections).set({ baseUrl: "https://old.example.com" }).run();
    await api.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
    expect(t.db.select().from(schema.fireflyLinks).all()).toEqual([]);
  });

  it("forgets the token on disconnect", async () => {
    await api.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
    expect((await api.delete("/firefly/connection")).status).toBe(200);
    expect((await api.get("/firefly/connection")).body.configured).toBe(false);
    expect((await api.get("/firefly/accounts")).status).toBe(409);
  });
});

describe("Firefly III accounts and links", () => {
  it("lists asset and liability accounts across pages, with a suggested type", async () => {
    await api.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
    const res = await api.get("/firefly/accounts");
    expect(res.status).toBe(200);
    expect(res.body.map((a: { name: string }) => a.name)).toEqual([
      "BBVA",
      "Risparmi",
      "Broker",
      "Conto USD",
      "Mutuo casa",
    ]);
    const byName = Object.fromEntries(res.body.map((a: { name: string }) => [a.name, a]));
    expect(byName.BBVA).toMatchObject({
      suggestedType: "checking",
      kind: "asset",
      balance: 5_000,
    });
    expect(byName.Risparmi).toMatchObject({ suggestedType: "deposit" });
    expect(byName["Mutuo casa"]).toMatchObject({
      suggestedType: "liability",
      kind: "liability",
      role: "mortgage",
    });
    expect(byName["Conto USD"].currencyCode).toBe("USD");
  });

  it("shows the links and refuses someone else's account or a double link", async () => {
    const ids = await connectAndLink(api);
    const listed = (await api.get("/firefly/accounts")).body;
    expect(listed.find((a: { id: string }) => a.id === "3").linkedAccountId).toBe(ids.bro);

    expect((await api.put("/firefly/links/5", { accountId: ids.bro })).status).toBe(409);
    const anna = await addUser(t.app, api, "anna");
    const annaAccount = (await anna.api.post("/accounts", { name: "Suo", type: "checking" })).body
      .id;
    expect((await api.put("/firefly/links/5", { accountId: annaAccount })).status).toBe(404);

    // Relinking the same Firefly III account moves the link.
    const other = (await api.post("/accounts", { name: "Altro", type: "brokerage" })).body.id;
    expect((await api.put("/firefly/links/3", { accountId: other })).status).toBe(200);
    expect(t.db.select().from(schema.fireflyLinks).all()).toHaveLength(4);
    expect((await api.delete("/firefly/links/3")).status).toBe(200);
    expect((await api.delete("/firefly/links/3")).status).toBe(404);
  });
});

describe("Firefly III import", () => {
  it("previews without writing anything", async () => {
    await connectAndLink(api);
    const res = await api.post("/firefly/import", { ...RANGE, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.dates).toEqual(monthEnds(RANGE.from, RANGE.to));
    expect(
      res.body.accounts.find((a: { accountName: string }) => a.accountName === "Conto").snapshots
        .created,
    ).toBe(6);
    expect((await api.get("/snapshots")).body).toEqual([]);
    expect((await api.get("/contributions")).body).toEqual([]);
    expect((await api.get("/firefly/connection")).body.lastImportAt).toBeNull();
  });

  it("imports month-end balances and the transfers of declared accounts", async () => {
    const ids = await connectAndLink(api);
    const res = await api.post("/firefly/import", RANGE);
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);

    const snapshots = (await api.get("/snapshots")).body as {
      accountId: string;
      date: string;
      balance: number;
      source: string;
    }[];
    const of = (id: string) =>
      snapshots.filter((s) => s.accountId === id).map((s) => [s.date, s.balance]);
    expect(of(ids.chk)).toEqual([
      ["2026-01-31", 11_800],
      ["2026-02-28", 9_800],
      ["2026-03-31", 4_800],
      ["2026-04-30", 4_000],
      ["2026-05-31", 5_000],
      ["2026-06-30", 5_000],
    ]);
    // The broker did not exist before March: no fake zero balances.
    expect(of(ids.bro)).toEqual([
      ["2026-03-31", 5_000],
      ["2026-04-30", 5_000],
      ["2026-05-31", 4_000],
      ["2026-06-30", 4_050],
    ]);
    // Liabilities are negative in Lifebook.
    expect(of(ids.mortgage)[0]).toEqual(["2026-01-31", -100_000]);
    expect(of(ids.mortgage)[3]).toEqual(["2026-04-30", -99_200]);
    expect(of(ids.dep)).toHaveLength(6);
    expect(new Set(snapshots.map((s) => s.source))).toEqual(new Set(["firefly"]));

    // Transfers: + on the account that receives, − on the one that gives, only on declared accounts.
    // The salary, the groceries, the dividend and the move to the (inferred) deposit are not contributions.
    const contributions = (await api.get("/contributions")).body.map(
      (c: { accountId: string; date: string; amount: number }) => [c.accountId, c.date, c.amount],
    );
    expect(contributions).toEqual([
      [ids.bro, "2026-03-10", 5_000],
      [ids.mortgage, "2026-04-05", 800],
      [ids.bro, "2026-05-12", -1_000],
    ]);
    expect((await api.get("/firefly/connection")).body.lastImportAt).toBe(
      "2026-12-31T12:00:00.000Z",
    );

    // The imported history feeds the results.
    const netWorth = (await api.get("/results/net-worth?asOf=2026-06-30")).body.netWorth;
    expect(netWorth).toBe(5_000 + 52_000 + 4_050 - 99_200);
  });

  it("is idempotent and follows edits and deletions made in Firefly III (regression)", async () => {
    const ids = await connectAndLink(api);
    await api.post("/firefly/import", RANGE);
    const again = await api.post("/firefly/import", RANGE);
    for (const account of again.body.accounts) {
      expect(account.snapshots.created + account.snapshots.updated).toBe(0);
      expect(account.contributions.created + account.contributions.updated).toBe(0);
    }
    expect((await api.get("/snapshots")).body).toHaveLength(6 + 6 + 4 + 6);
    expect((await api.get("/contributions")).body).toHaveLength(3);

    ff.transactions = ff.transactions.filter((tx) => tx.id !== "105"); // mortgage payment deleted
    ff.transactions.find((tx) => tx.id === "106")!.amount = 1_500; // amount corrected
    ff.transactions.find((tx) => tx.id === "104")!.date = "2026-03-11"; // date corrected
    const edited = await api.post("/firefly/import", RANGE);
    const bro = edited.body.accounts.find((a: { accountId: string }) => a.accountId === ids.bro);
    expect(bro.contributions).toMatchObject({ updated: 2, deleted: 0 });
    expect(bro.snapshots.updated).toBe(2); // May and June balances changed
    const contributions = (await api.get("/contributions")).body.map(
      (c: { accountId: string; date: string; amount: number }) => [c.accountId, c.date, c.amount],
    );
    expect(contributions).toEqual([
      [ids.bro, "2026-03-11", 5_000],
      [ids.bro, "2026-05-12", -1_500],
    ]);
  });

  it("never overwrites what the user entered by hand", async () => {
    const ids = await connectAndLink(api);
    await api.post("/snapshots", { accountId: ids.chk, date: "2026-01-31", balance: 11_000 });
    await api.post("/snapshots", { accountId: ids.chk, date: "2026-02-28", balance: 9_800 });
    await api.post("/contributions", { accountId: ids.bro, date: "2026-03-10", amount: 5_000 });

    const res = await api.post("/firefly/import", RANGE);
    const chk = res.body.accounts.find((a: { accountId: string }) => a.accountId === ids.chk);
    expect(chk.snapshots).toMatchObject({ created: 4, kept: 1, unchanged: 1 });
    expect(res.body.warnings).toEqual([
      { code: "manual_snapshot_differs", accountId: ids.chk, date: "2026-01-31", detail: "11800" },
    ]);
    const jan = (await api.get(`/snapshots?accountId=${ids.chk}`)).body[0];
    expect(jan).toMatchObject({ balance: 11_000, source: "manual" });

    // The transfer already entered from the Transfers screen is not counted twice.
    const bro = res.body.accounts.find((a: { accountId: string }) => a.accountId === ids.bro);
    expect(bro.contributions).toMatchObject({ created: 1, kept: 1 });
    expect((await api.get(`/contributions?accountId=${ids.bro}`)).body).toHaveLength(2);
  });

  it("skips accounts in another currency with a warning", async () => {
    await connectAndLink(api);
    const usd = (await api.post("/accounts", { name: "Dollari", type: "checking" })).body.id;
    await api.put("/firefly/links/5", { accountId: usd });
    const res = await api.post("/firefly/import", RANGE);
    expect(res.body.warnings).toContainEqual({
      code: "currency_not_supported",
      accountId: usd,
      date: null,
      detail: "USD",
    });
    expect((await api.get(`/snapshots?accountId=${usd}`)).body).toEqual([]);
  });

  it("warns about a linked account deleted in Firefly III", async () => {
    const ids = await connectAndLink(api);
    // Deleting an account in Firefly III deletes its transactions too.
    ff.accounts = ff.accounts.filter((a) => a.id !== "2");
    ff.transactions = ff.transactions.filter((tx) => tx.source !== "2" && tx.destination !== "2");
    const res = await api.post("/firefly/import", RANGE);
    expect(res.body.warnings).toContainEqual({
      code: "firefly_account_missing",
      accountId: ids.dep,
      date: null,
      detail: null,
    });
  });

  it("keeps a zero balance when the account already has history in Lifebook", async () => {
    const ids = await connectAndLink(api);
    await api.post("/snapshots", { accountId: ids.bro, date: "2025-12-31", balance: 0 });
    await api.post("/firefly/import", RANGE);
    expect((await api.get(`/snapshots?accountId=${ids.bro}`)).body).toHaveLength(1 + 6);
  });

  it("validates the range and needs a connection and links", async () => {
    expect((await api.post("/firefly/import", RANGE)).status).toBe(400); // no links
    await connectAndLink(api);
    expect(
      (await api.post("/firefly/import", { from: "2026-06-01", to: "2026-01-01" })).status,
    ).toBe(400);
    expect(
      (await api.post("/firefly/import", { from: "2026-06-01", to: "2026-06-29" })).status,
    ).toBe(400);
    expect(
      (await api.post("/firefly/import", { from: "2000-01-01", to: "2026-06-30" })).status,
    ).toBe(400);
    await api.delete("/firefly/connection");
    expect((await api.post("/firefly/import", RANGE)).status).toBe(409);
  });

  it("defaults to the twelve months up to the last complete month", async () => {
    await connectAndLink(api);
    const res = await api.post("/firefly/import", { dryRun: true });
    expect(res.body).toMatchObject({ from: "2025-11-30", to: "2026-11-30" });
    expect(res.body.dates[0]).toBe("2025-11-30");
    expect(res.body.dates.at(-1)).toBe("2026-11-30");
  });
});

describe("Firefly III and multiple users (regression)", () => {
  it("keeps each user's connection, links and imports separate", async () => {
    const ids = await connectAndLink(api);
    const anna = await addUser(t.app, api, "anna");
    expect((await anna.api.get("/firefly/connection")).body.configured).toBe(false);
    expect((await anna.api.post("/firefly/import", RANGE)).status).toBe(400);
    expect((await anna.api.delete("/firefly/links/1")).status).toBe(404);

    await anna.api.put("/firefly/connection", { baseUrl: FAKE_URL, token: FAKE_TOKEN });
    const annaChk = (await anna.api.post("/accounts", { name: "Suo conto", type: "checking" })).body
      .id;
    // The same Firefly III account id can be linked by two users to their own accounts.
    expect((await anna.api.put("/firefly/links/1", { accountId: annaChk })).status).toBe(200);
    await anna.api.post("/firefly/import", RANGE);
    expect((await anna.api.get("/snapshots")).body).toHaveLength(6);
    expect((await api.get("/snapshots")).body).toEqual([]);
    expect((await api.get(`/snapshots?accountId=${ids.chk}`)).body).toEqual([]);
  });

  it("deletes the connection and links with the user", async () => {
    const anna = await addUser(t.app, api, "anna");
    await connectAndLink(anna.api);
    await anna.api.post("/firefly/import", RANGE);
    expect((await api.delete(`/users/${anna.id}`)).status).toBe(200);
    expect(t.db.select().from(schema.fireflyConnections).all()).toEqual([]);
    expect(t.db.select().from(schema.fireflyLinks).all()).toEqual([]);
    expect(t.db.select().from(schema.snapshots).all()).toEqual([]);
  });
});
