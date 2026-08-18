import { createHash, randomBytes } from "crypto";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { mkdir, readdir, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { nanoid } from "nanoid";
import * as db from "./db";
import type { MediaJob } from "../drizzle/schema";

const DOWNLOAD_TTL_MS = 15 * 60 * 1000;
const METADATA_TIMEOUT_MS = 30 * 1000;
const CONVERSION_TIMEOUT_MS = 25 * 60 * 1000;
const MAX_ACTIVE_JOBS = 1;
const jobEvents = new EventEmitter();
const activeJobs = new Set<string>();

export type MediaKind = "video" | "audio";
export type JobUpdate = Pick<MediaJob, "id" | "status" | "progress" | "stage" | "failureMessage" | "expiresAt" | "outputName" | "outputBytes">;

type YoutubeMetadata = {
  id?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  formats?: Array<{
    format_id?: string;
    ext?: string;
    resolution?: string;
    height?: number;
    width?: number;
    fps?: number;
    vcodec?: string;
    acodec?: string;
    filesize?: number;
    filesize_approx?: number;
  }>;
};

export type InspectedMedia = {
  id: string;
  title: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  formats: Array<{
    id: string;
    extension: string;
    label: string;
    hasVideo: boolean;
    hasAudio: boolean;
    estimatedBytes: number | null;
  }>;
};

export function isSupportedYouTubeUrl(rawUrl: string): boolean {
  try {
    normalizeYouTubeUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

export function normalizeYouTubeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid YouTube video or Shorts URL. This app does not accept arbitrary video hosts or playlists.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Enter a valid YouTube video or Shorts URL. This app does not accept arbitrary video hosts or playlists.");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId: string | undefined;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0];
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? undefined;
    if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.split("/").filter(Boolean)[1];
  }

  if (!videoId || !/^[A-Za-z0-9_-]{6,64}$/.test(videoId)) throw new Error("A single YouTube video identifier is required.");
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function assertSupportedYouTubeUrl(rawUrl: string): string {
  return normalizeYouTubeUrl(rawUrl);
}

function getWorkDir() {
  return process.env.MEDIA_WORK_DIR || path.resolve(process.cwd(), "data", "media-jobs");
}

function ytDlpPath() {
  return process.env.YTDLP_PATH || "yt-dlp";
}

function ffmpegLocation() {
  return process.env.FFMPEG_PATH || "/usr/bin/ffmpeg";
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function emitJob(job: MediaJob | undefined) {
  if (!job) return;
  const update: JobUpdate = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    failureMessage: job.failureMessage,
    expiresAt: job.expiresAt,
    outputName: job.outputName,
    outputBytes: job.outputBytes,
  };
  jobEvents.emit(job.id, update);
}

async function patchJob(id: string, values: Parameters<typeof db.updateMediaJob>[1]) {
  const current = await db.getMediaJob(id);
  if (!current) throw new Error("Conversion job was not found.");
  if (values.status && !canTransitionJob(current.status, values.status)) {
    throw new Error(`Invalid conversion state transition: ${current.status} to ${values.status}.`);
  }
  const job = await db.updateMediaJob(id, values);
  emitJob(job);
  return job;
}

export function onJobEvent(jobId: string, listener: (event: JobUpdate) => void) {
  jobEvents.on(jobId, listener);
  return () => jobEvents.off(jobId, listener);
}

export function parseProgressPercent(text: string): number | null {
  const match = text.match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(99, Math.floor(value)));
}

export function describeMediaCommandError(command: string, error: unknown): string {
  if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
    return `The required ${command} executable is not installed or is not on PATH. Install ${command}${command === "yt-dlp" ? " with ‘sudo pip3 install --upgrade yt-dlp’" : " and try again"}, then restart the server.`;
  }
  return error instanceof Error ? error.message : "The media command could not be started.";
}

