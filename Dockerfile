FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# System deps:
# - ffmpeg + python3 + yt-dlp for video pipeline
# - chromium + fonts for whatsapp-web.js puppeteer + canvas rendering
# - tini for proper signal handling
# - build tools for sharp/canvas native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      tini \
      ffmpeg \
      python3 \
      python3-pip \
      pipx \
      chromium \
      chromium-sandbox \
      fonts-liberation \
      fonts-noto \
      fonts-noto-cjk \
      fonts-dejavu \
      fonts-inter \
      fontconfig \
      libnss3 \
      libxss1 \
      libasound2 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      build-essential \
      pkg-config \
      libcairo2-dev \
      libpango1.0-dev \
      libjpeg-dev \
      libgif-dev \
      librsvg2-dev \
   && rm -rf /var/lib/apt/lists/*

# yt-dlp via pipx (newer than apt package, works with current sites)
RUN pipx ensurepath && pipx install yt-dlp
ENV PATH="/root/.local/bin:${PATH}"

# Refresh font cache so canvas/skia can find Inter
RUN fc-cache -f -v > /dev/null 2>&1 || true

# Tell whatsapp-web.js / puppeteer to use system chromium (no download)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install node deps (cached layer)
COPY package.json package-lock.json* ./
RUN npm install --include=dev

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Persistent state lives in /app/out (mounted as volume)
RUN mkdir -p /app/out

EXPOSE 3000 8080

# tini reaps zombies + forwards signals; -g signals whole process group on shutdown.
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]

# Config UI (8080) + BullMQ queue server with bull-board dashboard + webhook (3000)
CMD ["sh", "-c", "node --import=tsx/esm src/delivery/configServer.ts & exec node --import=tsx/esm src/queue/server.ts"]
