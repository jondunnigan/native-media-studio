export function triggerBrowserDownload(documentRef: Document, url: string, filename = "media-download") {
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
