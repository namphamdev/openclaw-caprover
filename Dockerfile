# OpenClaw CapRover Production Dockerfile
# Multi-stage build for production-grade deployment

# Stage 1: Build wrapper dependencies
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts

# Copy source files
COPY src/ ./src/

# Stage 2: Runtime image based on OpenClaw
FROM ghcr.io/openclaw/openclaw:main

# Switch to root for setup
USER root

# Install Node.js runtime (for wrapper server)
# The base image may not have Node.js, so we install it
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create wrapper directory
WORKDIR /wrapper

# Copy wrapper from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Create state and workspace directories with correct permissions
RUN mkdir -p /home/node/.openclaw /home/node/.openclaw/workspace && \
    chown -R node:node /home/node/.openclaw /wrapper

# Make openclaw CLI available on PATH
RUN ln -s /app/openclaw.mjs /usr/local/bin/openclaw

# Environment configuration
ENV PORT=18789 \
    INTERNAL_GATEWAY_PORT=18790 \
    OPENCLAW_STATE_DIR=/home/node/.openclaw \
    OPENCLAW_WORKSPACE_DIR=/home/node/.openclaw/workspace \
    NODE_ENV=production \
    HOME=/home/node

# Expose wrapper port
EXPOSE 18789

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:18789/health || exit 1

# Switch to non-root user
USER node

# Start wrapper server (which manages gateway lifecycle)
CMD ["node", "/wrapper/src/server.js"]
