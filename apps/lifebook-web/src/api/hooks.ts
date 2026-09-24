import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

/** GET query keyed by its path, so every screen sharing a path shares the cache. */
export function useGet<T>(path: string, options: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({
    queryKey: ["api", path],
    queryFn: () => apiFetch<T>("GET", path),
    ...options,
  });
}

/** Any write can change any result (history is recalculated), so every query is refreshed afterwards. */
export function useWrite<TBody, TResult = unknown>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: (input: TBody) => string,
  /** What to send as the request body when it is not the input itself. */
  payload: (input: TBody) => unknown = (input) => input,
) {
  const client = useQueryClient();
  return useMutation<TResult, Error, TBody>({
    mutationFn: (input) =>
      apiFetch<TResult>(method, path(input), method === "DELETE" ? undefined : payload(input)),
    onSuccess: () => client.invalidateQueries({ queryKey: ["api"] }),
  });
}

export function rangeQuery(from: string, to: string, step: "month" | "round" = "round"): string {
  return `from=${from}&to=${to}&step=${step}`;
}
