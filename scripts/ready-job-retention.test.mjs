import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cleanupScript = path.join(projectRoot, "pterodactyl", "cleanup-media.sh");

describe("ready job retention", () => {
  it("retains a ready output until its explicit expiry, then removes it", async () => {
    const mediaRoot = await (async () => {
      const root = path.join(os.tmpdir(), `nms-ready-retention-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      await mkdir(root, { recursive: true });
      return root;
    })();
    const jobDir = path.join(mediaRoot, "watch-link-job");
    const marker = path.join(jobDir, ".ready");

    try {
      await mkdir(jobDir, { recursive: true });
      await writeFile(path.join(jobDir, "output.mp4"), "ready media");
      await writeFile(marker, String(Date.now() + 60_000));
      execFileSync("bash", [cleanupScript], { env: { ...process.env, MEDIA_WORK_DIR: mediaRoot }, stdio: "pipe" });
      expect(existsSync(jobDir)).toBe(true);

      await writeFile(marker, String(Date.now() - 5_000));
      execFileSync("bash", [cleanupScript], { env: { ...process.env, MEDIA_WORK_DIR: mediaRoot }, stdio: "pipe" });
      expect(existsSync(jobDir)).toBe(false);
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });
});
