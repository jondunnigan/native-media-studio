import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getAnonymousSessionId, getMediaJobs, getOwnedMediaJob, inspectYouTubeMedia, issueDownloadLink, startMediaJob } from "./media";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  media: router({
    inspect: publicProcedure.input(z.object({ url: z.string().trim().url(), acknowledgedRights: z.literal(true) })).mutation(async ({ ctx, input }) => {
      getAnonymousSessionId(ctx.req, ctx.res);
      return inspectYouTubeMedia(input.url);
    }),
    start: publicProcedure.input(z.object({
      url: z.string().trim().url(),
      sourceId: z.string().min(1).max(64),
      title: z.string().min(1).max(255),
      thumbnailUrl: z.string().url().nullable(),
      durationSeconds: z.number().int().nonnegative().nullable(),
      mediaKind: z.enum(["video", "audio"]),
      requestedQuality: z.enum(["max", "best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "320", "192", "128"]),
      outputFormat: z.enum(["mp4", "mkv", "webm", "mp3", "aac", "flac", "wav", "ogg"]),
      acknowledgedRights: z.literal(true),
    }).superRefine((value, issue) => {
      const videoFormats = ["mp4", "mkv", "webm"];
      const audioFormats = ["mp3", "aac", "flac", "wav", "ogg"];
      const videoQualities = ["max", "best", "2160p", "1440p", "1080p", "720p", "480p", "360p"];
      const audioQualities = ["best", "320", "192", "128"];
      if (value.mediaKind === "video" && (!videoFormats.includes(value.outputFormat) || !videoQualities.includes(value.requestedQuality))) issue.addIssue({ code: "custom", message: "Choose a valid video format and quality." });
      if (value.mediaKind === "audio" && (!audioFormats.includes(value.outputFormat) || !audioQualities.includes(value.requestedQuality))) issue.addIssue({ code: "custom", message: "Choose a valid audio format and quality." });
    })).mutation(async ({ ctx, input }) => {
      const sessionId = getAnonymousSessionId(ctx.req, ctx.res);
      const jobId = await startMediaJob({
        ownerSessionId: sessionId,
        sourceUrl: input.url,
        sourceId: input.sourceId,
        title: input.title,
        thumbnailUrl: input.thumbnailUrl,
        durationSeconds: input.durationSeconds,
        mediaKind: input.mediaKind,
        requestedQuality: input.requestedQuality,
        outputFormat: input.outputFormat,
      });
      return { jobId };
    }),
    list: publicProcedure.query(async ({ ctx }) => getMediaJobs(getAnonymousSessionId(ctx.req, ctx.res))),
    get: publicProcedure.input(z.object({ id: z.string().min(1).max(36) })).query(async ({ ctx, input }) => {
      const job = await getOwnedMediaJob(input.id, getAnonymousSessionId(ctx.req, ctx.res));
      if (!job) throw new Error("Conversion not found.");
      return job;
    }),
    createDownloadLink: publicProcedure.input(z.object({ id: z.string().min(1).max(36) })).mutation(async ({ ctx, input }) =>
      issueDownloadLink(input.id, getAnonymousSessionId(ctx.req, ctx.res))
    ),
  }),
});

export type AppRouter = typeof appRouter;
