import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { defaultRoundDate, todayIso } from "./lib/dates";
import {
  CREDENTIALS,
  pastMonthEnds,
  seedLife,
  signIn,
  startBackend,
  type Backend,
} from "./test/backend";

/**
 * End to end: the real React app in jsdom talking to the real API (in-memory SQLite) and the real core.
 */
let backend: Backend;
beforeEach(async () => {
  backend = await startBackend();
});
afterEach(async () => {
  await backend.close();
});

const today = todayIso();
const go = (hash: string) => {
  window.location.hash = hash;
};

describe("first run and login", () => {
  it("asks to create the user on the first start and then shows an empty dashboard", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Primo avvio/)).toBeTruthy();
    await user.type(screen.getByLabelText("Nome utente"), CREDENTIALS.username);
    await user.type(screen.getByLabelText("Password"), CREDENTIALS.password);
    await user.click(screen.getByRole("button", { name: "Crea utente" }));
    expect(await screen.findByRole("heading", { name: "Cruscotto" })).toBeTruthy();
    expect(await screen.findByText(/Non ci sono ancora saldi/)).toBeTruthy();
  });

  it("logs in, refuses a wrong password and logs out", async () => {
    await backend.call("POST", "/auth/setup", CREDENTIALS);
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Nome utente"), CREDENTIALS.username);
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), CREDENTIALS.password);
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    expect(await screen.findByRole("heading", { name: "Cruscotto" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Esci" }));
    expect(await screen.findByRole("button", { name: "Accedi" })).toBeTruthy();
    expect(localStorage.getItem("lifebook.token")).toBeNull();
  });

  it("drops the session when the server says the token is invalid", async () => {
    await backend.call("POST", "/auth/setup", CREDENTIALS);
    localStorage.setItem("lifebook.token", "lb_stale");
    render(<App />);
    expect(await screen.findByRole("button", { name: "Accedi" })).toBeTruthy();
  });
});

describe("dashboard", () => {
  it("shows the verdict, the indicators and every method with its outcome", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    render(<App />);

    expect(await screen.findByText(/Verde: l'obiettivo è raggiunto/)).toBeTruthy();
    expect(screen.getByText(/Senza pensione pubblica/)).toBeTruthy();
    for (const label of [
      "Costo della vita (mensile)",
      "Patrimonio netto",
      "Capitale investibile",
      "Tasso di risparmio",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    for (const name of [
      "Prelievo sicuro (SWR)",
      "Numero FI",
      "Solo rendite passive",
      "Rendite più prelievo",
      "Copertura per strati",
      "Coast FIRE",
      "Barista FIRE",
      "Lean / Regular / Fat FIRE",
      "Ponte fino alla pensione",
    ]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    // 2000 a month, deduced from balances only
    expect(screen.getAllByText(/2\.000/).length).toBeGreaterThan(0);
  });

  it("explains why a method is left out of the verdict (missing essential spending)", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    render(<App />);
    expect(await screen.findByText(/spesa essenziale non inserita/)).toBeTruthy();
    expect(screen.getByText(/Esclusi per dati mancanti/)).toBeTruthy();
  });

  it("lists the data validations in Italian", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    // an unusually high balance jump on a declared account with no contribution
    await backend.call(
      "PATCH",
      `/snapshots/${(await backend.call("GET", `/snapshots?accountId=${ids.bro}`, undefined, token)).body.at(-1).id}`,
      { balance: 900_000 },
      token,
    );
    render(<App />);
    expect((await screen.findAllByText(/senza contributi dichiarati/)).length).toBe(2); // in the list and in the month detail
  });

  it("shows how the living cost was deduced, month by month", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    render(<App />);
    expect(await screen.findByText("Come è calcolato il costo della vita")).toBeTruthy();
    expect(screen.getByText(/Mostra il dettaglio per mese \(12\)/)).toBeTruthy();
    expect(screen.getByText(/occorre registrare tutti i versamenti e i prelievi/)).toBeTruthy();
  });

  it("changes the range of the charts with the selector", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/Verde:/);
    expect(screen.getByRole("group", { name: "Intervallo temporale" })).toBeTruthy();
    const threeMonths = screen.getByRole("button", { name: "3 mesi" });
    await user.click(threeMonths);
    expect(threeMonths.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Personalizzato" }));
    expect(screen.getByLabelText("Dal")).toBeTruthy();
  });
});

