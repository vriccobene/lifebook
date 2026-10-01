import { HttpError } from "../errors";

/*
 * Minimal client of the Firefly III REST API (https://api-docs.firefly-iii.org), read only.
 * Only the fields Lifebook uses are typed. Errors never echo the remote body: the URL is chosen by the user
 * and the server should not become a way to read arbitrary pages.
 */

export type FetchFn = typeof fetch;

/** Account types of the user's own money in Firefly III; the others are expense and revenue accounts. */
export const OWN_ACCOUNT_TYPES = new Set(["Asset account", "Loan", "Debt", "Mortgage"]);

export interface FireflyAccount {
  id: string;
  name: string;
  /** `asset` or `liabilities` (Firefly III's own spelling). */
  type: string;
  /** Assets only: defaultAsset, sharedAsset, savingAsset, ccAsset, cashWalletAsset. */
  accountRole: string | null;
  /** Liabilities only: loan, debt, mortgage. */
  liabilityType: string | null;
  currencyCode: string | null;
  /** Balance on the date requested (or today). */
  currentBalance: number;
  active: boolean;
  openingBalanceDate: string | null;
  iban: string | null;
}

export interface FireflySplit {
  journalId: string;
  type: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  amount: number;
  currencyCode: string | null;
  sourceId: string;
  sourceType: string;
  sourceName: string;
  destinationId: string;
  destinationType: string;
  destinationName: string;
  description: string;
}

interface Page<T> {
  data: T[];
  meta?: { pagination?: { total_pages?: number } };
}

interface AccountResource {
  id: string;
  attributes: {
    name: string;
    type: string;
    account_role?: string | null;
    liability_type?: string | null;
    currency_code?: string | null;
    current_balance?: string | number | null;
    active?: boolean;
    opening_balance_date?: string | null;
    iban?: string | null;
  };
}

interface TransactionResource {
  id: string;
  attributes: {
    transactions: {
      transaction_journal_id: string | number;
      type: string;
      date: string;
      amount: string | number;
      currency_code?: string | null;
      source_id: string | number;
      source_type: string;
      source_name?: string | null;
      destination_id: string | number;
      destination_type: string;
      destination_name?: string | null;
      description?: string;
    }[];
  };
}

const PAGE_SIZE = 100;
const MAX_PAGES = 500;
const TIMEOUT_MS = 20_000;

const num = (value: string | number | null | undefined): number => {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** `https://ff.example.com/` or `.../api/v1` → `https://ff.example.com`. Throws 400 on anything but http(s). */
export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new HttpError(400, "invalid_url", "Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new HttpError(400, "invalid_url", "The URL must start with http:// or https://");
  if (url.username || url.password)
    throw new HttpError(400, "invalid_url", "Put the token in the token field, not in the URL");
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api(\/v1)?$/, "");
  return `${url.origin}${path}`;
}

export class FireflyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/vnd.api+json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, "firefly_unreachable", "Firefly III did not answer");
    }
    if (response.status === 401 || response.status === 403)
      throw new HttpError(502, "firefly_unauthorized", "Firefly III refused the token");
    if (response.status === 404)
      throw new HttpError(502, "firefly_not_found", `Firefly III has nothing at ${path}`);
    if (!response.ok)
      throw new HttpError(
        502,
        "firefly_error",
        `Firefly III answered with HTTP ${response.status} on ${path}`,
      );
    try {
      return (await response.json()) as T;
    } catch {
      throw new HttpError(
        502,
        "firefly_bad_response",
        "The answer is not Firefly III JSON: check the URL",
      );
    }
  }

  private async all<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.get<Page<T>>(path, {
        ...query,
        limit: String(PAGE_SIZE),
        page: String(page),
      });
      if (!Array.isArray(body.data))
        throw new HttpError(502, "firefly_bad_response", "Unexpected answer from Firefly III");
      items.push(...body.data);
      if (page >= (body.meta?.pagination?.total_pages ?? 1)) break;
    }
    return items;
  }

  /** Checks URL and token. */
  async about(): Promise<{ version: string }> {
    const body = await this.get<{ data?: { version?: string } }>("/about");
    if (!body.data?.version)
      throw new HttpError(
        502,
        "firefly_bad_response",
        "The answer is not Firefly III JSON: check the URL",
      );
    return { version: body.data.version };
  }

  /** Asset and liability accounts, with their balance at the end of `date` (today when omitted). */
  async ownAccounts(date?: string): Promise<FireflyAccount[]> {
    const query = date ? { date } : {};
    const resources = [
      ...(await this.all<AccountResource>("/accounts", { ...query, type: "asset" })),
      ...(await this.all<AccountResource>("/accounts", { ...query, type: "liabilities" })),
    ];
    return resources.map(({ id, attributes: a }) => ({
      id: String(id),
      name: a.name,
      type: a.type,
      accountRole: a.account_role ?? null,
      liabilityType: a.liability_type ?? null,
      currencyCode: a.currency_code ?? null,
      currentBalance: num(a.current_balance),
      active: a.active ?? true,
      openingBalanceDate: a.opening_balance_date ? a.opening_balance_date.slice(0, 10) : null,
      iban: a.iban ?? null,
    }));
  }

  /** Every split of the transactions of an account between two dates (inclusive). */
  async transactions(accountId: string, start: string, end: string): Promise<FireflySplit[]> {
    let groups: TransactionResource[];
    try {
      groups = await this.all<TransactionResource>(
        `/accounts/${encodeURIComponent(accountId)}/transactions`,
        { start, end },
      );
    } catch (error) {
      // An account deleted in Firefly III: the import warns about it instead of failing.
      if (error instanceof HttpError && error.code === "firefly_not_found") return [];
      throw error;
    }
    return groups.flatMap((group) =>
      group.attributes.transactions.map((s) => ({
        journalId: String(s.transaction_journal_id),
        type: s.type,
        // Firefly III dates carry the user's time zone offset: the first ten characters are the local date.
        date: s.date.slice(0, 10),
        amount: Math.abs(num(s.amount)),
        currencyCode: s.currency_code ?? null,
        sourceId: String(s.source_id),
        sourceType: s.source_type,
        sourceName: s.source_name ?? "",
        destinationId: String(s.destination_id),
        destinationType: s.destination_type,
        destinationName: s.destination_name ?? "",
        description: s.description ?? "",
      })),
    );
  }
}
