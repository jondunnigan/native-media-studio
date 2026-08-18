export function supportsAnchorDownload(documentRef: Document): boolean {
  // When the anchor element does not support the download attribute, a programmatic click
  // cannot deliver the file, so navigation is the only in-page delivery path.
  return "download" in documentRef.createElement("a");
}

export function triggerBrowserDownload(documentRef: Document, url: string, filename = "media-download") {
  // The signed URL is single-use: the server consumes the token and deletes the output once
  // the response finishes. Exactly ONE request may be issued per signed URL, so this never
  // performs a timed retry or a second navigation after clicking the anchor.
  if (!supportsAnchorDownload(documentRef)) {
    const view = documentRef.defaultView;
    view?.location.assign(url);
    return;
  }
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  documentRef.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}
