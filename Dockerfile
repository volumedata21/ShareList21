# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy Source
COPY . .

# 1. Build Frontend (Vite)
RUN npm run build

# 2. Build Backend (Esbuild)
# UPDATED: Now uses the script we added to package.json
RUN npm run build:server

# --- Stage 2: Runner ---
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# Install only runtime dependencies
RUN npm install --only=production

# Copy Frontend Build
COPY --from=builder /app/dist ./dist

# Copy Backend Build
COPY --from=builder /app/dist-server ./dist-server

EXPOSE 80

CMD ["node", "dist-server/server.js"]