describe("monthly round", () => {
  it("shows the previous balance and saves the new balances and contributions with the chosen date", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/giro");

    const date = defaultRoundDate(today);
    expect(await screen.findByRole("heading", { name: "Giro mensile" })).toBeTruthy();
    expect((screen.getByLabelText("Data di riferimento") as HTMLInputElement).value).toBe(date);

    // contributions only for the declared, non-spending account
    expect(screen.getByLabelText("Contributi Titoli")).toBeTruthy();
    for (const name of ["Conto corrente", "Deposito", "Casa"]) {
      expect(screen.queryByLabelText(`Contributi ${name}`)).toBeNull();
    }

    await user.type(screen.getByLabelText("Nuovo saldo Conto corrente"), "33.000,50");
    await user.type(screen.getByLabelText("Nuovo saldo Titoli"), "501000");
    await user.type(screen.getByLabelText("Contributi Titoli"), "500");
    await user.click(screen.getAllByRole("button", { name: "Invariato" })[2]!); // Deposito: same as before
    await user.click(screen.getByRole("button", { name: "Salva giro" }));

    expect(await screen.findByText(/salvato \(4 modifiche\)/)).toBeTruthy();
    const snapshots = (
      await backend.call("GET", `/snapshots?from=${date}&to=${date}`, undefined, token)
    ).body;
    expect(snapshots).toHaveLength(3);
    expect(snapshots.find((s: { accountId: string }) => s.accountId === ids.chk).balance).toBe(
      33000.5,
    );
    const contributions = (await backend.call("GET", "/contributions", undefined, token)).body;
    expect(contributions).toEqual([
      expect.objectContaining({ accountId: ids.bro, date, amount: 500 }),
    ]);
  });

  it("updates instead of duplicating when the round is saved twice", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/giro");
    const field = await screen.findByLabelText("Nuovo saldo Conto corrente");
    await user.type(field, "30000");
    await user.click(screen.getByRole("button", { name: "Salva giro" }));
    await screen.findByText(/salvato \(1 modifiche\)/);

    await waitFor(() => expect(screen.getByText("già registrato")).toBeTruthy());
    const again = screen.getByLabelText("Nuovo saldo Conto corrente");
    await user.clear(again);
    await user.type(again, "31000");
    await user.click(screen.getByRole("button", { name: "Salva giro" }));
    await screen.findByText(/salvato \(1 modifiche\)/);
    const rows = (await backend.call("GET", `/snapshots?accountId=${ids.chk}`, undefined, token))
      .body;
    expect(rows.filter((s: { date: string }) => s.date === defaultRoundDate(today))).toHaveLength(
      1,
    );
    expect(rows.at(-1).balance).toBe(31000);
  });

  it("warns before saving when a declared account moved a lot without contributions", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/giro");
    await user.type(await screen.findByLabelText("Nuovo saldo Titoli"), "900000");
    expect(await screen.findByText(/senza contributi/)).toBeTruthy();
  });

  it("reports an invalid number without saving anything", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/giro");
    await user.type(await screen.findByLabelText("Nuovo saldo Titoli"), "abc");
    await user.click(screen.getByRole("button", { name: "Salva giro" }));
    expect(await screen.findByText("Saldo non valido")).toBeTruthy();
    const date = defaultRoundDate(today);
    expect((await backend.call("GET", `/snapshots?from=${date}`, undefined, token)).body).toEqual(
      [],
    );
  });
});

