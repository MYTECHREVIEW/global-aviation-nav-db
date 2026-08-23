# ─────────────────────────────────────────────────────────────
# AeroNav Global Navigation Database & Flight Plan Route Engine
# Optimized for Portainer & TrueNAS Docker Deployment
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl tzdata

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source and pre-compiled datasets
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY data/ ./data/

# Exclude large raw download archives from runtime container
RUN rm -rf ./data/raw ./data/*.zip

# Configure environment
ENV NODE_ENV=production
ENV PORT=3510

EXPOSE 3510

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3510/health || exit 1

CMD ["node", "server.js"]
