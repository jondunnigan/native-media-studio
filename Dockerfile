FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm install -g corepack@latest \
    && corepack pnpm install \
    && corepack pnpm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV MEDIA_WORK_DIR=/app/data/media-jobs
EXPOSE 3000

CMD ["sh", "-c", "corepack pnpm drizzle-kit migrate && node dist/index.js"]
