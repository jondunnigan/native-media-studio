# Native Media Studio

Native Media Studio is a **private, self-hosted media conversion workspace** for YouTube URLs. It lets a person retrieve video or audio only when they own the material or otherwise have permission to download it. The application uses `yt-dlp` for source inspection and retrieval, and `ffmpeg` for stream merging and audio encoding. It does not attempt to bypass DRM, access controls, or rights restrictions.

## One-command startup

Install Docker Engine with the Compose plugin, clone this repository, copy `docker-compose.env.template` to `.env` and replace the database passwords, then run the following command from the repository root:

```bash
docker compose up --build -d
```

Open `http://localhost:3000`. Compose exposes **only one public port**: the web application port. MySQL and the cleanup worker are isolated inside the Compose network.

> Before making the service reachable beyond a trusted local network, create `.env` from `docker-compose.env.template` and replace both password values with long, unique secrets. Put the service behind HTTPS if it is exposed through a reverse proxy.

## Product behavior

| Area | Implementation |
| --- | --- |
| Source policy | The URL validator accepts only `youtube.com`, `m.youtube.com`, and `youtu.be` links. The interface requires a rights acknowledgement before inspection or conversion. |
| Source inspection | `yt-dlp --dump-single-json` supplies the title, thumbnail, duration, and discovered source formats. |
| Video outputs | MP4, MKV, or WebM. “Best available” selects the best source video and audio streams available; resolution settings select the best source video at or below 1080p, 720p, 480p, or 360p. `ffmpeg` performs the merge. |
| Audio outputs | MP3, AAC, FLAC, WAV, or OGG at the selected Best, 320 kbps, 192 kbps, or 128 kbps profile. `ffmpeg` performs the extraction and encoding. |
| Progress | The server parses yt-dlp’s newline progress output and publishes it over Server-Sent Events. The client also refreshes its session history as a resilient fallback. |
| Delivery | A random 256-bit capability token is hashed in MySQL. The actual token is emitted only in a download URL and is validated against the job, file state, and absolute expiry time. |
| Retention | A completed file gets a hard 15-minute expiry. The file is deleted after a successful download or by the independent cleanup service once it reaches expiry. |
| History | The browser receives a secure, HttpOnly anonymous-session cookie. Its recent conversions are limited to that session and remain visible through the expiry window. |

## Container layout

`docker compose up --build -d` starts three internal services. The `app` service exposes the single public port, creates database migrations on startup, and runs the React/Express application. The `db` service holds job metadata, tokens, and expiry timestamps in the `mysql_data` named volume. The `media-cleanup` service mounts the `media_jobs` named volume and deletes ready job folders older than 15 minutes, independently of the app process.

Temporary source and output files are stored only in the `media_jobs` named volume. The database contains metadata and a hash of the download token, not media bytes. To remove all temporary media manually during local development, run `docker compose down -v`; this also removes the database volume.

## Operations and constraints

The provided container serializes active media conversions to avoid exhausting a small self-hosted machine. Increase capacity only after considering CPU, memory, temporary disk, network bandwidth, and the applicable rights to each source. A quality choice means the best available source stream within the requested ceiling; the service does not artificially upscale video or claim that every original source format is always available.

The downloader depends on the behavior and availability of upstream sources. Some videos may be private, region restricted, unavailable, protected by DRM, or otherwise inaccessible. Those sources are expected to fail gracefully and are not bypassed by this project.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Starts the local development server. Local development requires `yt-dlp`, `ffmpeg`, and a configured MySQL-compatible `DATABASE_URL`. |
| `pnpm check` | Runs TypeScript type checking. |
| `pnpm test` | Runs the Vitest suite. |
| `pnpm build` | Produces the production React and Express build. |
| `docker compose up --build -d` | Builds and starts the self-hosted stack. |
| `docker compose logs -f app` | Streams app and yt-dlp conversion logs. |

## Security notes

The app deliberately avoids an arbitrary-URL downloader, rejects unsupported hosts, uses child-process argument arrays rather than shell interpolation, generates a cryptographically random token for each download link, stores only its SHA-256 hash, and deletes the output folder after a completed download. Treat any signed link as sensitive until it expires. The included service is designed for trusted self-hosting; add rate limiting, an authenticated gateway, HTTPS, and network controls before opening it to untrusted users.

## License and responsible use

Use this project only for content that you own, that is public-domain or openly licensed, or for which you have clear permission to download and convert. You are responsible for complying with YouTube’s terms, applicable copyright law, and the terms of every source you use.
