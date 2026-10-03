import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./api/auth";
import { useGet } from "./api/hooks";
import type { Me } from "./api/types";
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
import { useHashPath } from "./lib/router";

export const APP_TITLE = "Lifebook Finanze";

export const ROUTES: { path: string; label: string; element: () => ReactNode }[] = [
  { path: "/", label: "Cruscotto", element: () => <Dashboard /> },
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
  const path = useHashPath();
  const me = useGet<Me>("/auth/me");
  const route =
    path === PROFILE_PATH
      ? { path, element: () => <Profile /> }
      : (ROUTES.find((r) => r.path === path) ?? ROUTES[0]!);
  return (
    <>
      <header className="app-header">
        <span className="brand">{APP_TITLE}</span>
        <nav className="nav" aria-label="Principale">
          {ROUTES.map((r) => (
            <a
              key={r.path}
              href={`#${r.path}`}
              aria-current={r.path === route.path ? "page" : undefined}
            >
              {r.label}
            </a>
          ))}
        </nav>
        {me.data && (
          <a
            href={`#${PROFILE_PATH}`}
            className="user-link"
            aria-current={path === PROFILE_PATH ? "page" : undefined}
            title="Profilo"
          >
            {me.data.username}
          </a>
        )}
        <button onClick={() => void logout()}>Esci</button>
      </header>
      <main>{route.element()}</main>
    </>
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
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </QueryClientProvider>
  );
}
