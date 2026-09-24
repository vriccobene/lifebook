import { useEffect, useState } from "react";

/** Minimal hash router: `#/giro` -> `/giro`. */
export function currentPath(hash: string): string {
  const path = hash.replace(/^#/, "");
  return path === "" ? "/" : path;
}

export function useHashPath(): string {
  const [path, setPath] = useState(() => currentPath(window.location.hash));
  useEffect(() => {
    const listener = () => setPath(currentPath(window.location.hash));
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return path;
}
