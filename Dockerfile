# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDependencies for esbuild/vite)
COPY package*.json ./
RUN npm install

# Copy Source
COPY . .

# 1. Build Frontend (Vite)
RUN npm run build

# 2. Build Backend (Esbuild)
# REMOVED: client.ts (No longer needed)
RUN npx esbuild server.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=esm \
    --packages=external \
    --outdir=dist-server


# --- Stage 2: Runner ---
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# Install only runtime dependencies (express, sqlite3, rate-limit, etc.)
RUN npm install --only=production

# Copy Frontend Build
COPY --from=builder /app/dist ./dist

# Copy Backend Build (Bundled JS)
COPY --from=builder /app/dist-server ./dist-server

# REMOVED: entrypoint.sh copy and setup (Not needed)

EXPOSE 80

# NEW: Run the server directly
CMD ["node", "dist-server/server.js"]