import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { apiFetch } from "../api/client";
import type { Account, ReturnsPayload } from "../api/types";
import { AccruedReturns } from "./AccruedReturns";
import { formatEuro } from "../lib/format";
vi.mock("../api/client", () => ({ apiFetch: vi.fn() }));
it("collapses the panel, opens a visible tax dialog and saves the updated rate", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  let account: Account = {
    id: "directa",
    name: "Directa",
    ownerId: "u",
    institution: null,
    type: "brokerage",
    realEstateUse: null,
    contributionsMode: "declared",
    countsAsLivingCost: false,
    archivedAt: null,
    params: [{ id: "p", validFrom: "2026-01-01", taxRate: 0.26 }],
  };
  let rate = 0.26;
  vi.mocked(apiFetch).mockImplementation(
    async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      if (method === "POST") {
        const patch = body as { validFrom: string; taxRate: number };
        expect(path).toBe("/accounts/directa/params");
        expect(patch).toEqual({ validFrom: "2026-09-01", taxRate: 0 });
        rate = patch.taxRate;
        account = { ...account, params: [...account.params, { id: "new", ...patch }] };
        return { id: "new", ...patch } as T;
      }
      if (path === "/accounts") return [account] as T;
      return {
        asOf: "2026-09-30",
        records: [
          {
            accountId: "directa",
            from: "2026-08-31",
            to: "2026-09-30",
            days: 30,
            method: "declared",
            opening: 10000,
            closing: 11000,
            contributions: 0,
            grossGain: 1000,
            netGain: 1000 * (1 - rate),
            tax: 1000 * rate,
            base: 10000,
            grossPct: 0.1,
            netPct: 0.1 * (1 - rate),
            grossAnnualized: null,
            netAnnualized: null,
            passiveGross: 0,
            passiveNet: 0,
          },
        ],
        totals: [],
      } satisfies ReturnsPayload as T;
    },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AccruedReturns
        range={{ from: "2026-09-01", to: "2026-09-30" }}
        movements={[]}
        accountName=""
        excludedNames={[]}
      />
    </QueryClientProvider>,
  );
  const toggle = screen.getByRole("button", { name: "Rendimenti dei conti, anche senza vendere" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "Imposta tassazione Directa" })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(await screen.findByRole("button", { name: "Imposta tassazione Directa" }));
  expect(screen.getByRole("dialog", { name: "Tassazione · Directa" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("Aliquota (%)"));
  fireEvent.click(screen.getByRole("button", { name: "Chiudi tassazione" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Imposta tassazione Directa" }));
  const form = within(screen.getByRole("form", { name: "Tassazione Directa" }));
  fireEvent.change(form.getByLabelText("Aliquota (%)"), { target: { value: "0" } });
  fireEvent.click(form.getByRole("button", { name: "Salva aliquota" }));
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "Tassazione Directa" })).toBeNull(),
  );
  const values = [...document.querySelectorAll(".accrued-metrics strong")].map(
    (node) => node.textContent,
  );
  expect(values).toEqual([formatEuro(1000, 2), formatEuro(1000, 2), formatEuro(0, 2)]);
  fireEvent.click(toggle);
  expect(screen.queryByRole("button", { name: "Imposta tassazione Directa" })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Imposta tassazione Directa" })).toBeTruthy();
});
