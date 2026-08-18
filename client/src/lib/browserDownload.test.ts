import { describe, expect, it, vi } from "vitest";
import { supportsAnchorDownload, triggerBrowserDownload } from "./browserDownload";

describe("browser download delivery", () => {
  it("clicks a temporary download anchor using the signed URL", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: "", download: "", style: { display: "" }, click, remove };
    const appendChild = vi.fn();
    const documentRef = { createElement: vi.fn(() => anchor), body: { appendChild } };

    triggerBrowserDownload(documentRef as unknown as Document, "/api/media/download/job?token=signed", "finished.mp4");

    expect(anchor.href).toBe("/api/media/download/job?token=signed");
    expect(anchor.download).toBe("finished.mp4");
    expect(anchor.style.display).toBe("none");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe("single-use signed URL delivery", () => {
  function documentStub({ downloadSupported }: { downloadSupported: boolean }) {
    const anchor = downloadSupported
      ? { href: "", download: "", style: { display: "" }, click: vi.fn(), remove: vi.fn() }
      : { href: "", style: { display: "" }, click: vi.fn(), remove: vi.fn() };
    const assign = vi.fn();
    const documentRef = {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
      defaultView: { location: { assign } },
    } as unknown as Document;
    return { anchor, assign, documentRef };
  }

  it("issues exactly one delivery request and never also navigates, because the token is single-use", () => {
    vi.useFakeTimers();
    const { anchor, assign, documentRef } = documentStub({ downloadSupported: true });

    triggerBrowserDownload(documentRef, "/api/media/download/job-1?token=abc", "clip.mp4");
    // Advance well past any plausible retry delay: a second request would consume an
    // already-claimed token and destroy the output before the real download finished.
    vi.advanceTimersByTime(5000);

    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("navigates instead of clicking only when the anchor download attribute is unsupported", () => {
    const { anchor, assign, documentRef } = documentStub({ downloadSupported: false });

    expect(supportsAnchorDownload(documentRef)).toBe(false);
    triggerBrowserDownload(documentRef, "/api/media/download/job-2?token=abc", "clip.mp4");

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/api/media/download/job-2?token=abc");
    expect(anchor.click).not.toHaveBeenCalled();
  });
});