export function describeMediaCommandFailure(command: string, output: string): string {
  if (command === "yt-dlp" && /sign in to confirm you.?re not a bot|confirm you.?re not a bot/i.test(output)) {
    return "YouTube rejected this server’s automated request for this source. Native Media Studio does not use account credentials or bypass verification controls. Please try a different source, wait and retry later, or use the application only where the source is publicly available to your self-hosted server.";
  }
  return output || `${command} ended without a successful result.`;
}

export function normalizeJsonControlCharacters(rawJson: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const character of rawJson) {
    if (!inString) {
      if (character === '"') inString = true;
      result += character;
      continue;
    }

    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      result += character;
      escaped = true;
      continue;
    }

    if (character === '"') {
      result += character;
      inString = false;
      continue;
    }

    if (character.charCodeAt(0) < 32) {
      result += JSON.stringify(character).slice(1, -1);
      continue;
    }

    result += character;
  }

  return result;
}

export function parseYtDlpMetadataJson(rawJson: string): YoutubeMetadata {
  try {
    return JSON.parse(rawJson) as YoutubeMetadata;
  } catch {
    const normalized = normalizeJsonControlCharacters(rawJson);
    try {
      return JSON.parse(normalized) as YoutubeMetadata;
    } catch {
      throw new Error("The source returned malformed metadata that could not be safely read.");
    }
  }
}

export function isReadyWithinExpiry(job: Pick<MediaJob, "status" | "expiresAt">, now = new Date()): boolean {
  return job.status === "ready" && Boolean(job.expiresAt && job.expiresAt.getTime() > now.getTime());
}

export function canClaimDownload(job: Pick<MediaJob, "status" | "expiresAt" | "outputPath" | "downloadTokenHash">, now = new Date()): boolean {
  return isReadyWithinExpiry(job, now) && Boolean(job.outputPath && job.downloadTokenHash);
}

export type JobStatus = "queued" | "fetching" | "downloading" | "processing" | "ready" | "failed" | "expired" | "downloaded";

const allowedTransitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["fetching", "failed"],
  fetching: ["downloading", "failed"],
  downloading: ["processing", "failed"],
  processing: ["ready", "failed"],
  ready: ["downloaded", "expired"],
  failed: [],
  expired: [],
  downloaded: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

async function runCommand(command: string, args: string[], cwd: string, timeoutMs: number, onLine?: (line: string) => void, captureStdout = false) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let diagnosticOutput = "";
    let stdout = "";
    const consume = (chunk: Buffer, isStdout: boolean) => {
      const text = chunk.toString();
      diagnosticOutput = `${diagnosticOutput}${text}`.slice(-8000);
      if (captureStdout && isStdout) stdout += text;
      text.split(/\r?\n/).filter(Boolean).forEach(line => onLine?.(line));
    };
    child.stdout.on("data", chunk => consume(chunk, true));
    child.stderr.on("data", chunk => consume(chunk, false));
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The media operation exceeded the configured time limit."));
    }, timeoutMs);
    child.on("error", error => {
      clearTimeout(timeout);
      reject(new Error(describeMediaCommandError(command, error)));
    });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(describeMediaCommandFailure(command, diagnosticOutput || `${command} exited with code ${code ?? "unknown"}.`)));
    });
  });
}

export async function inspectYouTubeMedia(rawUrl: string): Promise<InspectedMedia> {
  const sourceUrl = assertSupportedYouTubeUrl(rawUrl);
  const tempDir = path.join(getWorkDir(), "inspection");
  await mkdir(tempDir, { recursive: true });
  const output = await runCommand(
    ytDlpPath(),
    ["--no-playlist", "--no-warnings", "--skip-download", "--dump-single-json", "--", sourceUrl],
    tempDir,
    METADATA_TIMEOUT_MS,
    undefined,
    true,
  );
  const metadata = parseYtDlpMetadataJson(output);
  if (!metadata.id || !metadata.title) throw new Error("The source did not provide usable media metadata.");
  const formats = (metadata.formats ?? [])
    .filter(format => format.format_id && format.ext)
    .slice(0, 100)
    .map(format => {
      const hasVideo = Boolean(format.vcodec && format.vcodec !== "none");
      const hasAudio = Boolean(format.acodec && format.acodec !== "none");
      const resolution = format.resolution || (format.height ? `${format.height}p` : hasAudio ? "Audio" : "Unknown");
      return {
        id: format.format_id as string,
        extension: format.ext as string,
        label: `${resolution} · ${(format.ext as string).toUpperCase()}${format.fps ? ` · ${format.fps} fps` : ""}`,
        hasVideo,
        hasAudio,
        estimatedBytes: format.filesize ?? format.filesize_approx ?? null,
      };
    });
  return {
    id: metadata.id,
    title: metadata.title,
    thumbnail: metadata.thumbnail ?? null,
    durationSeconds: typeof metadata.duration === "number" ? metadata.duration : null,
    formats,
  };
}

