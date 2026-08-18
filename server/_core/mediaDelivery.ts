import { createReadStream } from "fs";
import type { Express } from "express";
import { claimDownload, markDownloadedAndRemove } from "../media";

export function registerMediaDeliveryRoute(app: Express) {
  app.get("/api/media/download/:id", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const job = await claimDownload(req.params.id, token);
    if (!job || !job.outputPath || !job.outputName) return res.status(404).send("This download link is invalid or has expired.");
    res.setHeader("Content-Type", job.outputMime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(job.outputName)}`);
    const stream = createReadStream(job.outputPath);
    stream.on("error", () => res.status(404).end());
    res.on("finish", () => void markDownloadedAndRemove(job));
    stream.pipe(res);
  });
}
