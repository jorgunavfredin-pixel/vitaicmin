# ================================
# Dockerfile — Bot Auto Order Telegram
# Multi-stage build for smaller image
# ================================

FROM node:18-alpine AS builder

# Install build dependencies for native modules (sharp, better-sqlite3)
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

# Install dependencies first (cache layer)
COPY package*.json ./
RUN npm ci --only=production

# ================================
FROM node:18-alpine

# Runtime dependencies for sharp, better-sqlite3, and SVG font rendering
RUN apk add --no-cache vips fontconfig ttf-freefont font-noto \
    && fc-cache -f

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY src/ ./src/

# Create directories for volumes
RUN mkdir -p /app/src/database /app/assets /app/logs

# Default assets (will be overridden by volume mount if buyer uploads)
COPY assets/ ./assets/

# Internal port always 3000 (mapped to random external port)
EXPOSE 3000
ENV PORT=3000
ENV TZ=Asia/Jakarta

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "src/index.js"]
