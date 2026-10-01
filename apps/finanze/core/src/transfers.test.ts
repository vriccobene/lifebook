import { describe, expect, it } from "vitest";
import { prepareDataset, type LifebookData } from "./dataset";
import { computeLivingCost } from "./livingCost";
import { computeReturns } from "./returns";
import {
  account,
  contribution,
  emptyData,
  fireflySnap,
  salary,
  snap,
  spendingAccount,
  transfer,
} from "./testkit";

/*
 * A real transfer must never become spending on one account and an unrecorded contribution (or a gain) on
 * another. These cases use balances and transfers imported from Firefly III.
 */

const asOf = "2026-12-31";
const livingCost = (data: LifebookData) => computeLivingCost(prepareDataset(data, asOf));
const returns = (data: LifebookData) => computeReturns(prepareDataset(data, asOf));

/** A month on the checking account: +2000 salary, −1500 spent, `moved` sent elsewhere. */
function month(moved: number): LifebookData {
  const data = emptyData();
  data.accounts.push(spendingAccount());
  data.incomeItems.push(salary(2000, "2026-02-28"));
  data.snapshots.push(
    fireflySnap("chk", "2026-01-31", 1000),
    fireflySnap("chk", "2026-02-28", 1000 + 2000 - 1500 - moved),
  );
  return data;
}

describe("transfers known from Firefly III (regression)", () => {
  it("to a deposit earning more than its declared rate: the transfer is not spending, the rest is a gain", () => {
    const data = month(3000);
    data.accounts.push(account("dep", "deposit", { params: { interestRate: 0, taxRate: 0.26 } }));
    // The deposit really earned 40 on top of the 3000 received.
    data.snapshots.push(
      fireflySnap("dep", "2026-01-31", 10_000),
      fireflySnap("dep", "2026-02-28", 13_040),
    );
    data.transfers = [transfer("chk", "dep", "2026-02-10", 3000)];
    expect(livingCost(data).periods[0]!.spending).toBe(1500);
    const record = returns(data).records.find((r) => r.accountId === "dep")!;
    expect(record.contributions).toBe(3000);
    expect(record.grossGain).toBe(40);
  });

  it("without Firefly III balances the deposit is still estimated from its declared rate", () => {
    const data = month(3000);
    data.accounts.push(account("dep", "deposit", { params: { interestRate: 0 } }));
    data.snapshots.push(snap("dep", "2026-01-31", 10_000), snap("dep", "2026-02-28", 13_040));
    data.transfers = [transfer("chk", "dep", "2026-02-10", 3000)];
    // The 40 the declared rate does not explain lands in the transfer: the old behaviour, unchanged.
    expect(livingCost(data).periods[0]!.spending).toBe(1460);
  });

  it("to real estate (renovation): neither spending nor a revaluation", () => {
    const data = month(20_000);
    data.accounts.push(
      account("home", "real_estate", { realEstateUse: "primary_residence" }),
      account("dep", "deposit"),
    );
    // Paid from the deposit through the checking account.
    data.snapshots.push(
      fireflySnap("dep", "2026-01-31", 50_000),
      fireflySnap("dep", "2026-02-28", 30_000),
      fireflySnap("home", "2026-01-31", 200_000),
      fireflySnap("home", "2026-02-28", 220_000),
    );
    data.transfers = [
      transfer("dep", "chk", "2026-02-05", 20_000),
      transfer("chk", "home", "2026-02-06", 20_000),
    ];
    data.snapshots[1] = fireflySnap("chk", "2026-02-28", 1500);
    expect(livingCost(data).periods[0]!.spending).toBe(1500);
    const home = returns(data).records.find((r) => r.accountId === "home")!;
    expect(home.grossGain).toBe(0);
    expect(home.contributions).toBe(20_000);
  });

  it("to or from an account Lifebook does not track: not spent, not earned", () => {
    const out = month(700);
    out.transfers = [transfer("chk", null, "2026-02-10", 700)];
    const period = livingCost(out).periods[0]!;
    expect(period.spending).toBe(1500);
    expect(period.outsideTransfers).toBe(700);

    // Into a broker from an untracked account: the import records the contribution on the broker.
    const into = month(0);
    into.accounts.push(account("bro", "brokerage"));
    into.snapshots.push(
      fireflySnap("bro", "2026-01-31", 5000),
      fireflySnap("bro", "2026-02-28", 6000),
    );
    into.contributions.push(contribution("bro", "2026-02-10", 1000));
    into.transfers = [transfer(null, "bro", "2026-02-10", 1000)];
    expect(livingCost(into).periods[0]!.spending).toBe(1500);
    expect(returns(into).records.find((r) => r.accountId === "bro")!.grossGain).toBe(0);
  });

  it("between deposit and broker: counted once on each side, net zero on spending", () => {
    const data = month(0);
    data.accounts.push(account("dep", "deposit"), account("bro", "brokerage"));
    data.snapshots.push(
      fireflySnap("dep", "2026-01-31", 10_000),
      fireflySnap("dep", "2026-02-28", 5_000),
      fireflySnap("bro", "2026-01-31", 0),
      fireflySnap("bro", "2026-02-28", 5_000),
    );
    data.contributions.push(contribution("bro", "2026-02-10", 5000));
    data.transfers = [transfer("dep", "bro", "2026-02-10", 5000)];
    expect(livingCost(data).periods[0]!.spending).toBe(1500);
    const gains = returns(data).records.map((r) => r.grossGain);
    expect(gains).toEqual([0, 0]);
  });

  it("ignores the untracked side when the tracked account is not counted", () => {
    const data = month(0);
    // A transfer into an account that is not part of the period (archived before it).
    data.accounts.push(account("old", "brokerage", { archivedAt: "2026-01-01" }));
    data.transfers = [transfer(null, "old", "2026-02-10", 999)];
    expect(livingCost(data).periods[0]!.spending).toBe(1500);
  });
});

