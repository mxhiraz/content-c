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
      wget \
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

# Install Anton (hook display) + Montserrat (body, all weights) + DM Sans (alt body) from Google Fonts
# Bookworm apt has no fonts-montserrat, pull TTFs directly from google/fonts repo.
RUN mkdir -p /usr/share/fonts/truetype/anton /usr/share/fonts/truetype/montserrat /usr/share/fonts/truetype/dm-sans \
 && wget -q -O /usr/share/fonts/truetype/anton/Anton-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" \
 && wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Regular.ttf" \
 && wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-Medium.ttf "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Medium.ttf" \
 && wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Bold.ttf" \
 && wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-ExtraBold.ttf "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-ExtraBold.ttf" \
 && wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-Black.ttf "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Black.ttf" \
 && wget -q -O /usr/share/fonts/truetype/dm-sans/DMSans-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf" \
 || echo "some font downloads failed, container will use fallbacks"

# Refresh font cache so canvas/skia can find Inter / Anton / Montserrat / DM Sans
RUN fc-cache -f -v > /dev/null 2>&1 || true

# Tell whatsapp-web.js / puppeteer to use system chromium (no download)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install node deps (cached layer)
COPY package.json package-lock.json* ./
# Retry on flaky network (ECONNRESET from npm registry)
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm install --include=dev --no-audit --no-fund

# Copy source + prompts/ (all editable prompts live there — see SKILL.md + src/skills/loader.ts)
COPY tsconfig.json ./
COPY src ./src
COPY prompts ./prompts

# Persistent state lives in /app/out (mounted as volume)
RUN mkdir -p /app/out

EXPOSE 3000 8080

# tini reaps zombies + forwards signals; -g signals whole process group on shutdown.
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]

# Config UI (8080) + BullMQ queue server with bull-board dashboard + webhook (3000)
CMD ["sh", "-c", "node --import=tsx/esm src/delivery/configServer.ts & exec node --import=tsx/esm src/queue/server.ts"]
