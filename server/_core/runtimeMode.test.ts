import { describe, expect, it } from "vitest";
import { isOAuthEnabled } from "./runtimeMode";

describe("self-hosted runtime mode", () => {
  it("enables OAuth only when an OAuth server URL is configured", () => {
    expect(isOAuthEnabled("https://auth.example.test")).toBe(true);
    expect(isOAuthEnabled("  https://auth.example.test  ")).toBe(true);
    expect(isOAuthEnabled(undefined)).toBe(false);
    expect(isOAuthEnabled("")).toBe(false);
    expect(isOAuthEnabled("   ")).toBe(false);
  });
});
