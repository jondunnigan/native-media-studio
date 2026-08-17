import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createReadStream } from "fs";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { claimDownload, cleanExpiredMediaJobs, getAnonymousSessionId, getOwnedMediaJob, markDownloadedAndRemove, onJobEvent } from "../media";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
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
  app.get("/api/media/jobs/:id/events", async (req, res) => {
    const sessionId = getAnonymousSessionId(req, res);
    const job = await getOwnedMediaJob(req.params.id, sessionId);
    if (!job) return res.status(404).end();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    const unsubscribe = onJobEvent(job.id, event => res.write(`data: ${JSON.stringify(event)}\n\n`));
    req.on("close", unsubscribe);
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
  void cleanExpiredMediaJobs().catch(error => console.error("[Media cleanup]", error));
}

startServer().catch(console.error);
