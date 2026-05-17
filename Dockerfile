# Dockerfile for Render + Puppeteer (with public/ → root move)
FROM node:18-bullseye

# Install Chromium + dependencies
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy ALL project files (including public/)
COPY . .

# 🔄 MOVE public/ contents to root, then remove public folder
# This handles: public/index.html → /app/index.html, public/css/ → /app/css/, etc.
RUN if [ -d "public" ]; then \
      echo "🔄 Moving public/ contents to root..."; \
      \
      # Move index.html if it exists in public/ \
      [ -f "public/index.html" ] && mv public/index.html ./index.html; \
      \
      # Move css/ and js/ folders if they exist in public/ \
      [ -d "public/css" ] && mv public/css ./css; \
      [ -d "public/js" ] && mv public/js ./js; \
      \
      # Move any other root-level files from public/ (images, fonts, etc.) \
      find public -maxdepth 1 -type f -not -name "index.html" -exec mv {} ./ \; 2>/dev/null || true; \
      \
      # Remove empty public folder \
      rmdir public 2>/dev/null || rm -rf public; \
      \
      echo "✅ public/ migration complete"; \
    else \
      echo "ℹ️  No public/ folder found, skipping move"; \
    fi

# ✅ Verify critical files exist
RUN test -f /app/index.html && echo "✅ index.html found at /app/" || echo "❌ index.html NOT found"
RUN test -d /app/css && echo "✅ css/ folder found" || echo "⚠️  css/ folder missing"
RUN test -d /app/js && echo "✅ js/ folder found" || echo "⚠️  js/ folder missing"

# Set environment variables
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=10000
# Optional: Detect Render environment
ENV RENDER=true

EXPOSE 10000

# Start the server
CMD ["node", "server.js"]
