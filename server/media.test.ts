import { createHash } from "crypto";
import { existsSync } from "fs";
import { chmod, mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../drizzle/schema";
import * as db from "./db";

vi.mock("./db", () => ({
  createMediaJob: vi.fn(),
  getMediaJob: vi.fn(),
  updateMediaJob: vi.fn(),
  getReadyMediaJobByToken: vi.fn(),
}));

import { canClaimDownload, canTransitionJob, claimDownload, describeMediaCommandError, describeMediaCommandFailure, inspectYouTubeMedia, isReadyWithinExpiry, isSupportedYouTubeUrl, markDownloadedAndRemove, normalizeJsonControlCharacters, normalizeYouTubeUrl, parseProgressPercent, parseYtDlpMetadataJson, startMediaJob } from "./media";

describe("media URL policy", () => {
  it("permits canonical YouTube URLs and blocks arbitrary hosts", () => {
    expect(isSupportedYouTubeUrl("https://www.youtube.com/watch?v=abc123")) .toBe(true);
    expect(isSupportedYouTubeUrl("https://youtu.be/abc123")) .toBe(true);
    expect(isSupportedYouTubeUrl("https://example.com/watch?v=abc123")) .toBe(false);
    expect(isSupportedYouTubeUrl("javascript:alert(1)")) .toBe(false);
  });

  it("normalizes watch, Shorts, and shortened links to a single-video watch URL", () => {
    expect(normalizeYouTubeUrl("https://www.youtube.com/watch?v=ECZigYVaa8I&list=RDECZigYVaa8I&start_radio=1")).toBe("https://www.youtube.com/watch?v=ECZigYVaa8I");
    expect(normalizeYouTubeUrl("https://youtube.com/shorts/ECZigYVaa8I?feature=share")).toBe("https://www.youtube.com/watch?v=ECZigYVaa8I");
    expect(normalizeYouTubeUrl("https://youtu.be/ECZigYVaa8I?t=42")).toBe("https://www.youtube.com/watch?v=ECZigYVaa8I");
  });

  it("rejects non-video YouTube pages rather than passing playlist or channel URLs to yt-dlp", () => {
    expect(() => normalizeYouTubeUrl("https://www.youtube.com/playlist?list=RDECZigYVaa8I")).toThrow("single YouTube video");
    expect(() => normalizeYouTubeUrl("https://www.youtube.com/channel/example")).toThrow("single YouTube video");
  });
});

describe("progress parsing", () => {
  it("converts yt-dlp percentage lines into bounded integer updates", () => {
    expect(parseProgressPercent("download: 43.9%")).toBe(43);
    expect(parseProgressPercent("[download] 100.0% of 12MiB")).toBe(99);
    expect(parseProgressPercent("merging formats")).toBeNull();
  });
});

describe("yt-dlp metadata parsing", () => {
  it("repairs raw control characters only when they occur inside JSON strings", () => {
    const malformed = `{"id":"source-id","title":"First line
Second line","formats":[]}`;
    const normalized = normalizeJsonControlCharacters(malformed);
    expect(normalized).toContain("First line\\nSecond line");
    expect(parseYtDlpMetadataJson(malformed)).toMatchObject({
      id: "source-id",
      title: "First line\nSecond line",
    });
  });

  it("preserves ordinary valid yt-dlp JSON metadata", () => {
    const valid = JSON.stringify({ id: "source-id", title: "A valid title", formats: [] });
    expect(parseYtDlpMetadataJson(valid)).toMatchObject({ id: "source-id", title: "A valid title" });
  });

  it("inspects chunked malformed stdout without injecting new JSON line breaks", async () => {
    const previousWorkDir = process.env.MEDIA_WORK_DIR;
    const previousYtDlpPath = process.env.YTDLP_PATH;
    const workDir = path.join("/tmp", "nms-inspection-test");
    const fixturePath = path.join(workDir, "yt-dlp-fixture.sh");

    try {
      await mkdir(workDir, { recursive: true });
      await writeFile(fixturePath, "#!/bin/sh\nprintf '%s' '{\"id\":\"chunked-id\",\"title\":\"First chunk'\nsleep 0.01\nprintf '\\n'\nprintf '%s\\n' 'second line\",\"thumbnail\":\"https://image.test/thumb.jpg\",\"duration\":42,\"formats\":[{\"format_id\":\"18\",\"ext\":\"mp4\",\"resolution\":\"360p\",\"vcodec\":\"avc1\",\"acodec\":\"mp4a\",\"filesize\":1234}]}'\n");
      await chmod(fixturePath, 0o755);
      process.env.MEDIA_WORK_DIR = workDir;
      process.env.YTDLP_PATH = fixturePath;

      const inspected = await inspectYouTubeMedia("https://www.youtube.com/watch?v=chunked-id");

      expect(inspected).toMatchObject({
        id: "chunked-id",
        title: "First chunk\nsecond line",
        thumbnail: "https://image.test/thumb.jpg",
        durationSeconds: 42,
      });
      expect(inspected.formats[0]).toMatchObject({ id: "18", extension: "mp4", hasVideo: true, hasAudio: true, estimatedBytes: 1234 });
    } finally {
      await rm(workDir, { recursive: true, force: true });
      if (previousWorkDir === undefined) delete process.env.MEDIA_WORK_DIR;
      else process.env.MEDIA_WORK_DIR = previousWorkDir;
      if (previousYtDlpPath === undefined) delete process.env.YTDLP_PATH;
      else process.env.YTDLP_PATH = previousYtDlpPath;
    }
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

  it("keeps a standard watch-link conversion output ready until signed delivery", async () => {
    const previousWorkDir = process.env.MEDIA_WORK_DIR;
    const previousYtDlpPath = process.env.YTDLP_PATH;
    const workDir = path.join("/tmp", `nms-watch-lifecycle-${Date.now()}`);
    const fixturePath = path.join(workDir, "yt-dlp-fixture.sh");
    const jobs = new Map<string, MediaJob>();

    try {
      await mkdir(workDir, { recursive: true });
      await writeFile(fixturePath, "#!/bin/sh\nprintf 'download: 100.0%\\n'\nprintf 'watch link output' > output.mp4\n");
      await chmod(fixturePath, 0o755);
      process.env.MEDIA_WORK_DIR = workDir;
      process.env.YTDLP_PATH = fixturePath;
      vi.mocked(db.createMediaJob).mockImplementation(async job => {
        jobs.set(job.id, { ...job, createdAt: new Date(), updatedAt: new Date() } as MediaJob);
      });
      vi.mocked(db.getMediaJob).mockImplementation(async id => jobs.get(id));
      vi.mocked(db.updateMediaJob).mockImplementation(async (id, update) => {
        const next = { ...jobs.get(id), ...update, updatedAt: new Date() } as MediaJob;
        jobs.set(id, next);
        return next;
      });

      const id = await startMediaJob({
        ownerSessionId: "watch-link-session",
        sourceUrl: "https://www.youtube.com/watch?v=ECZigYVaa8I&list=RDECZigYVaa8I&start_radio=1",
        sourceId: "ECZigYVaa8I",
        title: "Standard watch link",
        thumbnailUrl: null,
        durationSeconds: 10,
        mediaKind: "video",
        requestedQuality: "best",
        outputFormat: "mp4",
      });
      for (let attempt = 0; attempt < 50 && jobs.get(id)?.status !== "ready"; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const ready = jobs.get(id);
      expect(ready?.status).toBe("ready");
      expect(ready?.sourceUrl).toBe("https://www.youtube.com/watch?v=ECZigYVaa8I");
      expect(ready?.outputPath && existsSync(ready.outputPath)).toBe(true);
      expect(existsSync(path.join(workDir, id, ".ready"))).toBe(true);
    } finally {
      vi.mocked(db.createMediaJob).mockReset();
      vi.mocked(db.getMediaJob).mockReset();
      vi.mocked(db.updateMediaJob).mockReset();
      await rm(workDir, { recursive: true, force: true });
      if (previousWorkDir === undefined) delete process.env.MEDIA_WORK_DIR;
      else process.env.MEDIA_WORK_DIR = previousWorkDir;
      if (previousYtDlpPath === undefined) delete process.env.YTDLP_PATH;
      else process.env.YTDLP_PATH = previousYtDlpPath;
    }
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
