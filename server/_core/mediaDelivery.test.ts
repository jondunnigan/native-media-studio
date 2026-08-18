import { createServer } from "http";
import express from "express";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaJob } from "../../drizzle/schema";

vi.mock("../media", () => ({
  claimDownload: vi.fn(),
  markDownloadedAndRemove: vi.fn(),
}));

import { claimDownload, markDownloadedAndRemove } from "../media";
import { registerMediaDeliveryRoute } from "./mediaDelivery";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("signed media delivery", () => {
  it("streams an attachment, invokes cleanup, and rejects a second use of the signed URL", async () => {
    const directory = path.join("/tmp", "nms-media-delivery-test");
    const filePath = path.join(directory, "finished.mp4");
    temporaryPaths.push(directory);
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, "converted media");
    const job = { id: "delivery-job", outputPath: filePath, outputName: "finished.mp4", outputMime: "video/mp4" } as MediaJob;
    vi.mocked(claimDownload).mockResolvedValueOnce(job).mockResolvedValueOnce(undefined);
    vi.mocked(markDownloadedAndRemove).mockResolvedValue(undefined);

    const app = express();
    registerMediaDeliveryRoute(app);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not receive a TCP address.");

    try {
      const first = await fetch(`http://127.0.0.1:${address.port}/api/media/download/delivery-job?token=signed-token`);
      expect(first.status).toBe(200);
      expect(first.headers.get("content-disposition")).toContain("attachment");
      expect(await first.text()).toBe("converted media");
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(markDownloadedAndRemove).toHaveBeenCalledWith(job);

      const second = await fetch(`http://127.0.0.1:${address.port}/api/media/download/delivery-job?token=signed-token`);
      expect(second.status).toBe(404);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
