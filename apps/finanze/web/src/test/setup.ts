import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// These integration tests load data through the real API. Allow async queries to
// settle under workspace-wide CPU contention without changing test assertions.
configure({ asyncUtilTimeout: 5000 });

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
