# syntax=docker/dockerfile:1

# --- Stage 1: build ---
FROM node:22-alpine AS build
WORKDIR /app

# Install all dependencies (including dev) for the build.
COPY package.json package-lock.json* ./
RUN npm ci

# Compile TypeScript -> dist/
COPY . .
RUN npm run build

# --- Stage 2: runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy the compiled output from the build stage.
COPY --from=build /app/dist ./dist

# Run as a non-root user for security.
USER node

# Render injects PORT at runtime; the app binds to process.env.PORT.
# EXPOSE is documentation only.
EXPOSE 3001

CMD ["node", "dist/index.js"]
