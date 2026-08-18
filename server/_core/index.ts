import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerMediaDeliveryRoute } from "./mediaDelivery";
import { ENV } from "./env";
import { CONTAINER_BIND_HOST, getAssignedPort } from "./networkBinding";
import { isOAuthEnabled } from "./runtimeMode";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { cleanExpiredMediaJobs, getAnonymousSessionId, getOwnedMediaJob, onJobEvent } from "../media";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  if (isOAuthEnabled(ENV.oAuthServerUrl)) {
    registerOAuthRoutes(app);
  } else {
    console.log("[OAuth] Disabled: self-hosted anonymous mode is active.");
  }
  registerMediaDeliveryRoute(app);
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

  const port = getAssignedPort(process.env.PORT);

  server.listen(port, CONTAINER_BIND_HOST, () => {
    console.log(`Server listening on ${CONTAINER_BIND_HOST}:${port} (Pterodactyl allocation port)`);
  });
  void cleanExpiredMediaJobs().catch(error => console.error("[Media cleanup]", error));
}

startServer().catch(console.error);
