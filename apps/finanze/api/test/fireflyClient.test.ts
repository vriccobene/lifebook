import { describe, expect, it } from "vitest";
import { FireflyClient } from "../src/firefly/client";

const reply = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

describe("Firefly III response integrity", () => {
  it.each([null, undefined, "", " ", "123 euro", "NaN", "Infinity"])(
    "rejects an invalid balance (%s) instead of replacing it with zero",
    async (current_balance) => {
      const client = new FireflyClient(
        "https://firefly.example.com",
        "token",
        reply({
          data: [{ id: "1", attributes: { name: "Conto", type: "asset", current_balance } }],
        }),
      );
      await expect(client.ownAccounts()).rejects.toMatchObject({ code: "firefly_bad_response" });
    },
  );

  it("preserves a legitimate zero balance", async () => {
    const client = new FireflyClient(
      "https://firefly.example.com",
      "token",
      reply({
        data: [
          {
            id: "1",
            attributes: { name: "Conto", type: "asset", current_balance: "0.000000000000" },
          },
        ],
      }),
    );
    expect((await client.ownAccounts())[0]!.currentBalance).toBe(0);
  });

  it.each([501, 0, 1.5, "2"])(
    "rejects unsupported pagination (%s) before accepting partial data",
    async (total_pages) => {
      const client = new FireflyClient(
        "https://firefly.example.com",
        "token",
        reply({ data: [], meta: { pagination: { total_pages } } }),
      );
      await expect(client.ownAccounts()).rejects.toMatchObject({ code: "firefly_bad_response" });
    },
  );

  it("rejects invalid transaction amounts as well as invalid balances", async () => {
    const client = new FireflyClient(
      "https://firefly.example.com",
      "token",
      reply({
        data: [{ attributes: { transactions: [{ date: "2026-01-01", amount: "broken" }] } }],
      }),
    );
    await expect(client.transactions("1", "2026-01-01", "2026-01-31")).rejects.toMatchObject({
      code: "firefly_bad_response",
    });
  });
});