describe("essential spending", () => {
  it("starts unset, accepts a value and uses it", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/essenziale");
    expect(await screen.findByText(/La spesa essenziale non è impostata/)).toBeTruthy();

    await user.type(screen.getByLabelText("Importo (€ al mese)"), "1.500");
    await user.click(screen.getByRole("button", { name: "Aggiungi" }));
    expect(await screen.findByText(/Valore in uso nel mese corrente/)).toBeTruthy();

    const layers = (
      await backend.call("GET", "/results/methods", undefined, token)
    ).body.methods.find((m: { id: string }) => m.id === "layers");
    expect(layers.status).not.toBe("missing_data");
  });

  it("supports a percentage and a single month", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/essenziale");
    await screen.findByText(/La spesa essenziale non è impostata/);
    await user.click(screen.getByRole("radio", { name: /Percentuale/ }));
    await user.type(screen.getByLabelText("Percentuale (%)"), "60");
    await user.click(screen.getByRole("button", { name: "Aggiungi" }));
    await screen.findByText(/60% del costo della vita/);
    await user.click(screen.getByRole("radio", { name: /singolo mese/ }));
    await user.clear(screen.getByLabelText("Importo (€ al mese)"));
    await user.type(screen.getByLabelText("Importo (€ al mese)"), "1800");
    await user.click(screen.getByRole("button", { name: "Aggiungi" }));
    await screen.findByText(/per /);
    expect(
      (await backend.call("GET", "/essential-spending", undefined, token)).body
        .map((e: { mode: string }) => e.mode)
        .sort(),
    ).toEqual(["month_amount", "percent"]);
  });

  it("rejects a percentage above 100", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/essenziale");
    await screen.findByText(/La spesa essenziale non è impostata/);
    await user.click(screen.getByRole("radio", { name: /Percentuale/ }));
    await user.type(screen.getByLabelText("Percentuale (%)"), "150");
    await user.click(screen.getByRole("button", { name: "Aggiungi" }));
    expect(await screen.findByText(/tra 0 e 100/)).toBeTruthy();
    expect((await backend.call("GET", "/essential-spending", undefined, token)).body).toEqual([]);
  });
});

describe("settings and the public pension toggle", () => {
  it("is off by default, can be switched on from a date, and the dashboard follows", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/impostazioni");
    const toggle = (await screen.findByLabelText(
      /Considera la pensione pubblica/,
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getAllByText(/Senza pensione pubblica/).length).toBeGreaterThan(0);

    await user.click(toggle);
    await user.type(screen.getByLabelText(/Importo netto mensile/), "1200");
    await user.click(screen.getByRole("button", { name: "Salva impostazioni" }));
    expect(await screen.findByText(/Impostazioni salvate/)).toBeTruthy();

    const verdict = (await backend.call("GET", "/results/verdict", undefined, token)).body;
    expect(verdict.publicPensionEnabled).toBe(true);
    const entries = (await backend.call("GET", "/settings", undefined, token)).body.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].publicPension).toEqual({ enabled: true, netMonthlyAmount: 1200 });

    go("#/");
    await screen.findByText(/Verde:/);
    await waitFor(() => expect(screen.queryByText(/Senza pensione pubblica/)).toBeNull());
  });

  it("saves only the changed fields as a dated entry, and nothing when nothing changed", async () => {
    const token = await signIn(backend);
    const user = userEvent.setup();
    render(<App />);
    go("#/impostazioni");
    await screen.findByLabelText(/Tasso di prelievo sicuro/);
    await user.click(screen.getByRole("button", { name: "Salva impostazioni" }));
    expect(await screen.findByText(/Nessuna modifica/)).toBeTruthy();
    expect((await backend.call("GET", "/settings", undefined, token)).body.entries).toEqual([]);

    const swr = screen.getByLabelText(/Tasso di prelievo sicuro/);
    await user.clear(swr);
    await user.type(swr, "4");
    await user.click(screen.getByRole("button", { name: "Salva impostazioni" }));
    await screen.findByText(/Impostazioni salvate/);
    const entries = (await backend.call("GET", "/settings", undefined, token)).body.entries;
    expect(entries).toEqual([expect.objectContaining({ safeWithdrawalRate: 0.04 })]);
    expect(Object.keys(entries[0]).sort()).toEqual(["id", "safeWithdrawalRate", "validFrom"]);
  });
});

