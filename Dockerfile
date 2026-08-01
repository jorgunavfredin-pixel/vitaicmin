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
# Frontend build stage — compiles the React admin panel to static files
FROM node:18-alpine AS webbuilder

WORKDIR /web
COPY admin-web/package*.json ./
RUN npm install
COPY admin-web/ ./
RUN npm run build

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

# Copy the built admin panel (served by Express at /admin)
COPY --from=webbuilder /web/dist ./admin-web/dist

# Create directories for volumes
RUN mkdir -p /app/src/database /app/assets /app/logs

# NOTE: assets/ TIDAK di-copy dari repo (folder di-track hanya berisi .gitkeep).
# Banner & media diisi lewat volume mount: /root/data/{name}/assets -> /app/assets.
# Kalau perlu default banner, mount dari host, jangan commit binary ke repo.

# Internal port always 3000 (mapped to random external port)
EXPOSE 3000
ENV PORT=3000
ENV TZ=Asia/Jakarta

# Health check — pakai 127.0.0.1, bukan localhost:
# wget resolve localhost ke ::1 (IPv6) sedangkan server listen IPv4 saja,
# sehingga healthcheck selalu gagal walau server sehat.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "src/index.js"]