describe("the income account (regression)", () => {
  /** The salary lands on a current account that is not a spending account and feeds the spending one. */
  function salaryAccount(isIncomeAccount: boolean, readings = fireflySnap): LifebookData {
    const data = emptyData();
    data.accounts.push(
      spendingAccount(),
      account("sal", "checking", { contributionsMode: "inferred", params: { isIncomeAccount } }),
    );
    data.incomeItems.push(salary(3000, "2026-02-27"));
    // sal: +3000 salary −1600 sent to chk; chk: +1600 −1500 spent
    data.snapshots.push(
      fireflySnap("chk", "2026-01-31", 1000),
      fireflySnap("chk", "2026-02-28", 1100),
      readings("sal", "2026-01-31", 10_000),
      readings("sal", "2026-02-28", 11_400),
    );
    data.transfers = [transfer("sal", "chk", "2026-02-27", 1600)];
    return data;
  }

  it("is not a gain on the account that receives it", () => {
    const record = returns(salaryAccount(true)).records.find((r) => r.accountId === "sal")!;
    expect(record.grossGain).toBe(0);
    expect(record.contributions).toBe(3000 - 1600);
    // Without the flag the salary looks like a 3000 gain: the bug this setting fixes.
    const unflagged = returns(salaryAccount(false)).records.find((r) => r.accountId === "sal")!;
    expect(unflagged.grossGain).toBe(3000);
  });

  it("stays out of the spending", () => {
    expect(livingCost(salaryAccount(true)).periods[0]!.spending).toBe(1500);
  });

  it("counts once when the balances are not from Firefly III", () => {
    const period = livingCost(salaryAccount(true, snap)).periods[0]!;
    expect(period.spending).toBe(1500);
  });

  it("works on a declared account and splits the income between two income accounts", () => {
    const data = emptyData();
    data.accounts.push(
      spendingAccount(),
      account("a", "brokerage", { params: { isIncomeAccount: true } }),
      account("b", "brokerage", { params: { isIncomeAccount: true } }),
    );
    data.incomeItems.push(salary(2000, "2026-02-27"));
    data.snapshots.push(
      snap("chk", "2026-01-31", 1000),
      snap("chk", "2026-02-28", 1000),
      snap("a", "2026-01-31", 0),
      snap("a", "2026-02-28", 1000),
      snap("b", "2026-01-31", 0),
      snap("b", "2026-02-28", 1000),
    );
    expect(returns(data).records.map((r) => r.grossGain)).toEqual([0, 0]);
    expect(livingCost(data).periods[0]!.spending).toBe(0);
  });
});

describe("real estate with its value (regression)", () => {
  /** A rental worth 370k whose cash account (from Firefly III) collects ~1450 of rent a month. */
  function rental(values: { validFrom: string; propertyValue: number }[]): LifebookData {
    const data = emptyData();
    const home = account("home", "real_estate", { realEstateUse: "income" });
    home.params = values;
    data.accounts.push(spendingAccount(), home);
    data.snapshots.push(
      fireflySnap("home", "2026-01-31", 1_455.82),
      fireflySnap("home", "2026-02-28", 2_911.64),
      fireflySnap("home", "2026-03-31", 3_365.56),
    );
    // In March 1000 of rent goes to the checking account.
    data.transfers = [transfer("home", "chk", "2026-03-20", 1000)];
    return data;
  }

  it("measures the rent on the value of the property, not on the rent collected", () => {
    const [feb, mar] = returns(
      rental([{ validFrom: "2000-01-01", propertyValue: 370_000 }]),
    ).records;
    expect(feb!.method).toBe("property_value");
    expect(feb!.grossGain).toBeCloseTo(1_455.82, 9);
    expect(feb!.grossPct).toBeCloseTo(1_455.82 / (370_000 + 1_455.82), 9);
    // The rent moved to the checking account is not a loss of the property.
    expect(mar!.contributions).toBe(-1000);
    expect(mar!.grossGain).toBeCloseTo(1_453.92, 9);
  });

  it("adds the change of value tracked over time to the gain", () => {
    const [, mar] = returns(
      rental([
        { validFrom: "2000-01-01", propertyValue: 370_000 },
        { validFrom: "2026-03-15", propertyValue: 380_000 },
      ]),
    ).records;
    expect(mar!.grossGain).toBeCloseTo(1_453.92 + 10_000, 9);
  });

  it("counts the value in the net worth, with the cash", async () => {
    const { computeCapital } = await import("./capital");
    const data = rental([{ validFrom: "2000-01-01", propertyValue: 370_000 }]);
    const ds = prepareDataset(data, "2026-03-31");
    const capital = computeCapital(ds, computeLivingCost(ds));
    expect(capital.netWorthByType.real_estate).toBeCloseTo(373_365.56, 9);
  });
});