describe("accounts, income and returns", () => {
  it("creates an account with its parameters and archives it", async () => {
    const token = await signIn(backend);
    const user = userEvent.setup();
    render(<App />);
    go("#/conti");
    await user.click(await screen.findByRole("button", { name: "Nuovo conto" }));
    await user.type(screen.getByLabelText("Nome"), "Conto principale");
    await user.click(screen.getByLabelText(/Conto di spesa/));
    await user.click(screen.getByRole("button", { name: "Crea conto" }));
    expect(await screen.findByText("Conto principale")).toBeTruthy();

    const accounts = (await backend.call("GET", "/accounts", undefined, token)).body;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].params[0]).toMatchObject({
      isSpendingAccount: true,
      validFrom: "2000-01-01",
    });

    await user.click(screen.getByRole("button", { name: "Dettagli" }));
    await user.click(screen.getByRole("button", { name: "Archivia da oggi" }));
    await screen.findByText(/Conto archiviato/);
    expect((await backend.call("GET", "/accounts", undefined, token)).body[0].archivedAt).toBe(
      today,
    );
  });

  it("requires the use of a real estate account and adds dated parameters", async () => {
    const token = await signIn(backend);
    const user = userEvent.setup();
    render(<App />);
    go("#/conti");
    await user.click(await screen.findByRole("button", { name: "Nuovo conto" }));
    await user.type(screen.getByLabelText("Nome"), "Mutuo");
    await user.selectOptions(screen.getByLabelText("Tipo"), "liability");
    await user.type(screen.getByLabelText(/Rata mensile/), "450,5");
    await user.click(screen.getByRole("button", { name: "Crea conto" }));
    await screen.findByText("Mutuo");
    const [mortgage] = (await backend.call("GET", "/accounts", undefined, token)).body;
    expect(mortgage.params[0].monthlyPayment).toBe(450.5);
    expect(mortgage.params[0].inInvestableCapital).toBe(false); // liabilities are off by default

    await user.click(screen.getByRole("button", { name: "Dettagli" }));
    await user.type(screen.getAllByLabelText(/Tassazione/).at(-1)!, "12,5");
    await user.click(screen.getByRole("button", { name: "Aggiungi" }));
    await screen.findByText(/Parametri aggiunti/);
    expect(
      (await backend.call("GET", `/accounts/${mortgage.id}/params`, undefined, token)).body,
    ).toHaveLength(2);
  });

  it("adds, edits and deletes income items", async () => {
    const token = await signIn(backend);
    const user = userEvent.setup();
    render(<App />);
    go("#/entrate");
    await user.type(await screen.findByLabelText(/^Nome/), "Stipendio");
    await user.type(screen.getByLabelText(/Importo netto/), "2.100,50");
    await user.click(screen.getByRole("button", { name: "Aggiungi" }));
    expect(await screen.findByText("Stipendio")).toBeTruthy();
    expect((await backend.call("GET", "/income-items", undefined, token)).body[0]).toMatchObject({
      amount: 2100.5,
      periodicity: "monthly",
    });

    await user.click(screen.getByRole("button", { name: "Modifica" }));
    const amount = screen.getByLabelText(/Importo netto/);
    await user.clear(amount);
    await user.type(amount, "2200");
    await user.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(async () =>
      expect((await backend.call("GET", "/income-items", undefined, token)).body[0].amount).toBe(
        2200,
      ),
    );
  });

  it("shows gross and net returns per account", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    // give the brokerage some movement
    const snaps = (await backend.call("GET", `/snapshots?accountId=${ids.bro}`, undefined, token))
      .body;
    await backend.call("PATCH", `/snapshots/${snaps.at(-1).id}`, { balance: 510_000 }, token);
    render(<App />);
    go("#/rendimenti");
    expect(await screen.findByRole("heading", { name: "Rendimenti" })).toBeTruthy();
    expect(await screen.findByText("Riepilogo dell'intervallo")).toBeTruthy();
    expect(screen.getAllByText("Titoli").length).toBeGreaterThan(0);
    expect(screen.getByText("Totale")).toBeTruthy();
  });
});

