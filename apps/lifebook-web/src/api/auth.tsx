import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, setUnauthorizedHandler, tokenStore } from "./client";

interface AuthValue {
  authenticated: boolean;
  login(username: string, password: string): Promise<void>;
  setup(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const client = useQueryClient();

  const drop = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    client.clear();
  }, [client]);
  useEffect(() => setUnauthorizedHandler(drop), [drop]);

  const value = useMemo<AuthValue>(() => {
    const start = async (path: string, username: string, password: string) => {
      const result = await apiFetch<{ token: string }>("POST", path, { username, password });
      tokenStore.set(result.token);
      setToken(result.token);
    };
    return {
      authenticated: token !== null,
      login: (u, p) => start("/auth/login", u, p),
      setup: (u, p) => start("/auth/setup", u, p),
      async logout() {
        try {
          await apiFetch("POST", "/auth/logout", {});
        } finally {
          drop();
        }
      },
    };
  }, [token, drop]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}
