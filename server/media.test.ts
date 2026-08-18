import { createHash } from "crypto";
import { existsSync } from "fs";
import { chmod, mkdir, readFile, rm, writeFile } from "fs/promises";
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

import { canClaimDownload, canTransitionJob, claimDownload, describeMediaCommandError, describeMediaCommandFailure, formatFailureDiagnostic, inspectYouTubeMedia, isMidTransferStreamExpiry, isReadyWithinExpiry, isSupportedYouTubeUrl, markDownloadedAndRemove, normalizeJsonControlCharacters, normalizeYouTubeUrl, parseProgressPercent, parseYtDlpMetadataJson, resolveVideoHeightCeiling, startMediaJob, videoSelector, ytDlpJavaScriptRuntimeArgs, ytDlpPublicClientArgs, ytDlpResumeAndFragmentArgs } from "./media";

describe("mid-transfer stream expiry classification", () => {
  const partialTransfer403 = "[download] Destination: output.f313.webm\n  0.0%\n 10.1%\n 40.5%\n 71.0%\nERROR: unable to download video data: HTTP Error 403: Forbidden";
  const preTransfer403 = "[youtube] Extracting URL: https://www.youtube.com/watch?v=abc123\nERROR: unable to download video data: HTTP Error 403: Forbidden";

  it("treats a 403 after measurable transfer as a stream-URL expiry, not an access denial", () => {
    expect(isMidTransferStreamExpiry(partialTransfer403)).toBe(true);
    const message = describeMediaCommandFailure("yt-dlp", partialTransfer403);
    expect(message).toContain("temporary URL expired");
    expect(message).toContain("delivery-timing condition");
    expect(message).not.toContain("YouTube denied a media-stream request");
  });

  it("still reports a 403 with no transferred bytes as an access denial", () => {
    expect(isMidTransferStreamExpiry(preTransfer403)).toBe(false);
    expect(describeMediaCommandFailure("yt-dlp", preTransfer403)).toContain("YouTube denied a media-stream request");
  });

  it("does not classify unrelated failures as stream expiry", () => {
    expect(isMidTransferStreamExpiry("  42.0%\nERROR: ffmpeg exited with code 1")).toBe(false);
  });
});

describe("resume-aware fragmented delivery", () => {
  it("requests resume, fragment tolerance, and bounded chunking", () => {
    const args = ytDlpResumeAndFragmentArgs();
    expect(args).toContain("--continue");
    expect(args).toContain("--no-abort-on-unavailable-fragments");
    expect(args).toEqual(expect.arrayContaining(["--retries", "10"]));
    expect(args).toEqual(expect.arrayContaining(["--fragment-retries", "20"]));
    expect(args).toEqual(expect.arrayContaining(["--http-chunk-size", "10M"]));
    expect(args).toEqual(expect.arrayContaining(["--retry-sleep", "fragment:exp=1:20"]));
  });

  it("prefers fragmented streams before progressive fallbacks in every selector", () => {
    const uncapped = videoSelector("max", undefined);
    const capped = videoSelector("1080p", undefined);
    // DASH first, then HLS, then progressive: ordering is what preserves resumability.
    expect(uncapped.indexOf("protocol*=dash")).toBeLessThan(uncapped.indexOf("protocol*=m3u8"));
    expect(uncapped.indexOf("protocol*=m3u8")).toBeLessThan(uncapped.indexOf("/bestvideo*+bestaudio"));
    expect(capped.indexOf("protocol*=dash")).toBeLessThan(capped.indexOf("protocol*=m3u8"));
    expect(capped).toContain("bestvideo*[height<=1080]+bestaudio");
  });
});

