import { accruedInterest, addMonths, daysBetween, endOfMonth, monthOf } from "@lifebook/core";
import type { FastifyInstance } from "fastify";

export const DEMO_CREDENTIALS = { username: "demo", password: "demo-password-1234" };

/** Small deterministic generator, so the demo data is always the same. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Loads a fictional household into an empty database through the public API (so it goes through the
 * same validation as real data): 24 months of readings ending with the last complete month.
 * Nothing here is real financial data.
 */
export async function seedDemoData(
  app: FastifyInstance,
  today: string,
  months = 24,
): Promise<{ token: string; lastReading: string }> {
  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: DEMO_CREDENTIALS,
  });
  if (setup.statusCode !== 201) {
    throw new Error(
      "Il database contiene già un utente: i dati di esempio si caricano solo in un database vuoto.",
    );
  }
  const token = setup.json().token as string;
  const send = async (method: "POST" | "PATCH", url: string, payload: object) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.body}`);
    return res.json();
  };

  const validFrom = "2000-01-01";
  const chk = (
    await send("POST", "/accounts", {
      name: "Conto corrente",
      type: "checking",
      institution: "Banca Esempio",
      params: [{ validFrom, isSpendingAccount: true }],
    })
  ).id;
  const sav = (
    await send("POST", "/accounts", {
      name: "Conto deposito",
      type: "deposit",
      institution: "Banca Esempio",
      params: [{ validFrom, interestRate: 0.025, taxRate: 0.26, expectedReturn: 0.01 }],
    })
  ).id;
  const etf = (
    await send("POST", "/accounts", {
      name: "Portafoglio ETF",
      type: "brokerage",
      institution: "Broker Esempio",
      params: [{ validFrom, expectedReturn: 0.04, passiveYield: 0.015, taxRate: 0.26 }],
    })
  ).id;
  const fund = (
    await send("POST", "/accounts", {
      name: "Fondo pensione",
      type: "external_investment",
      params: [{ validFrom, expectedReturn: 0.03, taxRate: 0.15, inInvestableCapital: false }],
    })
  ).id;
  const home = (
    await send("POST", "/accounts", {
      name: "Abitazione principale",
      type: "real_estate",
      realEstateUse: "primary_residence",
    })
  ).id;
  const flat = (
    await send("POST", "/accounts", {
      name: "Appartamento in affitto",
      type: "real_estate",
      realEstateUse: "income",
      params: [{ validFrom, passiveYield: 0.04, taxRate: 0.21, expectedReturn: 0.01 }],
    })
  ).id;
  const mortgage = (
    await send("POST", "/accounts", {
      name: "Mutuo",
      type: "liability",
      countsAsLivingCost: true,
      params: [
        {
          validFrom,
          monthlyPayment: 650,
          interestRate: 0.03,
          paymentEndDate: addMonths(today, 12 * 15),
        },
      ],
    })
  ).id;

  await send("POST", "/income-items", {
    name: "Stipendio",
    kind: "recurring",
    amount: 2800,
    periodicity: "monthly",
    startDate: "2000-01-31",
  });
  await send("POST", "/income-items", {
    name: "Tredicesima",
    kind: "recurring",
    amount: 2800,
    periodicity: "yearly",
    startDate: "2000-12-15",
  });
  await send("POST", "/income-items", {
    name: "Affitto netto",
    kind: "recurring",
    amount: 400,
    periodicity: "monthly",
    startDate: "2000-01-31",
  });
  await send("POST", "/essential-spending", {
    mode: "amount",
    value: 1500,
    validFrom: "2000-01-01",
  });
  await send("POST", "/settings", {
    validFrom: "2000-01-01",
    currentAge: 42,
    targetRetirementAge: 60,
    publicPension: { startAge: 67, netMonthlyAmount: 1100 },
  });

  const random = mulberry32(20260924);
  // months + 1 readings (the first is only an opening balance), ending with the last complete month
  const first = monthOf(addMonths(`${monthOf(today)}-01`, -(months + 1)));
  let month = first;
  let previous = "";
  let checking = 4_000;
  let deposit = 15_000;
  let etfBalance = 40_000;
  let fundBalance = 25_000;
  let homeValue = 235_000;
  let flatValue = 110_000;
  let debt = 130_000;
  let lastReading = "";

  for (let i = 0; i <= months; i++) {
    const date = endOfMonth(month);
    if (previous) {
      const days = daysBetween(previous, date);
      const isDecember = month.endsWith("-12");
      const salary = 2800 + (isDecember ? 2800 : 0);
      const spending = 2100 + Math.round((random() - 0.5) * 300) + (isDecember ? 350 : 0);
      const toDeposit = 150;
      const toEtf = 350;
      const repaid = 450;

      deposit = cents(deposit + toDeposit + accruedInterest(deposit, 0.025, days) * (1 - 0.26));
      etfBalance = cents((etfBalance + toEtf) * (1 + (random() - 0.42) * 0.04));
      fundBalance = cents(fundBalance * (1 + (random() - 0.4) * 0.015));
      homeValue = cents(homeValue * (1 + (random() - 0.45) * 0.006));
      flatValue = cents(flatValue * (1 + (random() - 0.45) * 0.006));
      debt = cents(debt - repaid);
      checking = cents(checking + salary + 400 - spending - toDeposit - toEtf);

      await send("POST", "/contributions", { accountId: etf, date, amount: toEtf });
      await send("POST", "/contributions", { accountId: mortgage, date, amount: repaid });
    }
    for (const [accountId, balance] of [
      [chk, checking],
      [sav, deposit],
      [etf, etfBalance],
      [fund, fundBalance],
      [home, homeValue],
      [flat, flatValue],
      [mortgage, -debt],
    ] as const) {
      await send("POST", "/snapshots", { accountId, date, balance });
    }
    previous = date;
    lastReading = date;
    month = monthOf(addMonths(`${month}-01`, 1));
  }
  return { token, lastReading };
}