describe("transfers and contributions", () => {
  const contributions = async (token: string) =>
    (await backend.call("GET", "/contributions", undefined, token)).body;

  it("records a transfer from the spending account to a declared account with one contribution", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/trasferimenti");
    await screen.findByRole("heading", { name: "Trasferimenti" });

    await user.selectOptions(screen.getByLabelText("Da"), ids.chk);
    await user.selectOptions(screen.getByLabelText("A"), ids.bro);
    await user.type(screen.getAllByLabelText("Importo (€)", { selector: "input" })[0]!, "500");
    expect(await screen.findByText(/Verrà registrato:/)).toBeTruthy();
    expect(screen.getByText(/è un conto di spesa/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Registra trasferimento" }));

    expect(await screen.findByText(/Trasferimento registrato \(1 voce\)/)).toBeTruthy();
    expect(await contributions(token)).toEqual([
      expect.objectContaining({ accountId: ids.bro, date: today, amount: 500 }),
    ]);
  });

  it("records both sides between two declared accounts and none for a deduced deposit", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    const fund = (
      await backend.call("POST", "/accounts", { name: "Fondo", type: "external_investment" }, token)
    ).body.id;
    const user = userEvent.setup();
    render(<App />);
    go("#/trasferimenti");
    await screen.findByRole("heading", { name: "Trasferimenti" });

    await user.selectOptions(screen.getByLabelText("Da"), ids.bro);
    await user.selectOptions(screen.getByLabelText("A"), fund);
    await user.type(screen.getAllByLabelText("Importo (€)", { selector: "input" })[0]!, "300,5");
    await user.click(screen.getByRole("button", { name: "Registra trasferimento" }));
    await screen.findByText(/Trasferimento registrato \(2 voci\)/);
    const saved = await contributions(token);
    expect(
      saved.map((c: { accountId: string; amount: number }) => [c.accountId, c.amount]).sort(),
    ).toEqual(
      [
        [ids.bro, -300.5],
        [fund, 300.5],
      ].sort(),
    );

    // spending account -> deposit: both are deduced from the balances, so nothing can be recorded
    await user.selectOptions(screen.getByLabelText("Da"), ids.chk);
    await user.selectOptions(screen.getByLabelText("A"), ids.dep);
    await user.type(screen.getAllByLabelText("Importo (€)", { selector: "input" })[0]!, "100");
    expect(await screen.findByText(/nulla da registrare/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Registra trasferimento" }));
    expect(await contributions(token)).toHaveLength(2);
  });

  it("offers real estate nowhere in the transfer form", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    render(<App />);
    go("#/trasferimenti");
    await screen.findByRole("heading", { name: "Trasferimenti" });
    for (const label of ["Da", "A"]) {
      expect(
        within(screen.getByLabelText(label)).queryByRole("option", { name: "Casa" }),
      ).toBeNull();
    }
    expect(
      within(screen.getByLabelText("Da")).getByRole("option", { name: "Titoli" }),
    ).toBeTruthy();
  });

  it("records a deposit or a withdrawal on a declared account, on a past date", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/trasferimenti");
    await screen.findByRole("heading", { name: "Trasferimenti" });
    const dateField = screen.getByLabelText(/Data dei movimenti/) as HTMLInputElement;
    fireEvent.change(dateField, { target: { value: "2026-03-15" } });

    await user.selectOptions(screen.getByLabelText("Conto"), ids.bro);
    await user.selectOptions(screen.getByLabelText("Tipo"), "out");
    await user.type(screen.getAllByLabelText("Importo (€)", { selector: "input" })[1]!, "250");
    await user.click(screen.getByRole("button", { name: "Registra" }));
    expect(await screen.findByText("Prelievo registrato.")).toBeTruthy();
    expect(await contributions(token)).toEqual([
      expect.objectContaining({ accountId: ids.bro, date: "2026-03-15", amount: -250 }),
    ]);
    expect(await screen.findByText("15/03/2026")).toBeTruthy();
  });

  it("edits and deletes a recorded movement", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    await backend.call(
      "POST",
      "/contributions",
      { accountId: ids.bro, date: "2026-03-15", amount: 100 },
      token,
    );
    const user = userEvent.setup();
    render(<App />);
    go("#/trasferimenti");
    await user.click(await screen.findByRole("button", { name: "Modifica" }));
    const amount = screen.getByLabelText("Importo", { selector: "td input" });
    await user.clear(amount);
    await user.type(amount, "-40,5");
    await user.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(async () => expect((await contributions(token))[0].amount).toBe(-40.5));
    expect(await screen.findByText("Prelievo")).toBeTruthy();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Elimina" }));
    await waitFor(async () => expect(await contributions(token)).toEqual([]));
  });

  it("rejects an empty or invalid amount without writing anything", async () => {
    const token = await signIn(backend);
    const ids = await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/trasferimenti");
    await screen.findByRole("heading", { name: "Trasferimenti" });
    await user.selectOptions(screen.getByLabelText("Conto"), ids.bro);
    await user.type(screen.getAllByLabelText("Importo (€)", { selector: "input" })[1]!, "abc");
    await user.click(screen.getByRole("button", { name: "Registra" }));
    expect(await screen.findByText(/maggiore di zero/)).toBeTruthy();
    expect(await contributions(token)).toEqual([]);
  });
});

