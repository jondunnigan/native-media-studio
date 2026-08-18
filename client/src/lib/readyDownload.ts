import { triggerBrowserDownload } from "./browserDownload";

export async function startReadyDownload({
  id,
  filename,
  requestSignedUrl,
  documentRef,
}: {
  id: string;
  filename: string;
  requestSignedUrl: (id: string) => Promise<{ url: string }>;
  documentRef: Document;
}) {
  const { url } = await requestSignedUrl(id);
  triggerBrowserDownload(documentRef, url, filename);
  return url;
}
