import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { Analytics } from "./Analytics";
import { apiFetch } from "../api/client";
import { DEFAULT_ANNOTATION } from "../lib/analytics";
import { addMonths, endOfMonth, todayIso } from "../lib/dates";
import { formatEuro } from "../lib/format";
import type { Account, FireflyMovement, MovementAnnotation } from "../api/types";
const fixture = vi.hoisted(() => ({ accounts: [] as Account[] }));
vi.mock("../api/queries", () => ({ useAccounts: () => ({ data: fixture.accounts, error: null }) }));
beforeEach(() => {
  fixture.accounts = [];
});
vi.mock("../api/client", () => ({ apiFetch: vi.fn() }));
vi.mock("../components/AccruedReturns", () => ({ AccruedReturns: () => null }));
it("edits an expense, refreshes totals and filters the saved tag", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const lastMonth = addMonths(todayIso().slice(0, 7) + "-01", -1).slice(0, 7);
  let movement: FireflyMovement = {
    id: "expense",
    externalId: "firefly:1",
    date: lastMonth + "-10",
    type: "withdrawal",
    amount: 35,
    description: "Cena fuori",
    fromAccountId: null,
    toAccountId: null,
    fromName: "Banca",
    toName: "Ristorante",
    categoryName: "Ristoranti",
    annotation: DEFAULT_ANNOTATION,
  };
  vi.mocked(apiFetch).mockImplementation(
    async <T,>(method: string, _path: string, body?: unknown): Promise<T> => {
      if (method === "PUT") {
        movement = { ...movement, annotation: body as MovementAnnotation };
        return { ok: true } as T;
      }
      return [movement] as T;
    },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Analytics />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Dettagli Cena fuori" }));
  expect(document.querySelector(".metric.spending strong")?.textContent).toBe(formatEuro(35, 2));
  expect((screen.getByLabelText("Dal") as HTMLInputElement).value).toBe(lastMonth + "-01");
  expect((screen.getByLabelText("Al") as HTMLInputElement).value).toBe(endOfMonth(lastMonth));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText(/^Tag/), { target: { value: "svago, famiglia" } });
  fireEvent.change(dialog.getByLabelText("Tipo di spesa"), { target: { value: "discretionary" } });
  fireEvent.click(dialog.getByLabelText("Includi nei conteggi analytics"));
  fireEvent.click(dialog.getByRole("button", { name: "Salva modifiche" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(movement.annotation).toMatchObject({
    included: false,
    spendingClass: "discretionary",
    tags: ["svago", "famiglia"],
  });
  expect(await screen.findByText("Esclusa")).toBeTruthy();
  expect(document.querySelector(".metric.spending strong")?.textContent).toBe(formatEuro(0, 2));
  fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "svago" } });
  expect(screen.getByRole("button", { name: "Dettagli Cena fuori" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Conteggio"), { target: { value: "included" } });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Dettagli Cena fuori" })).toBeNull(),
  );
});

