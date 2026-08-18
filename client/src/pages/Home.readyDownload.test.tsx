// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  createDownloadLink: vi.fn().mockResolvedValue({ url: "/api/media/download/ready-job?token=signed" }),
  triggerBrowserDownload: vi.fn(),
  refetch: vi.fn(),
  startJob: vi.fn().mockResolvedValue({ jobId: "ready-job" }),
}));

vi.mock("@/lib/browserDownload", () => ({ triggerBrowserDownload: harness.triggerBrowserDownload }));

vi.mock("@/lib/trpc", async () => {
  const React = await import("react");
  const source = {
    id: "ECZigYVaa8I",
    title: "Standard watch link",
    thumbnail: null,
    durationSeconds: 10,
    formats: [{ id: "18", extension: "mp4", label: "360p · MP4", hasVideo: true, hasAudio: true, estimatedBytes: 100 }],
  };
  return {
    trpc: {
      media: {
        inspect: {
          useMutation: () => {
            const [data, setData] = React.useState<typeof source | undefined>();
            return { data, isPending: false, mutateAsync: async () => { setData(source); return source; }, reset: () => setData(undefined) };
          },
        },
        start: { useMutation: () => ({ isPending: false, mutateAsync: harness.startJob }) },
        list: { useQuery: () => ({ data: [], isLoading: false, refetch: harness.refetch }) },
        createDownloadLink: { useMutation: () => ({ mutateAsync: harness.createDownloadLink, isPending: false }) },
      },
    },
  };
});

import Home from "./Home";

class ReadyEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: "ready-job", status: "ready", progress: 100, stage: "Ready for download", outputName: "watch-link.mp4", outputBytes: 100 }) } as MessageEvent), 0);
  }

  close() {}
}

afterEach(() => {
  cleanup();
  harness.createDownloadLink.mockReset();
  harness.triggerBrowserDownload.mockClear();
  harness.refetch.mockClear();
  harness.startJob.mockClear();
  harness.startJob.mockResolvedValue({ jobId: "ready-job" });
  vi.unstubAllGlobals();
});

describe("Home ready-state delivery", () => {
  it("requests one signed URL and triggers one browser download when a standard watch-link job becomes ready", async () => {
    harness.createDownloadLink.mockResolvedValue({ url: "/api/media/download/ready-job?token=signed" });
    vi.stubGlobal("EventSource", ReadyEventSource);
    render(<Home />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), { target: { value: "https://www.youtube.com/watch?v=ECZigYVaa8I&list=RDECZigYVaa8I" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    await screen.findByText("Standard watch link");
    fireEvent.click(screen.getByRole("button", { name: /Create video file/i }));

    await waitFor(() => expect(harness.createDownloadLink).toHaveBeenCalledTimes(1));
    expect(harness.createDownloadLink).toHaveBeenCalledWith({ id: "ready-job" });
    expect(harness.triggerBrowserDownload).toHaveBeenCalledTimes(1);
    expect(harness.triggerBrowserDownload.mock.calls[0]?.[1]).toBe("/api/media/download/ready-job?token=signed");
  });

  it("keeps the completion dialog available for a manual signed download after automatic delivery is blocked", async () => {
    harness.createDownloadLink
      .mockRejectedValueOnce(new Error("Automatic delivery blocked"))
      .mockResolvedValueOnce({ url: "/api/media/download/ready-job?token=manual" });
    vi.stubGlobal("EventSource", ReadyEventSource);
    render(<Home />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), { target: { value: "https://www.youtube.com/watch?v=ECZigYVaa8I&list=RDECZigYVaa8I" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    await screen.findByText("Standard watch link");
    fireEvent.click(screen.getByRole("button", { name: /Create video file/i }));

    await waitFor(() => expect(harness.createDownloadLink).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("dialog", { name: "Your file is ready." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download file" }));
    await waitFor(() => expect(harness.createDownloadLink).toHaveBeenCalledTimes(2));
    expect(harness.triggerBrowserDownload).toHaveBeenCalledTimes(1);
    expect(harness.triggerBrowserDownload.mock.calls[0]?.[1]).toBe("/api/media/download/ready-job?token=manual");
  });

  it("sends a newly offered high-resolution quality value through to the conversion request", async () => {
    harness.createDownloadLink.mockResolvedValue({ url: "/api/media/download/ready-job?token=signed" });
    vi.stubGlobal("EventSource", ReadyEventSource);
    render(<Home />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), { target: { value: "https://www.youtube.com/watch?v=ECZigYVaa8I" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    await screen.findByText("Standard watch link");

    fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "2160p" } });
    fireEvent.click(screen.getByRole("button", { name: /Create video file/i }));

    await waitFor(() => expect(harness.startJob).toHaveBeenCalledTimes(1));
    // The UI must send exactly the value the server enum accepts, with no stale narrowing.
    expect(harness.startJob.mock.calls[0]?.[0]).toMatchObject({ mediaKind: "video", requestedQuality: "2160p" });
  });
});
