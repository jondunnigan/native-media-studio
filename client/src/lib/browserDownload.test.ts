import { describe, expect, it, vi } from "vitest";
import { triggerBrowserDownload } from "./browserDownload";

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
