/**
 * An in-memory Firefly III answering the few API calls Lifebook makes, as a `fetch` replacement.
 * Balances are computed from the opening balance and the transactions, as Firefly III does; pages hold two
 * items so pagination is always exercised.
 */

export interface FakeAccount {
  id: string;
  name: string;
  type: "asset" | "liabilities" | "expense" | "revenue";
  role?: string;
  liabilityType?: string;
  currency?: string;
  openingBalance?: number;
  openingDate?: string;
}

export interface FakeTransaction {
  id: string;
  date: string;
  amount: number;
  source: string;
  destination: string;
  description?: string;
  currency?: string;
}

const TYPE_NAMES: Record<FakeAccount["type"], (a: FakeAccount) => string> = {
  asset: () => "Asset account",
  liabilities: (a) =>
    a.liabilityType === "mortgage" ? "Mortgage" : a.liabilityType === "debt" ? "Debt" : "Loan",
  expense: () => "Expense account",
  revenue: () => "Revenue account",
};

export const FAKE_URL = "https://firefly.example.com";
export const FAKE_TOKEN = "ff-personal-access-token";

export class FakeFirefly {
  accounts: FakeAccount[] = [];
  transactions: FakeTransaction[] = [];
  requests: { url: URL; authorization: string | null }[] = [];
  pageSize = 2;
  /** Replace the answer to every request (e.g. an HTML login page). */
  override: (() => Response) | null = null;

  balance(account: FakeAccount, date: string): number {
    let total =
      account.openingDate && account.openingDate <= date ? (account.openingBalance ?? 0) : 0;
    for (const t of this.transactions) {
      if (t.date > date) continue;
      if (t.destination === account.id) total += t.amount;
      if (t.source === account.id) total -= t.amount;
    }
    return Math.round(total * 100) / 100;
  }

  private page<T>(items: T[], url: URL) {
    const page = Number(url.searchParams.get("page") ?? 1);
    const size = Math.min(this.pageSize, Number(url.searchParams.get("limit") ?? 50));
    const totalPages = Math.max(1, Math.ceil(items.length / size));
    return {
      data: items.slice((page - 1) * size, page * size),
      meta: { pagination: { total: items.length, current_page: page, total_pages: totalPages } },
    };
  }

  private accountResource(a: FakeAccount, date: string) {
    return {
      type: "accounts",
      id: a.id,
      attributes: {
        name: a.name,
        type: a.type === "liabilities" ? "liabilities" : a.type,
        account_role: a.role ?? null,
        liability_type: a.liabilityType ?? null,
        currency_code: a.currency ?? "EUR",
        current_balance: this.balance(a, date).toFixed(12),
        active: true,
        opening_balance_date: a.openingDate ? `${a.openingDate}T00:00:00+02:00` : null,
        iban: null,
      },
    };
  }

  private typeName(id: string): string {
    const account = this.accounts.find((a) => a.id === id)!;
    return TYPE_NAMES[account.type](account);
  }

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const authorization = headers.authorization ?? null;
    this.requests.push({ url, authorization });
    if (this.override) return this.override();
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/vnd.api+json" },
      });
    if (url.origin !== FAKE_URL) throw new TypeError("fetch failed");
    if (authorization !== `Bearer ${FAKE_TOKEN}`) return json({ message: "Unauthenticated." }, 401);

    const path = url.pathname;
    if (path === "/api/v1/about") return json({ data: { version: "6.4.4", api_version: "6.4.4" } });
    if (path === "/api/v1/accounts") {
      const type = url.searchParams.get("type");
      const date = url.searchParams.get("date") ?? "2099-12-31";
      const matching = this.accounts.filter((a) => a.type === type);
      return json(
        this.page(
          matching.map((a) => this.accountResource(a, date)),
          url,
        ),
      );
    }
    const match = /^\/api\/v1\/accounts\/([^/]+)\/transactions$/.exec(path);
    if (match) {
      const id = match[1]!;
      if (!this.accounts.some((a) => a.id === id)) return json({ message: "Not found" }, 404);
      const start = url.searchParams.get("start")!;
      const end = url.searchParams.get("end")!;
      const groups = this.transactions
        .filter(
          (t) => (t.source === id || t.destination === id) && t.date >= start && t.date <= end,
        )
        .map((t) => ({
          type: "transactions",
          id: `g${t.id}`,
          attributes: {
            transactions: [
              {
                transaction_journal_id: t.id,
                type:
                  this.typeName(t.source) === "Asset account" &&
                  this.typeName(t.destination) === "Asset account"
                    ? "transfer"
                    : this.typeName(t.destination) === "Expense account"
                      ? "withdrawal"
                      : "deposit",
                date: `${t.date}T00:00:00+02:00`,
                amount: t.amount.toFixed(12),
                currency_code: t.currency ?? "EUR",
                source_id: t.source,
                source_type: this.typeName(t.source),
                destination_id: t.destination,
                destination_type: this.typeName(t.destination),
                description: t.description ?? "",
              },
            ],
          },
        }));
      return json(this.page(groups, url));
    }
    return json({ message: "Not found" }, 404);
  }) as typeof fetch;
}
