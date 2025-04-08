# Dockerfile for processor-app (Revised Build Order v3 & Debug CMD)
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copy package files FIRST
COPY package*.json ./
# Install production dependencies based on lock file
RUN npm ci --only=production

# Copy application code AFTER installing dependencies
# This helps Docker layer caching if only code changes
COPY index.js ./
# If you had other source files (e.g., in a 'src/' dir), copy them too:
# COPY src ./src

# Final stage
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy necessary artifacts from builder stage
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/index.js ./

ENV NODE_PATH=/usr/src/app/node_modules

# Debug CMD: List files, print package.json, then run app
CMD ["sh", "-c", "echo '--- Listing /usr/src/app ---' && ls -la && echo '--- package.json content ---' && cat package.json && echo '--- Running index.js ---' && node index.js"]
