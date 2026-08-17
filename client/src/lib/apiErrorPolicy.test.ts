import { describe, expect, it } from "vitest";
import { isGuidedSourceAvailabilityMessage } from "./apiErrorPolicy";

describe("API error presentation policy", () => {
  it("identifies the source rejection that is rendered as a guided availability state", () => {
    expect(isGuidedSourceAvailabilityMessage("YouTube rejected this server’s automated request for this source.")).toBe(true);
    expect(isGuidedSourceAvailabilityMessage("Network request failed")).toBe(false);
  });
});