describe("pension fund accounts", () => {
  it("can be created from the accounts screen, not investable by default", async () => {
    const token = await signIn(backend);
    const user = userEvent.setup();
    render(<App />);
    go("#/conti");
    await user.click(await screen.findByRole("button", { name: "Nuovo conto" }));
    await user.type(screen.getByLabelText("Nome"), "Fondo Esempio");
    await user.selectOptions(screen.getByLabelText("Tipo"), "pension_fund");
    expect((screen.getByLabelText("Nel capitale investibile") as HTMLInputElement).checked).toBe(
      false,
    );
    await user.click(screen.getByRole("button", { name: "Crea conto" }));
    expect(await screen.findByText("Fondo Esempio")).toBeTruthy();
    const [fund] = (await backend.call("GET", "/accounts", undefined, token)).body;
    expect(fund).toMatchObject({ type: "pension_fund", contributionsMode: "declared" });
    expect(fund.params[0].inInvestableCapital).toBe(false);
  });
});

describe("profile and users", () => {
  it("lets the administrator create a user who then sees only their own, empty data", async () => {
    const token = await signIn(backend);
    await seedLife(backend, token, today);
    const user = userEvent.setup();
    render(<App />);
    go("#/profilo");
    await user.click(await screen.findByRole("link", { name: CREDENTIALS.username }));
    expect(await screen.findByRole("heading", { name: "Utenti" })).toBeTruthy();

    await user.type(screen.getByLabelText("Nome utente"), "anna");
    await user.type(screen.getByLabelText(/Password iniziale/), "anna-password");
    await user.click(screen.getByRole("button", { name: "Crea utente" }));
    expect(await screen.findByText("Utente «anna» creato.")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "anna" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Esci" }));
    await user.type(await screen.findByLabelText("Nome utente"), "anna");
    await user.type(screen.getByLabelText("Password"), "anna-password");
    await user.click(screen.getByRole("button", { name: "Accedi" }));
    go("#/");
    expect(await screen.findByText(/Non ci sono ancora saldi/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "anna" })).toBeTruthy();

    go("#/profilo");
    expect(await screen.findByRole("heading", { name: "Cambia password" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Utenti" })).toBeNull();
  });

  it("changes the password", async () => {
    await signIn(backend);
    const user = userEvent.setup();
    render(<App />);
    go("#/profilo");
    await user.type(await screen.findByLabelText("Password attuale"), CREDENTIALS.password);
    await user.type(screen.getByLabelText(/Nuova password/), "a-new-password");
    await user.click(screen.getByRole("button", { name: "Cambia password" }));
    expect(await screen.findByText(/Password cambiata/)).toBeTruthy();
    const login = await backend.call("POST", "/auth/login", {
      username: CREDENTIALS.username,
      password: "a-new-password",
    });
    expect(login.status).toBe(200);
  });
});

describe("Firefly III import", () => {
  it("connects, links the accounts creating them, previews and imports", async () => {
    const token = await signIn(backend);
    // 13 month ends up to the last complete month: the default range of the import.
    const ends = pastMonthEnds(today);
    backend.firefly.accounts = [
      {
        id: "1",
        name: "BBVA",
        type: "asset",
        role: "defaultAsset",
        openingBalance: 1_000,
        openingDate: ends[0]!,
      },
      { id: "2", name: "Broker", type: "asset", role: "sharedAsset" },
    ];
    backend.firefly.transactions = [
      {
        id: "10",
        date: ends[5]!,
        amount: 400,
        source: "1",
        destination: "2",
        description: "Investimento",
      },
    ];
    const user = userEvent.setup();
    render(<App />);
    go("#/firefly");

    await user.type(
      await screen.findByLabelText(/Indirizzo di Firefly III/),
      "https://firefly.example.com",
    );
    await user.type(
      screen.getByLabelText(/Token di accesso personale/),
      "ff-personal-access-token",
    );
    await user.click(screen.getByRole("button", { name: "Collega" }));
    expect(await screen.findByText("Collegato a Firefly III 6.4.4.")).toBeTruthy();

    await user.selectOptions(await screen.findByLabelText("Conto Lifebook per BBVA"), "__create__");
    expect(await screen.findByText(/Creato il conto «BBVA»/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Conto Lifebook per Broker"), "__create__");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Conto Lifebook per Broker") as HTMLSelectElement)
          .selectedOptions[0]!.textContent,
      ).toMatch(/^Broker/),
    );

    await user.click(screen.getByRole("button", { name: "Anteprima" }));
    expect(await screen.findByText(/Anteprima: non è stato salvato nulla/)).toBeTruthy();
    expect((await backend.call("GET", "/snapshots", undefined, token)).body).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Importa" }));
    expect(await screen.findByText(/Import completato: 13 fine mese/)).toBeTruthy();
    const snapshots = (await backend.call("GET", "/snapshots", undefined, token)).body;
    expect(snapshots.length).toBe(13 + 8); // the broker has a balance from the sixth month end
    const contributions = (await backend.call("GET", "/contributions", undefined, token)).body;
    // Neither account is marked as a spending account yet: both take the transfer, as on the Transfers screen.
    expect(
      contributions.map((c: { date: string; amount: number }) => [c.date, c.amount]).sort(),
    ).toEqual([
      [ends[5], -400],
      [ends[5], 400],
    ]);
    expect(screen.getByText(/Ultimo import il/)).toBeTruthy();
    expect(screen.getByText(/Trasferimenti tra i tuoi conti:/).parentElement!.textContent).toMatch(
      /1 nuovi/,
    );

    // The transfer is listed on the Transfers screen, from one account to the other.
    go("#/trasferimenti");
    const card = (await screen.findByText("Trasferimenti importati da Firefly III")).closest(
      "section, .card, div",
    )!;
    expect(card.parentElement!.textContent).toMatch(/BBVA.*Broker.*Investimento/);
  });
});
