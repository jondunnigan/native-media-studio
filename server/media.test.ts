import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../drizzle/schema";
import * as db from "./db";

vi.mock("./db", () => ({
  getMediaJob: vi.fn(),
  updateMediaJob: vi.fn(),
  getReadyMediaJobByToken: vi.fn(),
}));

import { canClaimDownload, canTransitionJob, claimDownload, describeMediaCommandError, describeMediaCommandFailure, isReadyWithinExpiry, isSupportedYouTubeUrl, markDownloadedAndRemove, parseProgressPercent } from "./media";

describe("media URL policy", () => {
  it("permits canonical YouTube URLs and blocks arbitrary hosts", () => {
    expect(isSupportedYouTubeUrl("https://www.youtube.com/watch?v=abc123")) .toBe(true);
    expect(isSupportedYouTubeUrl("https://youtu.be/abc123")) .toBe(true);
    expect(isSupportedYouTubeUrl("https://example.com/watch?v=abc123")) .toBe(false);
    expect(isSupportedYouTubeUrl("javascript:alert(1)")) .toBe(false);
  });
});

describe("progress parsing", () => {
  it("converts yt-dlp percentage lines into bounded integer updates", () => {
    expect(parseProgressPercent("download: 43.9%")).toBe(43);
    expect(parseProgressPercent("[download] 100.0% of 12MiB")).toBe(99);
    expect(parseProgressPercent("merging formats")).toBeNull();
  });
});

describe("media tool prerequisites", () => {
  it("converts an absent executable error into a clear setup instruction", () => {
    expect(describeMediaCommandError("yt-dlp", { code: "ENOENT" })).toContain("sudo pip3 install --upgrade yt-dlp");
  });

  it("does not expose cookie-bypass guidance when YouTube rejects automation", () => {
    const message = describeMediaCommandFailure("yt-dlp", "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser");
    expect(message).toContain("does not use account credentials");
    expect(message).not.toContain("--cookies-from-browser");
  });
});

describe("download expiry", () => {
  it("rejects a ready job as soon as its 15-minute window has elapsed", () => {
    const now = new Date("2026-08-17T00:00:00.000Z");
    expect(isReadyWithinExpiry({ status: "ready", expiresAt: new Date("2026-08-17T00:15:00.000Z") }, now)).toBe(true);
    expect(isReadyWithinExpiry({ status: "ready", expiresAt: new Date("2026-08-17T00:00:00.000Z") }, now)).toBe(false);
    expect(isReadyWithinExpiry({ status: "downloaded", expiresAt: new Date("2026-08-17T00:15:00.000Z") }, now)).toBe(false);
  });
});

describe("job lifecycle", () => {
  it("permits only the expected one-way conversion and delivery transitions", () => {
    expect(canTransitionJob("queued", "fetching")).toBe(true);
    expect(canTransitionJob("downloading", "processing")).toBe(true);
    expect(canTransitionJob("processing", "ready")).toBe(true);
    expect(canTransitionJob("ready", "downloaded")).toBe(true);
    expect(canTransitionJob("ready", "expired")).toBe(true);
    expect(canTransitionJob("downloaded", "ready")).toBe(false);
    expect(canTransitionJob("ready", "downloading")).toBe(false);
  });
});

describe("one-time download delivery", () => {
  it("rejects a download claim once the successful delivery clears its token and file path", () => {
    const now = new Date("2026-08-17T00:00:00.000Z");
    const ready = { status: "ready" as const, expiresAt: new Date("2026-08-17T00:15:00.000Z"), outputPath: "/jobs/abc/output.mp4", downloadTokenHash: "hashed-token" };
    const consumed = { status: "downloaded" as const, expiresAt: ready.expiresAt, outputPath: null, downloadTokenHash: null };
    expect(canClaimDownload(ready, now)).toBe(true);
    expect(canClaimDownload(consumed, now)).toBe(false);
  });

  it("invalidates the actual claim and removes its file after a completed delivery", async () => {
    const jobId = "vitest-one-time-download";
    const jobDir = path.resolve(process.cwd(), "data", "media-jobs", jobId);
    const outputPath = path.join(jobDir, "output.mp4");
    const capability = "one-time-capability";
    let stored = {
      id: jobId,
      status: "ready",
      expiresAt: new Date(Date.now() + 60_000),
      outputPath,
      outputName: "output.mp4",
      outputMime: "video/mp4",
      downloadTokenHash: createHash("sha256").update(capability).digest("hex"),
      stage: "Ready for download",
      progress: 100,
    } as unknown as MediaJob;

    await mkdir(jobDir, { recursive: true });
    await writeFile(outputPath, "media");
    vi.mocked(db.getMediaJob).mockImplementation(async () => stored);
    vi.mocked(db.getReadyMediaJobByToken).mockImplementation(async (_id, tokenHash) =>
      stored.status === "ready" && stored.downloadTokenHash === tokenHash ? stored : undefined
    );
    vi.mocked(db.updateMediaJob).mockImplementation(async (_id, update) => {
      stored = { ...stored, ...update } as MediaJob;
      return stored;
    });

    const claimed = await claimDownload(jobId, capability);
    expect(claimed?.id).toBe(jobId);
    await markDownloadedAndRemove(claimed as MediaJob);

    expect(stored.status).toBe("downloaded");
    expect(stored.downloadTokenHash).toBeNull();
    expect(stored.outputPath).toBeNull();
    expect(existsSync(jobDir)).toBe(false);
    await expect(claimDownload(jobId, capability)).resolves.toBeUndefined();

    await rm(jobDir, { recursive: true, force: true });
  });
});
