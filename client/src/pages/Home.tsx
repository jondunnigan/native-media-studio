import { trpc } from "@/lib/trpc";
import { startReadyDownload } from "@/lib/readyDownload";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, CircleHelp, Clock3, Download, FileAudio2, Film, Link2, Loader2, LockKeyhole, Play, ShieldCheck, Sparkles, X } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type MediaMode = "video" | "audio";
type ProgressEvent = {
  id: string;
  status: string;
  progress: number;
  stage: string;
  failureMessage?: string | null;
  expiresAt?: Date | string | null;
  outputName?: string | null;
  outputBytes?: number | null;
};

type ReadyDownload = Pick<ProgressEvent, "id" | "outputName" | "outputBytes" | "expiresAt">;

const videoQualities = [
  { value: "best", label: "Recommended (balanced)" },
  { value: "max", label: "Maximum available" },
  { value: "2160p", label: "2160p 4K" },
  { value: "1440p", label: "1440p QHD" },
  { value: "1080p", label: "1080p Full HD" },
  { value: "720p", label: "720p HD" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
] as const;

const audioQualities = [
  { value: "best", label: "Best available" },
  { value: "320", label: "320 kbps" },
  { value: "192", label: "192 kbps" },
  { value: "128", label: "128 kbps" },
] as const;

// Derived from the option lists so a newly offered quality cannot be sent as a value the
// server does not accept.
type VideoQualityValue = (typeof videoQualities)[number]["value"];
type AudioQualityValue = (typeof audioQualities)[number]["value"];

function bytes(value?: number | null) {
  if (!value) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function duration(value?: number | null) {
  if (!value) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function expiryLabel(value?: Date | string | null) {
  if (!value) return "15 min window";
  const milliseconds = new Date(value).getTime() - Date.now();
  if (milliseconds <= 0) return "Expired";
  return `${Math.max(1, Math.ceil(milliseconds / 60000))} min remaining`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [rightsAcknowledged, setRightsAcknowledged] = useState(false);
  const [mode, setMode] = useState<MediaMode>("video");
  const [videoQuality, setVideoQuality] = useState("best");
  const [videoFormat, setVideoFormat] = useState("mp4");
  const [audioQuality, setAudioQuality] = useState("best");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [liveJob, setLiveJob] = useState<ProgressEvent | null>(null);
  const [eventStreamDisconnected, setEventStreamDisconnected] = useState(false);
  const [sourceAvailabilityError, setSourceAvailabilityError] = useState<string | null>(null);
  const [readyDownload, setReadyDownload] = useState<ReadyDownload | null>(null);
  const announcedReadyJobs = useRef(new Set<string>());
  const autoDownloadStartedJobs = useRef(new Set<string>());
  const inspect = trpc.media.inspect.useMutation();
  const start = trpc.media.start.useMutation();
  const history = trpc.media.list.useQuery(undefined, { refetchInterval: 5000 });
  const createDownloadLink = trpc.media.createDownloadLink.useMutation();

  const qualities = mode === "video" ? videoQualities : audioQualities;
  const selectedQuality = mode === "video" ? videoQuality : audioQuality;
  const selectedFormat = mode === "video" ? videoFormat : audioFormat;
  const source = inspect.data;
  const canConvert = Boolean(source && rightsAcknowledged && !start.isPending);

  const activeHistoryJob = useMemo(() => history.data?.find(job => job.id === activeJobId), [activeJobId, history.data]);
  const status = eventStreamDisconnected ? activeHistoryJob ?? liveJob : liveJob ?? activeHistoryJob ?? null;

  useEffect(() => {
    if (status?.status !== "ready" || announcedReadyJobs.current.has(status.id)) return;
    announcedReadyJobs.current.add(status.id);
    const name = status.outputName || "Your file";
    setReadyDownload({ id: status.id, outputName: status.outputName, outputBytes: status.outputBytes, expiresAt: status.expiresAt });
    toast.success(`${name} is ready. Starting your download now.`);
    if (!autoDownloadStartedJobs.current.has(status.id)) {
      autoDownloadStartedJobs.current.add(status.id);
      void download(status.id, { automatic: true });
    }
  }, [status?.id, status?.status, status?.outputName, status?.outputBytes, status?.expiresAt]);

  useEffect(() => {
    if (!activeJobId) return;
    const events = new EventSource(`/api/media/jobs/${activeJobId}/events`);
    events.onmessage = event => {
      const next = JSON.parse(event.data) as ProgressEvent;
      setEventStreamDisconnected(false);
      setLiveJob(next);
      if (["ready", "failed", "expired", "downloaded"].includes(next.status)) {
        events.close();
        void history.refetch();
      }
    };
    events.onerror = () => {
      events.close();
      setEventStreamDisconnected(true);
      setLiveJob(null);
      void history.refetch();
    };
    return () => events.close();
  }, [activeJobId]);

  async function inspectSource(event: FormEvent) {
    event.preventDefault();
    if (!rightsAcknowledged) {
      toast.error("Please confirm you own this content or have permission to download it.");
      return;
    }
    try {
      await inspect.mutateAsync({ url, acknowledgedRights: true });
      setActiveJobId(null);
      setLiveJob(null);
      setEventStreamDisconnected(false);
      setSourceAvailabilityError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "We could not inspect that link.";
      if (message.includes("YouTube rejected this server’s automated request")) {
        setSourceAvailabilityError(message);
        return;
      }
      toast.error(message);
    }
  }

  async function createJob() {
    if (!source) return;
    try {
      const result = await start.mutateAsync({
        url,
        sourceId: source.id,
        title: source.title,
        thumbnailUrl: source.thumbnail,
        durationSeconds: source.durationSeconds,
        mediaKind: mode,
        requestedQuality: selectedQuality as VideoQualityValue | AudioQualityValue,
        outputFormat: selectedFormat as "mp4" | "mkv" | "webm" | "mp3" | "aac" | "flac" | "wav" | "ogg",
        acknowledgedRights: true,
      });
      setActiveJobId(result.jobId);
      setLiveJob({ id: result.jobId, status: "queued", progress: 0, stage: "Queued" });
      setEventStreamDisconnected(false);
      setReadyDownload(null);
      void history.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We could not start this conversion.");
    }
  }

  async function download(id: string, options: { automatic?: boolean } = {}) {
    try {
      const result = await createDownloadLink.mutateAsync({ id });
      const filename = history.data?.find(job => job.id === id)?.outputName || readyDownload?.outputName || "media-download";
      await startReadyDownload({
        id,
        filename,
        documentRef: document,
        requestSignedUrl: async () => result,
      });
      setReadyDownload(current => current?.id === id ? null : current);
      toast.success(options.automatic ? "Your browser download has started." : "Your browser download has started.");
      void history.refetch();
    } catch (error) {
      if (options.automatic) {
        toast.error("Your file is ready, but the browser blocked the automatic download. Use Download file to continue.");
        return;
      }
      toast.error(error instanceof Error ? error.message : "This file is no longer available.");
    }
  }

  return (
    <div className="studio-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Native Media Studio home">
          <span className="brand-mark"><Play size={12} fill="currentColor" strokeWidth={3} /></span>
          <span>Native Media Studio</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#workspace">Convert</a>
          <a href="#library">Recent files</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <span className="nav-note"><LockKeyhole size={13} /> Self-hosted</span>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="eyebrow"><Sparkles size={14} /> Native-quality media, thoughtfully delivered.</div>
          <h1 id="hero-title">Your media.<br /><span>At its best.</span></h1>
          <p className="hero-copy">A private, self-hosted workspace for retrieving video and audio you own or are authorized to download. No accounts. No clutter. Just the format you need.</p>
          <div className="trust-row" id="privacy">
            <span><ShieldCheck size={16} /> Authorization-first</span>
            <span><Clock3 size={16} /> 15-minute files</span>
            <span><LockKeyhole size={16} /> Private by design</span>
          </div>
        </section>

        <section id="workspace" className="workspace" aria-label="Media conversion workspace">
          <div className="input-card frosted">
            <div className="section-kicker"><Link2 size={15} /> Add a source</div>
            <form onSubmit={inspectSource}>
              <div className="url-field">
                <Link2 size={19} strokeWidth={2.2} />
                <input value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste a YouTube link" aria-label="YouTube URL" />
                <button className="inspect-button" type="submit" disabled={inspect.isPending}>
                  {inspect.isPending ? <Loader2 className="spin" size={17} /> : "Inspect"}
                </button>
              </div>
              <label className="rights-check">
                <input type="checkbox" checked={rightsAcknowledged} onChange={event => setRightsAcknowledged(event.target.checked)} />
                <span>I own this content or have permission to download it.</span>
                <CircleHelp size={14} aria-label="Only retrieve material you have the right to download." />
              </label>
            </form>
          </div>

          <AnimatePresence>
            {sourceAvailabilityError && (
              <motion.aside className="availability-card" aria-live="polite" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ type: "spring", stiffness: 280, damping: 25 }}>
                <div className="availability-icon"><ShieldCheck size={18} /></div>
                <div><strong>This source is unavailable from this server.</strong><p>YouTube is requiring verification from the current host. The media tools are installed; this is an upstream network restriction. Run the supplied Docker stack on your own trusted network, then retry content you are authorized to download.</p></div>
                <button className="icon-button" onClick={() => setSourceAvailabilityError(null)} aria-label="Dismiss source availability notice"><X size={18} /></button>
              </motion.aside>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {source && (
              <motion.div className="source-card frosted" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ type: "spring", stiffness: 260, damping: 24 }}>
                <div className="source-art">
                  {source.thumbnail ? <img src={source.thumbnail} alt="" /> : <Film size={32} />}
                  <span className="duration-chip">{duration(source.durationSeconds)}</span>
                </div>
                <div className="source-info">
                  <div className="source-overline">Ready to convert</div>
                  <h2>{source.title}</h2>
                  <p>{source.formats.filter(format => format.hasVideo).length} source formats found · highest quality preserved when available</p>
                </div>
                <button className="icon-button" onClick={() => { inspect.reset(); setActiveJobId(null); setLiveJob(null); }} aria-label="Clear selected source"><X size={18} /></button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {source && (
              <motion.div className="convert-card frosted" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.03 }}>
                <div className="segment-control" role="tablist" aria-label="Media type">
                  <button className={mode === "video" ? "selected" : ""} onClick={() => setMode("video")} role="tab" aria-selected={mode === "video"}><Film size={16} /> Video</button>
                  <button className={mode === "audio" ? "selected" : ""} onClick={() => setMode("audio")} role="tab" aria-selected={mode === "audio"}><FileAudio2 size={16} /> Audio</button>
                </div>
                <div className="settings-grid">
                  <label className="select-field">{mode === "video" ? "Quality" : "Audio quality"}
                    <span><select value={selectedQuality} onChange={event => mode === "video" ? setVideoQuality(event.target.value) : setAudioQuality(event.target.value)}>{qualities.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={16} /></span>
                  </label>
                  <label className="select-field">{mode === "video" ? "Container" : "Output format"}
                    <span><select value={selectedFormat} onChange={event => mode === "video" ? setVideoFormat(event.target.value) : setAudioFormat(event.target.value)}>{(mode === "video" ? ["mp4", "mkv", "webm"] : ["mp3", "aac", "flac", "wav", "ogg"]).map(item => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select><ChevronDown size={16} /></span>
                  </label>
                </div>
                <div className="conversion-footer">
                  <p>{mode === "video" ? "Video and audio streams are merged using ffmpeg." : "Audio is extracted and encoded using ffmpeg."}</p>
                  <button className="primary-button" onClick={createJob} disabled={!canConvert}>{start.isPending ? <Loader2 className="spin" size={17} /> : <Download size={17} />} Create {mode === "video" ? "video" : "audio"} file</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {status && (
              <motion.div className={`progress-card ${status.status}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 280, damping: 26 }}>
                <div className="progress-header"><span className="pulse-dot" /><div><strong>{status.stage}</strong><p>{status.status === "ready" ? "Your file is available for the next 15 minutes." : status.failureMessage || "Keep this tab open while your file is prepared."}</p></div><span className="progress-number">{status.progress}%</span></div>
                <div className="progress-track"><span style={{ width: `${status.progress}%` }} /></div>
                {status.status === "ready" && <button className="download-ready" onClick={() => download(status.id)}><Download size={16} /> Download now</button>}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {readyDownload && (
              <motion.div className="completion-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.section className="completion-dialog" role="dialog" aria-modal="true" aria-labelledby="download-ready-title" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
                  <button className="completion-close" onClick={() => setReadyDownload(null)} aria-label="Dismiss download dialog"><X size={18} /></button>
                  <div className="completion-icon"><Check size={24} strokeWidth={3} /></div>
                  <p className="completion-kicker">Conversion complete</p>
                  <h2 id="download-ready-title">Your file is ready.</h2>
                  <p className="completion-copy">{readyDownload.outputName || "Your converted media"}{readyDownload.outputBytes ? ` · ${bytes(readyDownload.outputBytes)}` : ""}. Your browser should begin downloading it now. If it does not, use the button below. This private link expires in {expiryLabel(readyDownload.expiresAt)}.</p>
                  <button className="completion-download" onClick={() => download(readyDownload.id)} disabled={createDownloadLink.isPending}>{createDownloadLink.isPending ? <Loader2 className="spin" size={17} /> : <Download size={17} />} Download file</button>
                  <p className="completion-note">If the download does not open automatically, allow downloads for this site and use the button again.</p>
                </motion.section>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section id="library" className="library-section">
          <div className="section-heading"><div><p className="section-kicker">This session</p><h2>Recent files</h2></div><p>Files are automatically removed after download or expiry.</p></div>
          <div className="history-card frosted">
            {history.isLoading ? <div className="empty-state"><Loader2 className="spin" size={18} /> Checking your workspace</div> : history.data?.length ? (
              history.data.map(job => (
                <div className="history-row" key={job.id}>
                  <div className={`file-icon ${job.mediaKind}`}><>{job.mediaKind === "video" ? <Film size={18} /> : <FileAudio2 size={18} />}</></div>
                  <div className="file-details"><strong>{job.title}</strong><span>{job.outputFormat.toUpperCase()} · {job.requestedQuality === "best" ? "Best available" : job.requestedQuality.includes("p") ? job.requestedQuality : `${job.requestedQuality} kbps`}</span></div>
                  <div className={`status-pill ${job.status}`}><span />{job.status === "ready" ? expiryLabel(job.expiresAt) : job.status}</div>
                  {job.status === "ready" ? <button className="row-download" onClick={() => download(job.id)} aria-label={`Download ${job.title}`}><Download size={17} /></button> : <div className="row-size">{job.outputBytes ? bytes(job.outputBytes) : "—"}</div>}
                </div>
              ))
            ) : <div className="empty-state"><div className="empty-icon"><Download size={21} /></div><p><strong>No files yet.</strong> Your recent conversions will appear here.</p></div>}
          </div>
        </section>
      </main>
      <footer><span>Native Media Studio</span><span>Private, temporary, self-hosted.</span><span>Use only with content you are authorized to download.</span></footer>
    </div>
  );
}
