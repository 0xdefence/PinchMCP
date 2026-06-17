import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("reads LINEAR_API_KEY", () => {
    expect(loadConfig({ LINEAR_API_KEY: "lin_abc" }).linearApiKey).toBe("lin_abc");
  });

  it("throws a clear error when the key is missing", () => {
    expect(() => loadConfig({})).toThrow(/LINEAR_API_KEY/);
  });
});
