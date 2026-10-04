import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Bars, LineSeries, StackedArea } from "./Charts";

const rows = [
  { date: "2026-01-31", income: 2000, cost: 900, total: 1100 },
  { date: "2026-02-28", income: 2200, cost: 950, total: 1250 },
];
const series = [
  { key: "income", label: "Entrate" },
  { key: "cost", label: "Spese" },
];

describe.each([Bars, LineSeries, StackedArea])("controlli dei grafici %s", (Chart) => {
  it("toggles series, isolates one and restores all, including keyboard access", async () => {
    const user = userEvent.setup();
    render(<Chart rows={rows} series={series} />);
    const income = screen.getByRole("button", { name: "Entrate" });
    expect(income.getAttribute("aria-pressed")).toBe("true");
    income.focus();
    await user.keyboard("{Enter}");
    expect(income.getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Mostra solo Entrate" }));
    expect(income.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Spese" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Mostra tutte" }));
    expect(screen.getByRole("button", { name: "Spese" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("shows only visible series in the accessible data table and handles all hidden", async () => {
    const user = userEvent.setup();
    render(<Chart rows={rows} series={series} />);
    await user.click(screen.getByRole("button", { name: "Mostra dati" }));
    expect(
      within(screen.getByRole("table")).getByRole("columnheader", { name: "Spese" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Spese" }));
    expect(
      within(screen.getByRole("table")).queryByRole("columnheader", { name: "Spese" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Entrate" }));
    expect(screen.getByText("Nessuna serie visibile. Attiva una voce della legenda.")).toBeTruthy();
  });
});

it("includes the net worth overlay in the area chart controls", async () => {
  const user = userEvent.setup();
  render(
    <StackedArea rows={rows} series={series} line={{ key: "total", label: "Patrimonio netto" }} />,
  );
  await user.click(screen.getByRole("button", { name: "Mostra solo Patrimonio netto" }));
  await user.click(screen.getByRole("button", { name: "Mostra dati" }));
  expect(
    within(screen.getByRole("table")).queryByRole("columnheader", { name: "Entrate" }),
  ).toBeNull();
  expect(
    within(screen.getByRole("table")).getByRole("columnheader", { name: "Patrimonio netto" }),
  ).toBeTruthy();
});

it("zooms the chart and table together and resets the date bounds", async () => {
  const user = userEvent.setup();
  render(<Bars rows={rows} series={series} />);
  await user.click(screen.getByText("Intervallo", { exact: true }));
  await user.selectOptions(screen.getByLabelText("Inizio intervallo grafico"), "2026-02-28");
  await user.click(screen.getByRole("button", { name: "Mostra dati" }));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Ripristina intervallo" }));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
});

it("keeps series choices when data changes and offers recovery from an empty interval", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<LineSeries rows={rows} series={series} />);
  await user.click(screen.getByRole("button", { name: "Spese" }));
  await user.click(screen.getByText("Intervallo", { exact: true }));
  await user.selectOptions(screen.getByLabelText("Inizio intervallo grafico"), "2026-02-28");
  rerender(<LineSeries rows={[{ date: "2026-01-01", income: 100, cost: 20 }]} series={series} />);
  expect(screen.getByText(/Nessun dato in questo intervallo/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Ripristina intervallo" }));
  expect(screen.queryByText(/Nessun dato in questo intervallo/)).toBeNull();
  expect(screen.getByRole("button", { name: "Spese" }).getAttribute("aria-pressed")).toBe("false");
});
