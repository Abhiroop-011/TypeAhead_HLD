# =============================================================================
# DOCKERFILE — Node.js Backend for Search Typeahead
# =============================================================================
# Build context is the PROJECT ROOT (set in docker-compose.yml) so we can
# copy both backend/ and frontend/ into the image.
# =============================================================================

FROM node:18-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

# Copy backend source code
COPY backend/ ./

# Copy frontend into public/ directory (served by Express.static)
COPY frontend/ ./public/

EXPOSE 3000

CMD ["node", "server.js"]
