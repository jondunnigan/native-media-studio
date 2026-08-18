import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("self-hosted HTML entry point", () => {
  it("does not ship unresolved Manus analytics URL placeholders", () => {
    const html = readFileSync(path.join(projectRoot, "client", "index.html"), "utf8");
    expect(html).not.toContain("%VITE_ANALYTICS_ENDPOINT%");
    expect(html).not.toContain("%VITE_ANALYTICS_WEBSITE_ID%");
    expect(html).not.toContain("/umami");
  });
});
