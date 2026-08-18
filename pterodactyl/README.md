# Pterodactyl Deployment

This directory makes Native Media Studio compatible with **Pterodactyl**. The Pterodactyl image keeps the application under `/opt/native-media-studio`, because Pterodactyl mounts each server’s persistent writable data directory at `/home/container`. Temporary media files are intentionally stored at `/home/container/data/media-jobs`, so they survive process restarts long enough to honor the 15-minute delivery window.

> The Pterodactyl panel deploys a prebuilt image; it does not build this repository’s Dockerfile during normal server creation. Build and publish the image to a registry your node can pull from first.

## 1. Build and publish the image

The included GitHub Actions workflow automatically builds and publishes `ghcr.io/jondunnigan/native-media-studio:latest` whenever a relevant change reaches `main`. The first publish will happen after the workflow is present on GitHub; you can also trigger it from **Actions → Publish Pterodactyl Image → Run workflow**.

If you need to publish manually from a machine with Docker and registry credentials, run the following from the repository root:

```bash
docker build -f pterodactyl/Dockerfile -t ghcr.io/jondunnigan/native-media-studio:latest .
docker push ghcr.io/jondunnigan/native-media-studio:latest
```

The GitHub package is private by default. After the initial workflow completes, open the package settings at `https://github.com/users/jondunnigan/packages/container/package/native-media-studio` and change its visibility to **Public**, or configure registry pull credentials on the Pterodactyl node.

## 2. Provide a MySQL-compatible database

Pterodactyl runs the app in one server container. Provision MySQL or MariaDB separately and allow inbound database access from the Pterodactyl node. Create a database and a least-privilege user, then form a connection string like:

```text
mysql://native_media:REPLACE_WITH_PASSWORD@DATABASE_HOST:3306/native_media
```

Use TLS parameters where your database provider requires them. Do not place the database password in the Pterodactyl startup command; set it through the egg environment variable instead.

## 3. Import and configure the egg

In the Pterodactyl admin panel, create or select a Nest, choose **Import Egg**, and upload `pterodactyl/egg-native-media-studio.json`. The egg already uses `ghcr.io/jondunnigan/native-media-studio:latest`; no image substitution is needed once the workflow has completed successfully.

Create a new server from that egg. Allocate one TCP port. Pterodactyl supplies it as `SERVER_PORT`; the bundled entrypoint gives that assigned value precedence over any inherited `PORT` default, which the Express server then uses automatically. Set `DATABASE_URL` to the external database connection string and set `JWT_SECRET` to a private random value of at least 32 characters. Keep `MEDIA_WORK_DIR` at `/home/container/data/media-jobs`.

The prescribed startup command is already included in the egg:

```bash
bash /opt/native-media-studio/pterodactyl/entrypoint.sh
```

## Opening the application

The application binds to `0.0.0.0` inside the container on the TCP allocation assigned by Pterodactyl. The `localhost` message in the console refers to the **server container**, not the computer running your browser.

Open the external allocation displayed on the Pterodactyl server’s **Network** page:

```text
http://PTERODACTYL_NODE_PUBLIC_IP:ASSIGNED_PORT
```

For example, if the allocation is `203.0.113.10:25504`, browse to `http://203.0.113.10:25504`. Use `http://localhost:25504` only when the browser runs directly on the same Pterodactyl node and the node maps that port locally. If the external address still refuses connections, verify that the allocation is assigned to the server and that the node/provider firewall allows the allocated TCP port.

## 4. Startup, migration reconciliation, and cleanup

At each start, `scripts/start-production.mjs` connects to the database, applies normal Drizzle migrations, and starts the server. It also safely reconciles the specific historical case where the `users` and/or `media_jobs` tables already exist but the Drizzle migration ledger is empty. It first verifies required columns and only then records the matching migration hashes. If the existing schema is incompatible, startup stops rather than modifying unknown data.

To check panel-style port wiring before connecting a database, run the image with `PTERODACTYL_STARTUP_DRY_RUN=1` and a `SERVER_PORT` value. The entrypoint prints the effective `PORT` and the persistent media path, then exits without touching the database.

The entrypoint starts a small independent cleanup shell process. It removes ready media-job folders at their recorded expiry time, while the Node server remains the primary Pterodactyl process. Do not point `MEDIA_WORK_DIR` to `/tmp`; use the persistent `/home/container` mount.

## 5. Operational requirements

The image includes Node.js 22 and `yt-dlp-ejs`. Native Media Studio configures yt-dlp with `--js-runtimes node` so it can use the supported Node JavaScript runtime for YouTube extraction. Set `YTDLP_JS_RUNTIME` only when a different explicit runtime path is needed; set it to `off` for temporary runtime troubleshooting.

| Setting | Recommended value |
| --- | --- |
| Primary allocation | One TCP port; Pterodactyl maps it to `SERVER_PORT`. |
| Memory | Start with at least 1 GB; increase for large source files. |
| Disk | Allocate enough space for the largest expected concurrent temporary output plus headroom. |
| Database | External MySQL 8.0+/MariaDB-compatible instance, reachable from the node. |
| File persistence | Leave `/home/container` persistent; it holds short-lived media outputs. |
| Image updates | Build and push a new tag, change the egg/server image, then reinstall or restart. |

The image includes Node.js, `yt-dlp`, and `ffmpeg`. Upstream source availability remains dependent on the network of the Pterodactyl node and the source platform’s rules. This project does not include account-cookie handling, verification bypasses, or DRM circumvention; use it only for material you own or have permission to download.

### Large-transfer reliability

YouTube media URLs are time-bound. A `HTTP Error 403: Forbidden` that appears **after** partial transfer progress is an expiring stream URL rather than a block on the source, so conversions resume from the last good byte, tolerate an unavailable fragment, prefer fragmented (DASH) delivery, and retry with backoff. Long 2160p jobs are where this failure concentrates.

Set the optional `MEDIA_MAX_VIDEO_HEIGHT` variable (for example `1440`) to cap selected video height so large transfers finish inside the stream’s validity window. The **Maximum available** quality option is explicit user intent and ignores this ceiling; leave the variable unset for no cap.

Manus OAuth is intentionally optional for this self-hosted deployment. Do **not** set `OAUTH_SERVER_URL`, `VITE_APP_ID`, or Manus Forge credentials in Pterodactyl. Without an OAuth server URL, the application starts in anonymous conversion mode, disables OAuth callback routes, and does not attempt Manus authentication for public requests.
