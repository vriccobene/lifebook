import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@lifebook/finanze-core";
import { AnalyticsReport } from "./AnalyticsReport";
import { apiFetch } from "../api/client";
import {
  analyticsHref,
  defaultAnalyticsFilters,
  readAnalyticsFilters,
} from "../lib/analyticsFilters";
vi.mock("../api/client", () => ({ apiFetch: vi.fn() }));
vi.mock("../components/Charts", () => ({
  Bars: () => null,
  LineSeries: () => null,
  formatPct: (n: number) => String(n),
}));
const filters = {
  ...defaultAnalyticsFilters("2026-01-01", "2026-01-31"),
  includedCategories: ["Casa", "Bollette"],
};
beforeEach(() => {
  window.location.hash = analyticsHref("/analytics/report", filters);
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AnalyticsReport />
    </QueryClientProvider>,
  );
}
it("renders the selected category report, offers printing and a return link carrying the filters", async () => {
  vi.mocked(apiFetch).mockImplementation(async (_method, path) => {
    if (path === "/settings") return { effective: DEFAULT_SETTINGS, entries: [] } as never;
    if (path === "/firefly/movements")
      return [
        {
          id: "1",
          date: "2026-01-10",
          type: "withdrawal",
          amount: 310,
          fromName: "Banca",
          toName: "Negozio",
          categoryName: "Casa",
          description: "Spesa",
        },
      ] as never;
    return [] as never;
  });
  mount();
  expect(await screen.findByRole("heading", { name: "Report Analytics" })).toBeTruthy();
  expect(screen.getByText("Casa, Bollette")).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Posso smettere di lavorare? Metodi a confronto" }),
  ).toBeTruthy();
  const returnLink = screen.getByRole("link", { name: "Modifica filtri" });
  expect(readAnalyticsFilters(returnLink.getAttribute("href")!)).toEqual(filters);
  const table = screen
    .getByRole("heading", { name: "Dettaglio mensile del report" })
    .closest("section")!;
  expect(within(table).getByRole("row", { name: /Totale/ }).textContent).toContain("310");
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Stampa / Salva PDF" }));
  expect(print).toHaveBeenCalledOnce();
});
it("shows an actionable error for malformed filters without fetching data", () => {
  window.location.hash = "/analytics/report?filters=invalid";
  mount();
  expect(screen.getByRole("alert").textContent).toContain("filtri del report non sono validi");
  expect(screen.getByRole("link", { name: "Torna ad Analytics" })).toBeTruthy();
});
it("surfaces data loading failures", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("Connessione interrotta"));
  mount();
  expect((await screen.findByRole("alert")).textContent).toContain("Connessione interrotta");
});
