import { describe, expect, it } from "vitest";
import { API_PREFIX } from "./index";

describe("api scaffolding", () => {
  it("uses the versioned prefix from the spec", () => {
    expect(API_PREFIX).toBe("/api/v1");
  });
});
