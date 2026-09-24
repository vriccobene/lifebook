const TOKEN_KEY = "lifebook.token";
const API = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
};

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    if (response.status === 401 && token) onUnauthorized();
    throw new ApiError(
      response.status,
      error?.code ?? "error",
      error?.message ?? response.statusText,
    );
  }
  return data as T;
}

/** Message to show the user for any error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Credenziali non valide o sessione scaduta.";
    if (error.status === 409) return `Operazione non consentita: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "Errore imprevisto";
}
