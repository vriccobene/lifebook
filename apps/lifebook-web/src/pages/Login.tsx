import { useState, type FormEvent } from "react";
import { useAuth } from "../api/auth";
import { errorMessage } from "../api/client";
import { useGet } from "../api/hooks";
import { Banner, Field } from "../components/ui";

export function Login() {
  const { login, setup } = useAuth();
  const status = useGet<{ setupRequired: boolean }>("/auth/status");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setupRequired = status.data?.setupRequired ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (setupRequired ? setup : login)(username, password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="card">
        <h1>Lifebook Finanze</h1>
        {setupRequired && (
          <Banner kind="info">
            Primo avvio: scegli nome utente e password (almeno 8 caratteri).
          </Banner>
        )}
        {status.error && <Banner kind="error">Il server non risponde. È avviato?</Banner>}
        <form className="stack" onSubmit={submit}>
          <Field label="Nome utente">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={setupRequired ? "new-password" : "current-password"}
              minLength={setupRequired ? 8 : 1}
              required
            />
          </Field>
          {error && <Banner kind="error">{error}</Banner>}
          <button className="primary" disabled={busy}>
            {setupRequired ? "Crea utente" : "Accedi"}
          </button>
        </form>
        {!setupRequired && (
          <details className="small muted" style={{ marginTop: 12 }}>
            <summary>Password dimenticata?</summary>
            <p>
              Un amministratore può reimpostarla dalla pagina Profilo. Altrimenti, dal computer dove
              gira Lifebook, esegui nella cartella del progetto:
            </p>
            <pre>pnpm --filter @lifebook/api users reset-password NOME</pre>
            <p>Stampa una nuova password. I tuoi dati non vengono toccati.</p>
          </details>
        )}
      </section>
    </main>
  );
}
