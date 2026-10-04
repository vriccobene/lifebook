import { ThemeProvider, ThemeControl } from "./components/ThemeControl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./api/auth";
import { useGet } from "./api/hooks";
import type { Me } from "./api/types";
import { AnalyticsReport } from "./pages/AnalyticsReport";
import { Analytics } from "./pages/Analytics";
import { Accounts } from "./pages/Accounts";
import { Dashboard } from "./pages/Dashboard";
import { Essential } from "./pages/Essential";
import { Firefly } from "./pages/Firefly";
import { Giro } from "./pages/Giro";
import { Income } from "./pages/Income";
import { Login } from "./pages/Login";
import { Profile } from "./pages/Profile";
import { Returns } from "./pages/Returns";
import { Transfers } from "./pages/Transfers";
import { Settings } from "./pages/Settings";
import { Icon } from "./components/Icon";
import { useHashPath } from "./lib/router";

export const APP_TITLE = "Lifebook Finanze";

export const ROUTES: { path: string; label: string; element: () => ReactNode }[] = [
  { path: "/", label: "Cruscotto", element: () => <Dashboard /> },
  { path: "/analytics/report", label: "Report Analytics", element: () => <AnalyticsReport /> },
  { path: "/analytics", label: "Analytics", element: () => <Analytics /> },
  { path: "/giro", label: "Giro mensile", element: () => <Giro /> },
  { path: "/trasferimenti", label: "Trasferimenti", element: () => <Transfers /> },
  { path: "/conti", label: "Conti", element: () => <Accounts /> },
  { path: "/rendimenti", label: "Rendimenti", element: () => <Returns /> },
  { path: "/entrate", label: "Entrate", element: () => <Income /> },
  { path: "/essenziale", label: "Spesa essenziale", element: () => <Essential /> },
  { path: "/firefly", label: "Firefly III", element: () => <Firefly /> },
  { path: "/impostazioni", label: "Impostazioni", element: () => <Settings /> },
];

/** Reached from the user name in the header, not from the navigation. */
const PROFILE_PATH = "/profilo";

function Shell() {
  const { authenticated } = useAuth();
  if (!authenticated) return <Login />;
  return <SignedIn />;
}

function SignedIn() {
  const { logout } = useAuth();
  const fullPath = useHashPath();
  const path = fullPath.split("?")[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menuOpen) navigationRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [menuOpen]);
  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }
  function navigate() {
    setMenuOpen(false);
    document.getElementById("main-content")?.focus();
  }
  const me = useGet<Me>("/auth/me");
  const route =
    path === PROFILE_PATH
      ? { path, element: () => <Profile /> }
      : (ROUTES.find((r) => r.path === path) ?? ROUTES[0]!);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Vai al contenuto
      </a>
      <aside
        className={`sidebar${menuOpen ? " is-open" : ""}`}
        onKeyDown={(e) => {
          if (menuOpen && e.key === "Escape") {
            e.preventDefault();
            closeMenu();
          }
        }}
      >
        <a className="brand" href="#/" onClick={navigate} aria-label={APP_TITLE}>
          <span className="brand-mark">
            <Icon name="book" size={25} />
          </span>
          <span>
            Lifebook<small>FINANZE PERSONALI</small>
          </span>
        </a>
        <button className="menu-close" aria-label="Chiudi navigazione" onClick={closeMenu}>
          <Icon name="close" />
        </button>
        <nav ref={navigationRef} className="nav" aria-label="Principale" id="main-navigation">
          {[
            { label: "PANORAMICA", paths: ["/", "/analytics", "/rendimenti"] },
            {
              label: "IL TUO DENARO",
              paths: ["/conti", "/giro", "/trasferimenti", "/entrate", "/essenziale"],
            },
            { label: "PREFERENZE", paths: ["/firefly", "/impostazioni"] },
          ].map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.paths.map((item) => {
                const r = ROUTES.find((r) => r.path === item)!;
                return (
                  <a
                    key={r.path}
                    href={`#${r.path}`}
                    aria-current={r.path === route.path ? "page" : undefined}
                    onClick={navigate}
                  >
                    <Icon name={r.path} />
                    <span>{r.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-note">
          <Icon name="book" />
          <p>
            Una visione più chiara.
            <br />
            <strong>Un passo alla volta.</strong>
          </p>
        </div>
        <div className="sidebar-user">
          {me.data && (
            <a
              href={`#${PROFILE_PATH}`}
              className="user-link"
              aria-label={me.data.username}
              aria-current={path === PROFILE_PATH ? "page" : undefined}
              onClick={navigate}
              title="Profilo"
            >
              <span className="avatar">{me.data.username.slice(0, 1).toUpperCase()}</span>
              <span>
                {me.data.username}
                <small>Il tuo profilo</small>
              </span>
            </a>
          )}
          <button className="logout" onClick={() => void logout()}>
            Esci
          </button>
        </div>
      </aside>
      <div className="app-workspace">
        <header className="app-header">
          <button
            ref={menuButtonRef}
            className="menu-toggle"
            aria-label={menuOpen ? "Chiudi navigazione" : "Apri navigazione"}
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
          <div className="breadcrumb">
            Finanze <span>/</span>{" "}
            <strong>
              {path === PROFILE_PATH ? "Profilo" : ROUTES.find((r) => r.path === route.path)?.label}
            </strong>
          </div>
          <ThemeControl />
          <a className="quick-action" href="#/giro">
            <Icon name="plus" size={16} />
            Aggiorna saldi
          </a>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Fragment key={fullPath}>{route.element()}</Fragment>
        </main>
        <footer className="app-footer">
          <span>Lifebook Finanze</span>
          <span>Il tuo denaro. Le tue scelte.</span>
        </footer>
      </div>
    </div>
  );
}

export function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