function videoSelector(quality: string) {
  if (quality === "best") return "bestvideo*+bestaudio/best";
  const height = Number(quality.replace("p", ""));
  if (!Number.isInteger(height) || ![1080, 720, 480, 360].includes(height)) {
    throw new Error("Choose a supported video quality.");
  }
  return `bestvideo*[height<=${height}]+bestaudio/best[height<=${height}]`;
}

function audioQuality(quality: string) {
  if (quality === "best") return "0";
  if (["320", "192", "128"].includes(quality)) return `${quality}K`;
  throw new Error("Choose a supported audio quality.");
}

function outputMime(format: string) {
  const values: Record<string, string> = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    webm: "video/webm",
    mp3: "audio/mpeg",
    aac: "audio/aac",
    flac: "audio/flac",
    wav: "audio/wav",
    ogg: "audio/ogg",
  };
  return values[format] ?? "application/octet-stream";
}

async function findOutput(jobDir: string) {
  const names = await readdir(jobDir);
  const candidate = names.find(name => name.startsWith("output.") && !name.endsWith(".part"));
  if (!candidate) throw new Error("Conversion completed without producing an output file.");
  const outputPath = path.join(jobDir, candidate);
  const info = await stat(outputPath);
  if (!info.isFile() || info.size <= 0) throw new Error("Conversion produced an empty output file.");
  return { outputPath, name: candidate, bytes: info.size };
}

export async function startMediaJob(input: {
  ownerSessionId: string;
  sourceUrl: string;
  sourceId: string;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  mediaKind: MediaKind;
  requestedQuality: string;
  outputFormat: string;
}) {
  const sourceUrl = assertSupportedYouTubeUrl(input.sourceUrl);
  const id = nanoid(24);
  await db.createMediaJob({
    id,
    ownerSessionId: input.ownerSessionId,
    sourceUrl,
    sourceId: input.sourceId,
    title: input.title.slice(0, 255),
    thumbnailUrl: input.thumbnailUrl,
    durationSeconds: input.durationSeconds,
    mediaKind: input.mediaKind,
    requestedQuality: input.requestedQuality,
    outputFormat: input.outputFormat,
    status: "queued",
    progress: 0,
    stage: "Queued",
  });
  void runMediaJob(id);
  return id;
}

