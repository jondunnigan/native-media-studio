# Pterodactyl Deployment

This directory makes Native Media Studio compatible with **Pterodactyl**. The Pterodactyl image keeps the application under `/opt/native-media-studio`, because Pterodactyl mounts each server’s persistent writable data directory at `/home/container`. Temporary media files are intentionally stored at `/home/container/data/media-jobs`, so they survive process restarts long enough to honor the 15-minute delivery window.

> The Pterodactyl panel deploys a prebuilt image; it does not build this repository’s Dockerfile during normal server creation. Build and publish the image to a registry your node can pull from first.

## 1. Build and publish the image

From the repository root on a machine with Docker and registry credentials, replace `YOUR_REGISTRY/YOUR_NAMESPACE` with a registry location accessible to the Pterodactyl node.

```bash
docker build -f pterodactyl/Dockerfile -t YOUR_REGISTRY/YOUR_NAMESPACE/native-media-studio:latest .
docker push YOUR_REGISTRY/YOUR_NAMESPACE/native-media-studio:latest
```

GitHub Container Registry is a common option. If the image is private, configure image-pull credentials on the Pterodactyl node before deploying the egg.

## 2. Provide a MySQL-compatible database

Pterodactyl runs the app in one server container. Provision MySQL or MariaDB separately and allow inbound database access from the Pterodactyl node. Create a database and a least-privilege user, then form a connection string like:

```text
mysql://native_media:REPLACE_WITH_PASSWORD@DATABASE_HOST:3306/native_media
```

Use TLS parameters where your database provider requires them. Do not place the database password in the Pterodactyl startup command; set it through the egg environment variable instead.

## 3. Import and configure the egg

In the Pterodactyl admin panel, create or select a Nest, choose **Import Egg**, and upload `pterodactyl/egg-native-media-studio.json`. Edit the egg’s Docker image field after import, replacing `ghcr.io/replace-with-your-owner/native-media-studio:latest` with the image you published.

Create a new server from that egg. Allocate one TCP port. Pterodactyl supplies it as `SERVER_PORT`; the bundled entrypoint gives that assigned value precedence over any inherited `PORT` default, which the Express server then uses automatically. Set `DATABASE_URL` to the external database connection string. Keep `MEDIA_WORK_DIR` at `/home/container/data/media-jobs`.

The prescribed startup command is already included in the egg:

```bash
bash /opt/native-media-studio/pterodactyl/entrypoint.sh
```

## 4. Startup, migration reconciliation, and cleanup

At each start, `scripts/start-production.mjs` connects to the database, applies normal Drizzle migrations, and starts the server. It also safely reconciles the specific historical case where the `users` and/or `media_jobs` tables already exist but the Drizzle migration ledger is empty. It first verifies required columns and only then records the matching migration hashes. If the existing schema is incompatible, startup stops rather than modifying unknown data.

To check panel-style port wiring before connecting a database, run the image with `PTERODACTYL_STARTUP_DRY_RUN=1` and a `SERVER_PORT` value. The entrypoint prints the effective `PORT` and the persistent media path, then exits without touching the database.

The entrypoint starts a small independent cleanup shell process. It removes ready media-job folders at their recorded expiry time, while the Node server remains the primary Pterodactyl process. Do not point `MEDIA_WORK_DIR` to `/tmp`; use the persistent `/home/container` mount.

## 5. Operational requirements

| Setting | Recommended value |
| --- | --- |
| Primary allocation | One TCP port; Pterodactyl maps it to `SERVER_PORT`. |
| Memory | Start with at least 1 GB; increase for large source files. |
| Disk | Allocate enough space for the largest expected concurrent temporary output plus headroom. |
| Database | External MySQL 8.0+/MariaDB-compatible instance, reachable from the node. |
| File persistence | Leave `/home/container` persistent; it holds short-lived media outputs. |
| Image updates | Build and push a new tag, change the egg/server image, then reinstall or restart. |

The image includes Node.js, `yt-dlp`, and `ffmpeg`. Upstream source availability remains dependent on the network of the Pterodactyl node and the source platform’s rules. This project does not include account-cookie handling, verification bypasses, or DRM circumvention; use it only for material you own or have permission to download.