it("combines account and category exclusions across totals and transactions, and resets them", async () => {
  const base: FireflyMovement = {
    id: "revolut",
    externalId: "firefly:1",
    date: todayIso(),
    type: "withdrawal",
    amount: 20,
    description: "Pranzo Revolut",
    fromAccountId: null,
    toAccountId: null,
    fromName: "Revolut",
    toName: "Bar",
    categoryName: "Ristoranti",
  };
  const rows = [
    base,
    { ...base, id: "bank", description: "Cena Banca", amount: 30, fromName: "Banca" },
    {
      ...base,
      id: "bills",
      description: "Elettricità",
      amount: 40,
      fromName: "Banca",
      categoryName: "Bollette",
    },
    {
      ...base,
      id: "transfer",
      description: "Trasferimento",
      amount: 50,
      type: "transfer",
      fromName: "Banca",
      toName: "Revolut",
    },
  ];
  vi.mocked(apiFetch).mockImplementation(async <T,>(): Promise<T> => rows as T);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Analytics />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Dettagli Pranzo Revolut" });
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "withdrawal" } });
  fireEvent.change(screen.getByLabelText("Escludi conti / controparti"), {
    target: { value: "Revolut" },
  });
  expect(screen.queryByRole("button", { name: "Dettagli Pranzo Revolut" })).toBeNull();
  expect(document.querySelector(".metric.spending strong")?.textContent).toBe(formatEuro(70, 2));
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "transfer" } });
  expect(screen.queryByRole("button", { name: "Dettagli Trasferimento" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "withdrawal" } });
  fireEvent.change(screen.getByLabelText("Escludi categorie"), { target: { value: "Bollette" } });
  expect(screen.queryByRole("button", { name: "Dettagli Elettricità" })).toBeNull();
  expect(screen.getByRole("button", { name: "Dettagli Cena Banca" })).toBeTruthy();
  expect(document.querySelector(".metric.spending strong")?.textContent).toBe(formatEuro(30, 2));
  fireEvent.change(screen.getByLabelText("Escludi categorie"), { target: { value: "Ristoranti" } });
  expect(document.querySelector(".metric.spending strong")?.textContent).toBe(formatEuro(0, 2));
  fireEvent.click(screen.getByRole("button", { name: "Escludi categorie: rimuovi Bollette" }));
  expect(screen.getByRole("button", { name: "Dettagli Elettricità" })).toBeTruthy();
  expect(document.querySelector(".metric.spending strong")?.textContent).toBe(formatEuro(40, 2));
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "transfer" } });
  expect(screen.queryByRole("button", { name: "Dettagli Trasferimento" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Azzera filtri" }));
  expect(screen.getByRole("button", { name: "Dettagli Trasferimento" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Dettagli Pranzo Revolut" })).toBeTruthy();
  expect(document.querySelector(".metric.spending strong")?.textContent).toBe(formatEuro(90, 2));
  expect(screen.queryByRole("button", { name: /rimuovi/ })).toBeNull();
});

it("replaces the transfer KPI with salary and yield and persists an income reclassification", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const base: FireflyMovement = {
    id: "salary",
    externalId: "firefly:salary",
    date: todayIso(),
    type: "deposit",
    amount: 2000,
    description: "Paga mensile",
    categoryName: "Stipendio",
    fromAccountId: null,
    toAccountId: null,
    fromName: "Datore",
    toName: "Banca",
    annotation: DEFAULT_ANNOTATION,
  };
  let rows = [
    base,
    {
      ...base,
      id: "yield",
      description: "Dividendo",
      amount: 100,
      categoryName: "Dividendi",
      annotation: { ...DEFAULT_ANNOTATION, isYield: true },
    },
    { ...base, id: "refund", description: "Rimborso", amount: 20, categoryName: "Rimborsi" },
  ];
  vi.mocked(apiFetch).mockImplementation(
    async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      if (method === "PUT") {
        rows = rows.map((m) =>
          path.includes(`/${m.id}/`) ? { ...m, annotation: body as MovementAnnotation } : m,
        );
        return { ok: true } as T;
      }
      return rows as T;
    },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Analytics />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Dettagli Paga mensile" });
  expect(document.querySelector(".metric.salary strong")?.textContent).toBe(formatEuro(2000, 2));
  expect(document.querySelector(".metric.yield strong")?.textContent).toBe(formatEuro(120, 2));
  expect(document.querySelector(".metric.transfer")).toBeNull();
  expect(document.querySelector(".metric.income strong")?.textContent).toBe(formatEuro(2120, 2));
  fireEvent.click(screen.getByRole("button", { name: "Dettagli Rimborso" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Tipo di entrata"), { target: { value: "salary" } });
  fireEvent.click(dialog.getByRole("button", { name: "Salva modifiche" }));
  await waitFor(() =>
    expect(document.querySelector(".metric.salary strong")?.textContent).toBe(formatEuro(2020, 2)),
  );
  expect(document.querySelector(".metric.yield strong")?.textContent).toBe(formatEuro(100, 2));
  expect(rows.find((m) => m.id === "refund")?.annotation).toMatchObject({
    incomeKind: "salary",
    isYield: false,
  });
  expect(document.querySelector(".metric.income strong")?.textContent).toBe(formatEuro(2120, 2));
});

it("shows unavailable, partial and complete gross yield after editing the imported net receipts", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const base: FireflyMovement = {
    id: "interest",
    externalId: "firefly:interest",
    date: todayIso(),
    type: "deposit",
    amount: 74,
    description: "Interessi",
    categoryName: "Interessi",
    fromAccountId: null,
    toAccountId: null,
    fromName: "Banca",
    toName: "Conto",
    annotation: DEFAULT_ANNOTATION,
  };
  let rows = [base, { ...base, id: "dividend", amount: 20, description: "Dividendi" }];
  vi.mocked(apiFetch).mockImplementation(
    async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      if (method === "PUT") {
        rows = rows.map((m) =>
          path.includes(`/${m.id}/`) ? { ...m, annotation: body as MovementAnnotation } : m,
        );
        return { ok: true } as T;
      }
      return rows as T;
    },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Analytics />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Dettagli Interessi" });
  expect(document.querySelector(".metric.yield strong")?.textContent).toBe(formatEuro(94, 2));
  expect(document.querySelector(".metric-gross")?.textContent).toContain("Lordo: Non disponibile");
  fireEvent.click(screen.getByRole("button", { name: "Dettagli Interessi" }));
  let dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText(/^Importo lordo/), { target: { value: "100" } });
  fireEvent.click(dialog.getByRole("button", { name: "Salva modifiche" }));
  await waitFor(() =>
    expect(document.querySelector(".metric-gross")?.textContent).toContain(
      `Lordo noto (parziale): ${formatEuro(100, 2)}`,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Dettagli Dividendi" }));
  dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText(/^Importo lordo/), { target: { value: "25" } });
  fireEvent.click(dialog.getByRole("button", { name: "Salva modifiche" }));
  await waitFor(() =>
    expect(document.querySelector(".metric-gross")?.textContent).toBe(
      `Lordo: ${formatEuro(125, 2)}`,
    ),
  );
  expect(document.querySelector(".metric.yield strong")?.textContent).toBe(formatEuro(94, 2));
});

it("treats a linked securities receipt as gross and applies the account tax to KPIs and detail", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  fixture.accounts = [
    {
      id: "directa",
      ownerId: "u",
      name: "Directa",
      type: "brokerage",
      realEstateUse: null,
      institution: null,
      contributionsMode: "declared",
      countsAsLivingCost: false,
      archivedAt: null,
      params: [{ id: "p", validFrom: "2000-01-01", taxRate: 0.26 }],
    },
  ];
  const movement: FireflyMovement = {
    id: "dividend",
    externalId: "firefly:1",
    date: todayIso(),
    type: "deposit",
    amount: 100,
    fromAccountId: null,
    toAccountId: "directa",
    fromName: "Dividendi",
    toName: "Directa",
    categoryName: "Dividendi",
    description: "Cedola lorda",
  };
  vi.mocked(apiFetch).mockImplementation(async <T,>(): Promise<T> => [movement] as T);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Analytics />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Dettagli Cedola lorda" }));
  expect(document.querySelector(".metric.yield strong")?.textContent).toBe(formatEuro(74, 2));
  expect(document.querySelector(".metric.income strong")?.textContent).toBe(formatEuro(74, 2));
  expect(document.querySelector(".metric-gross")?.textContent).toBe(`Lordo: ${formatEuro(100, 2)}`);
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("status").textContent).toContain(`Netto stimato: ${formatEuro(74, 2)}`);
  expect(dialog.queryByLabelText(/^Importo lordo/)).toBeNull();
});