describe("video quality ceiling", () => {
  it("applies the configured ceiling to balanced and explicit requests", () => {
    expect(resolveVideoHeightCeiling("best", "1440")).toBe(1440);
    expect(resolveVideoHeightCeiling("2160p", "1440")).toBe(1440);
    expect(resolveVideoHeightCeiling("720p", "1440")).toBe(720);
  });

  it("lets the explicit maximum-available option ignore the ceiling", () => {
    expect(resolveVideoHeightCeiling("max", "1080")).toBeNull();
    expect(videoSelector("max", "1080")).not.toContain("height<=");
  });

  it("leaves selection uncapped when no ceiling is configured", () => {
    expect(resolveVideoHeightCeiling("best", undefined)).toBeNull();
    expect(resolveVideoHeightCeiling("best", "not-a-number")).toBeNull();
  });

  it("accepts the newly supported high-resolution choices and rejects unsupported ones", () => {
    expect(videoSelector("2160p", undefined)).toContain("height<=2160");
    expect(videoSelector("1440p", undefined)).toContain("height<=1440");
    expect(() => videoSelector("999p", undefined)).toThrow("supported video quality");
  });
});

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
  it("enables Node.js for yt-dlp JavaScript challenges by default while allowing an explicit disable override", () => {
    expect(ytDlpJavaScriptRuntimeArgs()).toEqual(["--js-runtimes", "node"]);
    expect(ytDlpJavaScriptRuntimeArgs("node:/usr/local/bin/node")).toEqual(["--js-runtimes", "node:/usr/local/bin/node"]);
    expect(ytDlpJavaScriptRuntimeArgs("off")).toEqual([]);
  });

  it("keeps yt-dlp documented public-player selection by not forcing a player_client override", () => {
    expect(ytDlpPublicClientArgs()).toEqual([]);
  });

  it("converts an absent executable error into a clear setup instruction", () => {
    expect(describeMediaCommandError("yt-dlp", { code: "ENOENT" })).toContain("sudo pip3 install --upgrade yt-dlp");
  });

  it("does not expose cookie-bypass guidance when YouTube rejects automation", () => {
    const message = describeMediaCommandFailure("yt-dlp", "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser");
    expect(message).toContain("before it exposed usable media metadata or streams");
    expect(message).toContain("supported public clients");
    expect(message).not.toContain("--cookies-from-browser");
  });

  it("explains stream-level 403 failures without suggesting verification bypasses", () => {
    const message = describeMediaCommandFailure("yt-dlp", "ERROR: unable to download video data: HTTP Error 403: Forbidden");
    expect(message).toContain("media-stream request");
    expect(message).not.toContain("cookies");
  });

  it("keeps bounded yt-dlp context in the failed-job diagnostic while preserving the safe user message", () => {
    const diagnostic = formatFailureDiagnostic("YouTube denied a media-stream request.", "ERROR: unable to download video data: HTTP Error 403: Forbidden");
    expect(diagnostic).toContain("YouTube denied a media-stream request.");
    expect(diagnostic).toContain("yt-dlp diagnostic");
    expect(diagnostic).toContain("HTTP Error 403: Forbidden");
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

  it("writes safe and raw context to the retained failure artifact for a stream-level 403", async () => {
    const previousWorkDir = process.env.MEDIA_WORK_DIR;
    const previousYtDlpPath = process.env.YTDLP_PATH;
    const workDir = path.join("/tmp", `nms-stream-403-${Date.now()}`);
    const fixturePath = path.join(workDir, "yt-dlp-403.sh");
    const jobs = new Map<string, MediaJob>();

    try {
      await mkdir(workDir, { recursive: true });
      await writeFile(fixturePath, "#!/bin/sh\nprintf '%s\\n' 'ERROR: unable to download video data: HTTP Error 403: Forbidden' >&2\nexit 1\n");
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
        ownerSessionId: "stream-403-session",
        sourceUrl: "https://www.youtube.com/watch?v=PXpw9esQnnQ",
        sourceId: "PXpw9esQnnQ",
        title: "Stream 403 fixture",
        thumbnailUrl: null,
        durationSeconds: 10,
        mediaKind: "video",
        requestedQuality: "best",
        outputFormat: "mp4",
      });
      for (let attempt = 0; attempt < 50 && jobs.get(id)?.status !== "failed"; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(jobs.get(id)?.status).toBe("failed");
      const failureArtifact = await readFile(path.join(workDir, id, ".failure.txt"), "utf8");
      expect(failureArtifact).toContain("YouTube denied a media-stream request");
      expect(failureArtifact).toContain("yt-dlp diagnostic");
      expect(failureArtifact).toContain("HTTP Error 403: Forbidden");
      expect(existsSync(path.join(workDir, id, ".failed"))).toBe(true);
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
