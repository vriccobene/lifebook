import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { defaultRoundDate, todayIso } from "./lib/dates";
import { CREDENTIALS, seedLife, signIn, startBackend, type Backend } from "./test/backend";

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
    expect(await screen.findByText(/senza contributi dichiarati/)).toBeTruthy();
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
