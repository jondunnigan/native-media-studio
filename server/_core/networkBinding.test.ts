import { describe, expect, it } from "vitest";
import { CONTAINER_BIND_HOST, getAssignedPort } from "./networkBinding";

describe("Pterodactyl network binding", () => {
  it("binds to all container interfaces and accepts the assigned port", () => {
    expect(CONTAINER_BIND_HOST).toBe("0.0.0.0");
    expect(getAssignedPort("25504")).toBe(25504);
    expect(getAssignedPort(undefined)).toBe(3000);
  });

  it("rejects unsafe or invalid allocation values", () => {
    expect(() => getAssignedPort("0")).toThrow("valid TCP port");
    expect(() => getAssignedPort("70000")).toThrow("valid TCP port");
    expect(() => getAssignedPort("not-a-port")).toThrow("valid TCP port");
  });
});
