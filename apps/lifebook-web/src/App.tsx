import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./api/auth";
import { Accounts } from "./pages/Accounts";
import { Dashboard } from "./pages/Dashboard";
import { Essential } from "./pages/Essential";
import { Giro } from "./pages/Giro";
import { Income } from "./pages/Income";
import { Login } from "./pages/Login";
import { Returns } from "./pages/Returns";
import { Settings } from "./pages/Settings";
import { useHashPath } from "./lib/router";

export const APP_TITLE = "Lifebook";

export const ROUTES: { path: string; label: string; element: () => ReactNode }[] = [
  { path: "/", label: "Cruscotto", element: () => <Dashboard /> },
  { path: "/giro", label: "Giro mensile", element: () => <Giro /> },
  { path: "/conti", label: "Conti", element: () => <Accounts /> },
  { path: "/rendimenti", label: "Rendimenti", element: () => <Returns /> },
  { path: "/entrate", label: "Entrate", element: () => <Income /> },
  { path: "/essenziale", label: "Spesa essenziale", element: () => <Essential /> },
  { path: "/impostazioni", label: "Impostazioni", element: () => <Settings /> },
];

function Shell() {
  const { authenticated, logout } = useAuth();
  const path = useHashPath();
  if (!authenticated) return <Login />;
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0]!;
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
