import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("media cleanup marker policy", () => {
  it("keeps ready jobs until their explicit expiry and also cleans short-lived failed-job diagnostics", () => {
    const dockerCleanup = readFileSync(path.join(projectRoot, "docker", "cleanup.sh"), "utf8");
    const pterodactylCleanup = readFileSync(path.join(projectRoot, "pterodactyl", "cleanup-media.sh"), "utf8");

    for (const script of [dockerCleanup, pterodactylCleanup]) {
      expect(script).toContain("-name .ready");
      expect(script).toContain("-name .failed");
      expect(script).toContain("expiry_ms");
    }
  });
});
