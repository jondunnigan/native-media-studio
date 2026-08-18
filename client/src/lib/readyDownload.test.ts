import { describe, expect, it, vi } from "vitest";
import { startReadyDownload } from "./readyDownload";

describe("ready-state download delivery", () => {
  it("requests a signed URL for the ready job and triggers its browser attachment download", async () => {
    const click = vi.fn();
    const anchor = { href: "", download: "", style: { display: "" }, click, remove: vi.fn() };
    const documentRef = { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } } as unknown as Document;
    const requestSignedUrl = vi.fn().mockResolvedValue({ url: "/api/media/download/ready-job?token=signed" });

    await expect(startReadyDownload({ id: "ready-job", filename: "watch-link.mp4", requestSignedUrl, documentRef })).resolves.toBe("/api/media/download/ready-job?token=signed");
    expect(requestSignedUrl).toHaveBeenCalledWith("ready-job");
    expect(anchor.href).toBe("/api/media/download/ready-job?token=signed");
    expect(anchor.download).toBe("watch-link.mp4");
    expect(click).toHaveBeenCalledOnce();
  });
});
