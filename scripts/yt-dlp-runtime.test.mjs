import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("yt-dlp JavaScript runtime deployment", () => {
  it("ships Node runtime configuration and the EJS package in both self-hosted images", () => {
    for (const dockerfile of ["Dockerfile", path.join("pterodactyl", "Dockerfile")]) {
      const content = readFileSync(path.join(projectRoot, dockerfile), "utf8");
      expect(content).toContain("yt-dlp-ejs");
      expect(content).toContain("YTDLP_JS_RUNTIME=node");
      expect(content).toContain("FROM node:22-slim");
    }
  });
});
