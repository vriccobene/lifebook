import { describe, expect, it } from "vitest";
import { APP_TITLE } from "./App";

describe("web scaffolding", () => {
  it("exposes the app title", () => {
    expect(APP_TITLE).toBe("Lifebook");
  });
});