export async function runMediaJob(jobId: string) {
  if (activeJobs.size >= MAX_ACTIVE_JOBS) {
    await patchJob(jobId, { status: "failed", stage: "Unavailable", failureMessage: "This self-hosted instance is busy. Please try again in a moment." });
    return;
  }
  activeJobs.add(jobId);
  const jobDir = path.join(getWorkDir(), jobId);
  try {
    const job = await db.getMediaJob(jobId);
    if (!job) return;
    await mkdir(jobDir, { recursive: true });
    await patchJob(jobId, { status: "fetching", progress: 2, stage: "Preparing source" });
    const commonArgs = [
      "--no-playlist",
      "--newline",
      "--progress-template", "download:%(progress._percent_str)s",
      "--ffmpeg-location", ffmpegLocation(),
      "--output", path.join(jobDir, "output.%(ext)s"),
    ];
    const args = job.mediaKind === "video"
      ? [...commonArgs, "--format", videoSelector(job.requestedQuality), "--merge-output-format", job.outputFormat, "--", job.sourceUrl]
      : [...commonArgs, "--extract-audio", "--audio-format", job.outputFormat, "--audio-quality", audioQuality(job.requestedQuality), "--", job.sourceUrl];
    await patchJob(jobId, { status: "downloading", progress: 4, stage: "Downloading source streams" });
    await runCommand(ytDlpPath(), args, jobDir, CONVERSION_TIMEOUT_MS, line => {
      const progress = parseProgressPercent(line);
      if (progress !== null) {
        void patchJob(jobId, { status: "downloading", progress, stage: progress >= 99 ? "Finalizing file" : "Downloading source streams" });
      }
    });
    await patchJob(jobId, { status: "processing", progress: 99, stage: "Verifying output" });
    const output = await findOutput(jobDir);
    const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MS);
    await patchJob(jobId, {
      status: "ready",
      progress: 100,
      stage: "Ready for download",
      outputPath: output.outputPath,
      outputName: `${job.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 120) || "media"}.${job.outputFormat}`,
      outputMime: outputMime(job.outputFormat),
      outputBytes: output.bytes,
      expiresAt,
    });
    // The independent cleanup service reads this timestamp and never deletes early.
    await writeFile(path.join(jobDir, ".ready"), String(expiresAt.getTime()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media conversion failed.";
    await patchJob(jobId, { status: "failed", stage: "Conversion failed", failureMessage: message.slice(0, 512) });
    await rm(jobDir, { recursive: true, force: true });
  } finally {
    activeJobs.delete(jobId);
  }
}

export async function getMediaJobs(ownerSessionId: string) {
  return db.listMediaJobsForSession(ownerSessionId);
}

export async function getOwnedMediaJob(id: string, ownerSessionId: string) {
  const job = await db.getMediaJob(id);
  if (!job || job.ownerSessionId !== ownerSessionId) return undefined;
  return job;
}

export async function issueDownloadLink(id: string, ownerSessionId: string) {
  const job = await getOwnedMediaJob(id, ownerSessionId);
  if (!job || !isReadyWithinExpiry(job)) {
    throw new Error("This file is no longer available. Completed files are deleted after 15 minutes.");
  }
  const token = randomBytes(32).toString("base64url");
  await patchJob(id, { downloadTokenHash: hashToken(token) });
  return { url: `/api/media/download/${id}?token=${encodeURIComponent(token)}`, expiresAt: job.expiresAt };
}

export async function claimDownload(id: string, token: string) {
  const job = await db.getReadyMediaJobByToken(id, hashToken(token), new Date());
  if (!job || !canClaimDownload(job) || !job.outputPath || !existsSync(job.outputPath)) return undefined;
  return job;
}

export async function markDownloadedAndRemove(job: MediaJob) {
  await patchJob(job.id, { status: "downloaded", stage: "Downloaded", downloadedAt: new Date(), downloadTokenHash: null, outputPath: null });
  await rm(path.join(getWorkDir(), job.id), { recursive: true, force: true });
}

export async function cleanExpiredMediaJobs() {
  const expired = await db.listExpiredMediaJobs(new Date());
  for (const job of expired) {
    await patchJob(job.id, { status: "expired", stage: "Expired", outputPath: null, downloadTokenHash: null });
    await rm(path.join(getWorkDir(), job.id), { recursive: true, force: true });
  }
}

export function getAnonymousSessionId(req: { headers: { cookie?: string } }, res: { cookie: (name: string, value: string, options: Record<string, unknown>) => unknown }) {
  const cookieValue = req.headers.cookie?.match(/(?:^|;\s*)nms_session=([^;]+)/)?.[1];
  if (cookieValue && /^[A-Za-z0-9_-]{24,64}$/.test(cookieValue)) return cookieValue;
  const sessionId = randomBytes(24).toString("base64url");
  res.cookie("nms_session", sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7, path: "/" });
  return sessionId;
}
