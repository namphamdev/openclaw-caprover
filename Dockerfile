# OpenClaw CapRover Production Dockerfile

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

# Create state and workspace directories with correct permissions
RUN mkdir -p /home/node/.openclaw /home/node/.openclaw/workspace && \
    chown -R node:node /home/node/.openclaw

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

# Switch to non-root user
USER node

# Start wrapper server (which manages gateway lifecycle)
CMD ["openclaw"]
