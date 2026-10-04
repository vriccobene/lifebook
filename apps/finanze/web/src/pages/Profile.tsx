import { PageHeading } from "../components/ui";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import { useGet, useWrite } from "../api/hooks";
import type { Me, UserInfo, UserRole } from "../api/types";
import { Banner, Card, Field, Loading, QueryError } from "../components/ui";
import { formatDate } from "../lib/format";
import { ROLE_LABELS } from "../lib/labels";

type Message = { kind: "ok" | "error"; text: string };

export function Profile() {
  const me = useGet<Me>("/auth/me");
  if (me.error) return <QueryError error={me.error} />;
  if (!me.data) return <Loading />;
  return (
    <>
      <PageHeading title="Profilo" eyebrow="IL TUO SPAZIO">
        Gestisci accesso, password e autorizzazioni.
      </PageHeading>
      <p className="muted">
        Sei connesso come <strong>{me.data.username}</strong> ({ROLE_LABELS[me.data.role]}). I tuoi
        conti e i tuoi dati sono visibili solo a te.
      </p>
      <PasswordCard />
      {me.data.role === "admin" && <UsersCard me={me.data} />}
    </>
  );
}

function PasswordCard() {
  const change = useWrite<{ currentPassword: string; newPassword: string }>(
    "POST",
    () => "/auth/password",
  );
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<Message | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setMessage({
        kind: "ok",
        text: "Password cambiata. Le altre sessioni aperte sono state chiuse.",
      });
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    }
  }

  return (
    <Card title="Cambia password">
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <Field label="Password attuale">
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Nuova password" hint="Almeno 8 caratteri">
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
        </div>
        {message && <Banner kind={message.kind}>{message.text}</Banner>}
        <div>
          <button className="primary" disabled={change.isPending}>
            Cambia password
          </button>
        </div>
      </form>
    </Card>
  );
}

function UsersCard({ me }: { me: Me }) {
  const users = useGet<UserInfo[]>("/users");
  const create = useWrite<{ username: string; password: string; role: UserRole }>(
    "POST",
    () => "/users",
  );
  const update = useWrite<{ id: string; body: { role?: UserRole; password?: string } }>(
    "PATCH",
    ({ id }) => `/users/${id}`,
    ({ body }) => body,
  );
  const remove = useWrite<string>("DELETE", (id) => `/users/${id}`);
  const [form, setForm] = useState({ username: "", password: "", role: "user" as UserRole });
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<Message | null>(null);

  if (users.error) return <QueryError error={users.error} />;
  if (!users.data) return <Loading what="utenti" />;

  const run = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      setMessage({ kind: "ok", text: ok });
      return true;
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
      return false;
    }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await run(() => create.mutateAsync(form), `Utente «${form.username.trim()}» creato.`))
      setForm({ username: "", password: "", role: "user" });
  }

  async function reset(user: UserInfo) {
    const done = await run(
      () => update.mutateAsync({ id: user.id, body: { password: newPassword } }),
      `Password di «${user.username}» reimpostata: le sue sessioni sono state chiuse.`,
    );
    if (done) {
      setResetting(null);
      setNewPassword("");
    }
  }

  return (
    <Card title="Utenti">
      <p className="muted small">
        Solo gli amministratori gestiscono gli utenti. Nessuno, amministratori compresi, vede i dati
        finanziari degli altri.
      </p>
      <div className="scroll-x" tabIndex={0} role="region" aria-label="Tabella dati">
        <table>
          <thead>
            <tr>
              <th>Nome utente</th>
              <th>Ruolo</th>
              <th>Creato il</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.username}
                  {user.id === me.userId && <span className="muted small"> (tu)</span>}
                </td>
                <td>
                  <select
                    aria-label={`Ruolo di ${user.username}`}
                    value={user.role}
                    onChange={(e) =>
                      void run(
                        () =>
                          update.mutateAsync({
                            id: user.id,
                            body: { role: e.target.value as UserRole },
                          }),
                        `Ruolo di «${user.username}» aggiornato.`,
                      )
                    }
                  >
                    <option value="user">{ROLE_LABELS.user}</option>
                    <option value="admin">{ROLE_LABELS.admin}</option>
                  </select>
                </td>
                <td>{formatDate(user.createdAt.slice(0, 10))}</td>
                <td>
                  {resetting === user.id ? (
                    <div className="row">
                      <input
                        type="password"
                        aria-label={`Nuova password di ${user.username}`}
                        value={newPassword}
                        minLength={8}
                        autoComplete="new-password"
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                      <button onClick={() => void reset(user)} disabled={newPassword.length < 8}>
                        Salva
                      </button>
                      <button className="link" onClick={() => setResetting(null)}>
                        Annulla
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      <button
                        className="link"
                        onClick={() => {
                          setResetting(user.id);
                          setNewPassword("");
                        }}
                      >
                        Reimposta password
                      </button>
                      {user.id !== me.userId && (
                        <button
                          className="link danger"
                          onClick={() =>
                            confirm(
                              `Eliminare «${user.username}» e tutti i suoi dati? L'operazione non si può annullare.`,
                            ) &&
                            void run(
                              () => remove.mutateAsync(user.id),
                              `Utente «${user.username}» eliminato.`,
                            )
                          }
                        >
                          Elimina
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <h3>Nuovo utente</h3>
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <Field label="Nome utente">
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Password iniziale" hint="Almeno 8 caratteri; l'utente può cambiarla">
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
          <Field label="Ruolo">
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            >
              <option value="user">{ROLE_LABELS.user}</option>
              <option value="admin">{ROLE_LABELS.admin}</option>
            </select>
          </Field>
        </div>
        <div>
          <button className="primary" disabled={create.isPending}>
            Crea utente
          </button>
        </div>
      </form>
    </Card>
  );
}
