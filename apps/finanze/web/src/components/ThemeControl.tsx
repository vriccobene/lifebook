import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Preference = "system" | "light" | "dark";
const ThemeContext = createContext<{
  preference: Preference;
  change: (value: Preference) => void;
} | null>(null);
function savedPreference(): Preference {
  try {
    const value = localStorage.getItem("lifebook.theme");
    if (value === "light" || value === "dark") return value;
  } catch {
    /* Storage may be unavailable in private or restricted browsers. */
  }
  return "system";
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(savedPreference);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    function apply() {
      const theme = preference === "system" ? (media?.matches ? "dark" : "light") : preference;
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#111b19" : "#136f63");
    }
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [preference]);
  function change(value: Preference) {
    setPreference(value);
    try {
      localStorage.setItem("lifebook.theme", value);
    } catch {
      /* Keep the in-session choice. */
    }
  }
  return <ThemeContext.Provider value={{ preference, change }}>{children}</ThemeContext.Provider>;
}
export function ThemeControl() {
  const theme = useContext(ThemeContext);
  if (!theme) return null;
  return (
    <label className="theme-control">
      <span>Tema</span>
      <select
        aria-label="Tema"
        value={theme.preference}
        onChange={(e) => theme.change(e.target.value as Preference)}
      >
        <option value="system">Automatico</option>
        <option value="light">Chiaro</option>
        <option value="dark">Scuro</option>
      </select>
    </label>
  );
}
