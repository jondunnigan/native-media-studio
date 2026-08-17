FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-pip \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
    && useradd --create-home --home-dir /home/container --shell /bin/bash container \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/native-media-studio
COPY . .
RUN npm install -g corepack@latest \
    && corepack pnpm install \
    && corepack pnpm run build \
    && mkdir -p /home/container/data/media-jobs \
    && chown -R container:container /home/container \
    && chmod +x /opt/native-media-studio/pterodactyl/entrypoint.sh /opt/native-media-studio/pterodactyl/cleanup-media.sh

ENV NODE_ENV=production \
    HOME=/home/container \
    USER=container \
    MEDIA_WORK_DIR=/home/container/data/media-jobs

USER container
WORKDIR /home/container
EXPOSE 3000
CMD ["bash", "/opt/native-media-studio/pterodactyl/entrypoint.sh"]
