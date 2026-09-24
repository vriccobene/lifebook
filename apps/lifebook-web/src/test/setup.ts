import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Recharts measures its container; jsdom has no layout, so give it inert observers.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = "";
});
